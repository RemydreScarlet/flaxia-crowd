import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";
import type { TaskRecord } from "@flaxia/sdk";

export class TaskQueue extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    
    if (url.pathname === "/complete") {
      const { taskId, result, nodeId } = await request.json() as any;
      await this.completeTask(taskId, result, nodeId);
      return new Response("OK");
    }

    if (url.pathname === "/assign-next") {
      await this.tryAssignAll();
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  }

  async enqueue(task: TaskRecord): Promise<void> {
    await this.ctx.storage.put(`task:${task.id}`, task);
    
    const pending = (await this.ctx.storage.get<string[]>("queue:pending")) || [];
    pending.push(task.id);
    await this.ctx.storage.put("queue:pending", pending);
    
    await this.ctx.storage.setAlarm(Date.now() + 1000); // Try assigning soon
    await this.tryAssignAll();
  }

  async getTask(taskId: string): Promise<TaskRecord | undefined> {
    return await this.ctx.storage.get<TaskRecord>(`task:${taskId}`);
  }

  async getPending(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>("queue:pending")) || [];
  }

  async tryAssignAll() {
    const pendingIds = await this.getPending();
    if (pendingIds.length === 0) return;

    const nodeManagerId = this.env.NODE_MANAGER.idFromName("global-manager");
    const nodeManager = this.env.NODE_MANAGER.get(nodeManagerId);

    for (const taskId of [...pendingIds]) {
      const task = await this.getTask(taskId);
      if (!task || task.status !== 'pending') continue;

      // Ask NodeManager for a node
      // We'll use a simplified internal RPC-like call via fetch
      const nodeResponse = await nodeManager.fetch(new Request(`http://internal/pick?workload=${task.workload}`));
      if (nodeResponse.status === 200) {
        const { nodeId } = await nodeResponse.json() as any;
        if (nodeId) {
          await this.assignTask(task, nodeId);
        }
      }
    }
  }

  private async assignTask(task: TaskRecord, nodeId: string) {
    task.status = 'processing';
    task.assignedNodeId = nodeId;
    task.assignedAt = Date.now();
    await this.ctx.storage.put(`task:${task.id}`, task);

    // Update pending queue
    const pending = await this.getPending();
    await this.ctx.storage.put("queue:pending", pending.filter(id => id !== task.id));

    // Update processing queue
    const processing = (await this.ctx.storage.get<string[]>("queue:processing")) || [];
    processing.push(task.id);
    await this.ctx.storage.put("queue:processing", processing);

    // Tell NodeManager to actually send the task
    const nodeManagerId = this.env.NODE_MANAGER.idFromName("global-manager");
    const nodeManager = this.env.NODE_MANAGER.get(nodeManagerId);
    await nodeManager.fetch(new Request("http://internal/assign", {
      method: "POST",
      body: JSON.stringify({ nodeId, task })
    }));

    console.log(`Task ${task.id} assigned to ${nodeId}`);
  }

  private async completeTask(taskId: string, result: any, nodeId: string) {
    const task = await this.getTask(taskId);
    if (!task) return;

    task.status = 'done';
    task.result = result;
    task.completedAt = Date.now();
    await this.ctx.storage.put(`task:${task.id}`, task);

    // Update processing queue
    const processing = (await this.ctx.storage.get<string[]>("queue:processing")) || [];
    await this.ctx.storage.put("queue:processing", processing.filter(id => id !== taskId));

    console.log(`Task ${taskId} completed by ${nodeId}`);

    // If there's a callback URL, we should trigger it (Phase 2)

    // Try to assign the next pending task
    await this.tryAssignAll();
  }

  async alarm(): Promise<void> {
    await this.checkTimeouts();
    
    // Set next alarm if there are pending or processing tasks
    const pending = await this.getPending();
    const processing = (await this.ctx.storage.get<string[]>("queue:processing")) || [];
    if (pending.length > 0 || processing.length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 10000);
    }
  }

  private async checkTimeouts(): Promise<void> {
    const processingIds = (await this.ctx.storage.get<string[]>("queue:processing")) || [];
    const now = Date.now();

    for (const taskId of processingIds) {
      const task = await this.getTask(taskId);
      if (task && task.assignedAt && now - task.assignedAt > task.timeoutMs) {
        console.log(`Task ${taskId} timed out. Re-queueing...`);
        
        task.status = 'pending';
        task.retryCount++;
        delete task.assignedNodeId;
        delete task.assignedAt;

        if (task.retryCount >= 3) {
          task.status = 'failed';
          task.error = 'Max retries exceeded';
          await this.ctx.storage.put(`task:${task.id}`, task);
          
          // Remove from processing
          const processing = (await this.ctx.storage.get<string[]>("queue:processing")) || [];
          await this.ctx.storage.put("queue:processing", processing.filter(id => id !== taskId));
        } else {
          await this.ctx.storage.put(`task:${task.id}`, task);
          
          // Move from processing to pending
          const processing = (await this.ctx.storage.get<string[]>("queue:processing")) || [];
          await this.ctx.storage.put("queue:processing", processing.filter(id => id !== taskId));
          
          const pending = await this.getPending();
          pending.push(taskId);
          await this.ctx.storage.put("queue:pending", pending);
        }
      }
    }
    
    await this.tryAssignAll();
  }
}
