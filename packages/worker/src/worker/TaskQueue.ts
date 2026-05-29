import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";
import type { TaskRecord } from "@flaxia/sdk";

export class TaskQueue extends DurableObject<Env> {
  private cachePending: string[] | null = null;
  private cacheProcessing: string[] | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  private validateInternal(request: Request): boolean {
    const secret = request.headers.get("X-DO-Shared-Secret");
    return secret === this.env.DO_SHARED_SECRET;
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/complete") {
      if (!this.validateInternal(request)) {
        return new Response("Forbidden", { status: 403 });
      }
      const { taskId, result, nodeId, error } = await request.json() as { taskId: string; result: unknown; nodeId: string; error?: string };
      await this.completeTask(taskId, result, nodeId, error);
      return new Response("OK");
    }

    if (url.pathname === "/assign-next") {
      if (!this.validateInternal(request)) {
        return new Response("Forbidden", { status: 403 });
      }
      await this.tryAssignAll();
      return new Response("OK");
    }

    if (url.pathname === "/requeue") {
      if (!this.validateInternal(request)) {
        return new Response("Forbidden", { status: 403 });
      }
      const { taskId, nodeId, error } = await request.json() as { taskId: string; nodeId: string; error?: string };
      await this.requeueTask(taskId, nodeId, error);
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  }

  async enqueue(task: TaskRecord): Promise<void> {
    await this.ctx.storage.put(`task:${task.id}`, task);

    const pending = await this.getPending();
    pending.push(task.id);
    this.cachePending = pending;
    await this.ctx.storage.put("queue:pending", pending);

    await this.tryAssignAll();
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    return await this.ctx.storage.get<TaskRecord>(`task:${taskId}`);
  }

  async getPending(): Promise<string[]> {
    if (this.cachePending) return this.cachePending;
    this.cachePending = (await this.ctx.storage.get<string[]>("queue:pending")) || [];
    return this.cachePending;
  }

  async getProcessing(): Promise<string[]> {
    if (this.cacheProcessing) return this.cacheProcessing;
    this.cacheProcessing = (await this.ctx.storage.get<string[]>("queue:processing")) || [];
    return this.cacheProcessing;
  }

  private invalidateCache() {
    this.cachePending = null;
    this.cacheProcessing = null;
  }

  async tryAssignAll() {
    const pendingIds = await this.getPending();
    console.log(`[TaskQueue] tryAssignAll: pending=${pendingIds.length}`);
    if (pendingIds.length === 0) return;

    const nodeManagerId = this.env.NODE_MANAGER.idFromName("global-manager");
    const nodeManager = this.env.NODE_MANAGER.get(nodeManagerId);

    for (const taskId of [...pendingIds]) {
      try {
        const task = await this.getTask(taskId);
        if (!task || task.status !== 'pending') continue;

        console.log(`[TaskQueue] picking node for task ${taskId} (workload=${task.workload})`);
        const nodeResponse = await nodeManager.fetch(new Request(`http://internal/pick?workload=${task.workload}`, {
          headers: { 'X-DO-Shared-Secret': this.env.DO_SHARED_SECRET },
        }));
        const respBody = await nodeResponse.text();
        console.log(`[TaskQueue] pick response: status=${nodeResponse.status}, body=${respBody}`);
        if (nodeResponse.status === 200) {
          const { nodeId } = JSON.parse(respBody) as { nodeId: string | null };
          if (nodeId) {
            console.log(`[TaskQueue] assigned task ${taskId} to node ${nodeId}`);
            await this.assignTask(task, nodeId);
          } else {
            console.log(`[TaskQueue] no node available for task ${taskId}`);
          }
        }
      } catch (err) {
        console.error(`[TaskQueue] error assigning task ${taskId}:`, err);
      }
    }
  }

  private async assignTask(task: TaskRecord, nodeId: string) {
    task.status = 'processing';
    task.assignedNodeId = nodeId;
    task.assignedAt = Date.now();
    await this.ctx.storage.put(`task:${task.id}`, task);

    const pending = await this.getPending();
    this.cachePending = pending.filter(id => id !== task.id);
    await this.ctx.storage.put("queue:pending", this.cachePending);

    const processing = await this.getProcessing();
    this.cacheProcessing = processing;
    this.cacheProcessing.push(task.id);
    await this.ctx.storage.put("queue:processing", this.cacheProcessing);

    const nodeManagerId = this.env.NODE_MANAGER.idFromName("global-manager");
    const nodeManager = this.env.NODE_MANAGER.get(nodeManagerId);
    await nodeManager.fetch(new Request("http://internal/assign", {
      method: "POST",
      headers: { 'X-DO-Shared-Secret': this.env.DO_SHARED_SECRET },
      body: JSON.stringify({ nodeId, task })
    }));
  }

  private async completeTask(taskId: string, result: unknown, nodeId: string, error?: string) {
    const task = await this.getTask(taskId);
    if (!task) return;

    if (error) {
      task.status = 'failed';
      task.error = error;
    } else {
      task.status = 'done';
      task.result = result;
    }
    task.completedAt = Date.now();
    await this.ctx.storage.put(`task:${task.id}`, task);

    const processing = await this.getProcessing();
    this.cacheProcessing = processing.filter(id => id !== taskId);
    await this.ctx.storage.put("queue:processing", this.cacheProcessing);

    await this.tryAssignAll();
  }

  private async requeueTask(taskId: string, nodeId: string, error?: string) {
    const task = await this.getTask(taskId);
    if (!task || task.status !== 'processing') return;

    const processing = await this.getProcessing();
    this.cacheProcessing = processing.filter(id => id !== taskId);
    await this.ctx.storage.put("queue:processing", this.cacheProcessing);

    task.retryCount++;
    if (task.retryCount >= 3) {
      task.status = 'failed';
      task.error = error || 'Max retries exceeded';
      await this.ctx.storage.put(`task:${task.id}`, task);
    } else {
      task.status = 'pending';
      delete task.assignedNodeId;
      delete task.assignedAt;
      await this.ctx.storage.put(`task:${task.id}`, task);

      const pending = await this.getPending();
      this.cachePending = pending;
      this.cachePending.push(taskId);
      await this.ctx.storage.put("queue:pending", this.cachePending);
    }

    this.invalidateCache();
    await this.tryAssignAll();
  }

  async alarm(): Promise<void> {
    await this.checkTimeouts();

    const pending = await this.getPending();
    const processing = await this.getProcessing();
    if (pending.length > 0 || processing.length > 0) {
      const interval = pending.length > 0 ? 2000 : 10000;
      await this.ctx.storage.setAlarm(Date.now() + interval);
    }
  }

  private async checkTimeouts(): Promise<void> {
    const processingIds = await this.getProcessing();
    const now = Date.now();

    for (const taskId of processingIds) {
      const task = await this.getTask(taskId);
      if (task && task.assignedAt && now - task.assignedAt > task.timeoutMs) {
        task.retryCount++;

        if (task.retryCount >= 3) {
          task.status = 'failed';
          task.error = 'Max retries exceeded';
          await this.ctx.storage.put(`task:${task.id}`, task);

          const processing = await this.getProcessing();
          this.cacheProcessing = processing.filter(id => id !== taskId);
          await this.ctx.storage.put("queue:processing", this.cacheProcessing);
        } else {
          task.status = 'pending';
          delete task.assignedNodeId;
          delete task.assignedAt;
          await this.ctx.storage.put(`task:${task.id}`, task);

          const processing = await this.getProcessing();
          this.cacheProcessing = processing.filter(id => id !== taskId);
          await this.ctx.storage.put("queue:processing", this.cacheProcessing);

          const pending = await this.getPending();
          this.cachePending = pending;
          this.cachePending.push(taskId);
          await this.ctx.storage.put("queue:pending", this.cachePending);
        }
      }
    }

    this.invalidateCache();
    await this.tryAssignAll();
  }
}
