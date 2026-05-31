import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";
import type { TaskRecord, WorkloadType } from "@flaxia/sdk";

interface NodeRecord {
  id: string;
  status: "idle" | "busy";
  capabilities: WorkloadType[];
  cpuLoad: number;
  lastPongAt: number;
  currentTaskId?: string;
}

export class Coordinator extends DurableObject<Env> {
  private pendingCache: string[] | null = null;
  private processingCache: string[] | null = null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/ws") {
      return this.handleWebSocket(request, url);
    }

    if (url.pathname === "/subscribe") {
      return this.handleSubscribe(request, url);
    }

    if (url.pathname === "/enqueue") {
      return this.handleEnqueue(request);
    }

    if (url.pathname.startsWith("/task/")) {
      const taskId = url.pathname.slice(6);
      const task = await this.ctx.storage.get<TaskRecord>(`task:${taskId}`);
      if (!task) return new Response("Not found", { status: 404 });
      return Response.json(task);
    }

    if (url.pathname === "/assign-next") {
      await this.tryAssignAll();
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  }

  // --- WebSocket: Node signaling ---

  private async handleWebSocket(request: Request, url: URL): Promise<Response> {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);

    const nodeId = url.searchParams.get("nodeId") || crypto.randomUUID();
    const capabilities = (url.searchParams.get("capabilities") || "").split(",").filter(Boolean) as WorkloadType[];

    this.ctx.acceptWebSocket(server, [nodeId]);

    for (const sock of this.ctx.getWebSockets(nodeId)) {
      if (sock === server) continue;
      try { sock.close(); } catch {}
    }

    const node: NodeRecord = {
      id: nodeId,
      status: "idle",
      capabilities,
      cpuLoad: 0,
      lastPongAt: Date.now(),
    };

    await this.ctx.storage.put(`node:${nodeId}`, node);

    const idleNodes = await this.getIdleNodes();
    if (!idleNodes.includes(nodeId)) {
      idleNodes.push(nodeId);
      await this.ctx.storage.put("nodes:idle", idleNodes);
    }

    await this.tryAssignAll();

    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const tags = this.ctx.getTags(ws);
    const nodeId = tags[0];

    if (!nodeId || nodeId.startsWith("client:")) return;

    try {
      const data = JSON.parse(message as string);

      if (data.type === "pong") {
        const node = await this.ctx.storage.get<NodeRecord>(`node:${nodeId}`);
        if (node) {
          node.lastPongAt = Date.now();
          node.cpuLoad = data.cpuLoad || 0;
          await this.ctx.storage.put(`node:${nodeId}`, node);
        }
        return;
      }

      if (data.type === "result" || data.type === "error") {
        const isError = data.type === "error";
        const taskId = data.taskId;

        if (isError) {
          await this.failTask(taskId, data.error || "Node error");
        } else {
          await this.completeTask(taskId, data.payload, nodeId);
        }

        const node = await this.ctx.storage.get<NodeRecord>(`node:${nodeId}`);
        if (node) {
          node.status = "idle";
          node.currentTaskId = undefined;
          await this.ctx.storage.put(`node:${nodeId}`, node);
          const idleNodes = await this.getIdleNodes();
          if (!idleNodes.includes(nodeId)) {
            idleNodes.push(nodeId);
            await this.ctx.storage.put("nodes:idle", idleNodes);
          }
        }

        await this.tryAssignAll();
        return;
      }

      if (data.type === "progress") {
        const subs = this.ctx.getWebSockets(`client:${data.taskId}`);
        const msg = JSON.stringify({ type: "token", token: data.token });
        for (const ws of subs) {
          try { ws.send(msg); } catch {}
        }
        return;
      }
    } catch {}
  }

  async webSocketClose(ws: WebSocket) {
    const tags = this.ctx.getTags(ws);
    const tag = tags[0];
    if (!tag) return;

    if (tag.startsWith("client:")) return;

    const otherSockets = this.ctx.getWebSockets(tag).filter(s => s !== ws);
    if (otherSockets.length > 0) return;

    const node = await this.ctx.storage.get<NodeRecord>(`node:${tag}`);
    if (node?.currentTaskId) {
      await this.failTask(node.currentTaskId, "Node disconnected");
    }

    await this.ctx.storage.delete(`node:${tag}`);
    const idleNodes = await this.getIdleNodes();
    await this.ctx.storage.put("nodes:idle", idleNodes.filter(id => id !== tag));

    await this.tryAssignAll();
  }

  // --- WebSocket: Subscriber ---

  private async handleSubscribe(request: Request, url: URL): Promise<Response> {
    const taskId = url.searchParams.get("taskId");
    if (!taskId) return new Response("taskId is required", { status: 400 });

    const existing = await this.ctx.storage.get<TaskRecord>(`task:${taskId}`);
    if (existing?.status === "done" || existing?.status === "failed") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);
      server.accept();
      const msg = existing.status === "done"
        ? { type: "done", result: existing.result }
        : { type: "error", error: existing.error };
      server.send(JSON.stringify(msg));
      server.close();
      return new Response(null, { status: 101, webSocket: client });
    }

    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    this.ctx.acceptWebSocket(server, [`client:${taskId}`]);
    server.send(JSON.stringify({ type: "subscribed", taskId }));
    return new Response(null, { status: 101, webSocket: client });
  }

  // --- Task management ---

  private async handleEnqueue(request: Request): Promise<Response> {
    const body = await request.json() as TaskRecord;

    await this.ctx.storage.put(`task:${body.id}`, body);

    const pending = await this.getPending();
    pending.push(body.id);
    this.pendingCache = pending;
    await this.ctx.storage.put("queue:pending", pending);

    await this.tryAssignAll();

    const alarm = await this.ctx.storage.getAlarm();
    if (!alarm || alarm > Date.now() + body.timeoutMs) {
      await this.ctx.storage.setAlarm(Date.now() + Math.min(body.timeoutMs, 30000));
    }

    return Response.json({ message: "Task submitted", taskId: body.id });
  }

  private async completeTask(taskId: string, result: unknown, nodeId: string) {
    const task = await this.ctx.storage.get<TaskRecord>(`task:${taskId}`);
    if (!task || task.status !== "processing") return;
    task.status = "done";
    task.result = result;
    task.completedAt = Date.now();
    task.assignedNodeId = nodeId;
    await this.ctx.storage.put(`task:${taskId}`, task);

    const processing = await this.getProcessing();
    this.processingCache = processing.filter(id => id !== taskId);
    await this.ctx.storage.put("queue:processing", this.processingCache);

    const subs = this.ctx.getWebSockets(`client:${taskId}`);
    const msg = JSON.stringify({ type: "done", result });
    for (const ws of subs) {
      try { ws.send(msg); ws.close(); } catch {}
    }
  }

  private async failTask(taskId: string, error: string) {
    const task = await this.ctx.storage.get<TaskRecord>(`task:${taskId}`);
    if (!task || (task.status !== "pending" && task.status !== "processing")) return;
    task.status = "failed";
    task.error = error;
    task.completedAt = Date.now();
    await this.ctx.storage.put(`task:${taskId}`, task);

    // Remove from pending or processing
    if (task.assignedNodeId) {
      const processing = await this.getProcessing();
      this.processingCache = processing.filter(id => id !== taskId);
      await this.ctx.storage.put("queue:processing", this.processingCache);
    } else {
      const pending = await this.getPending();
      this.pendingCache = pending.filter(id => id !== taskId);
      await this.ctx.storage.put("queue:pending", this.pendingCache);
    }

    const subs = this.ctx.getWebSockets(`client:${taskId}`);
    const msg = JSON.stringify({ type: "error", error });
    for (const ws of subs) {
      try { ws.send(msg); ws.close(); } catch {}
    }
  }

  private async tryAssignAll() {
    const pendingIds = await this.getPending();
    if (pendingIds.length === 0) return;

    const idleNodes = await this.getIdleNodes();
    if (idleNodes.length === 0) return;

    for (const taskId of [...pendingIds]) {
      const task = await this.ctx.storage.get<TaskRecord>(`task:${taskId}`);
      if (!task || task.status !== "pending") continue;

      let chosenNode: string | null = null;
      let bestLoad = Infinity;

      for (const nodeId of idleNodes) {
        if (chosenNode) break;
        const node = await this.ctx.storage.get<NodeRecord>(`node:${nodeId}`);
        if (!node || node.status !== "idle") continue;
        if (!node.capabilities.includes(task.workload as WorkloadType)) continue;
        const sockets = this.ctx.getWebSockets(nodeId);
        if (sockets.length === 0) continue;
        if (node.cpuLoad < bestLoad) {
          chosenNode = nodeId;
          bestLoad = node.cpuLoad;
        }
      }

      if (!chosenNode) break;

      task.status = "processing";
      task.assignedNodeId = chosenNode;
      task.assignedAt = Date.now();
      await this.ctx.storage.put(`task:${taskId}`, task);

      this.pendingCache = pendingIds.filter(id => id !== taskId);
      await this.ctx.storage.put("queue:pending", this.pendingCache);

      const processing = await this.getProcessing();
      this.processingCache = processing;
      this.processingCache.push(taskId);
      await this.ctx.storage.put("queue:processing", this.processingCache);

      const node = await this.ctx.storage.get<NodeRecord>(`node:${chosenNode}`);
      if (node) {
        node.status = "busy";
        node.currentTaskId = taskId;
        await this.ctx.storage.put(`node:${chosenNode}`, node);
        await this.ctx.storage.put("nodes:idle", idleNodes.filter(id => id !== chosenNode));
      }

      const sockets = this.ctx.getWebSockets(chosenNode);
      for (const sock of sockets) {
        try {
          sock.send(JSON.stringify({
            type: "task",
            taskId: task.id,
            workload: task.workload,
            payload: task.payload
          }));
          break;
        } catch {}
      }
    }
  }

  async alarm() {
    const processingIds = await this.getProcessing();
    const now = Date.now();

    for (const taskId of processingIds) {
      const task = await this.ctx.storage.get<TaskRecord>(`task:${taskId}`);
      if (task && task.assignedAt && now - task.assignedAt > (task.timeoutMs || 30000)) {
        await this.failTask(taskId, "Task timed out");
      }
    }

    const idleNodes = await this.getIdleNodes();
    for (const nodeId of idleNodes) {
      const node = await this.ctx.storage.get<NodeRecord>(`node:${nodeId}`);
      if (node && now - node.lastPongAt > 60000) {
        await this.ctx.storage.delete(`node:${nodeId}`);
        await this.ctx.storage.put("nodes:idle", idleNodes.filter(id => id !== nodeId));
      }
    }

    const pending = await this.getPending();
    const processing = await this.getProcessing();
    if (pending.length > 0 || processing.length > 0) {
      await this.ctx.storage.setAlarm(Date.now() + 30000);
    }
  }

  // --- Helpers ---

  private async getPending(): Promise<string[]> {
    if (this.pendingCache) return this.pendingCache;
    this.pendingCache = (await this.ctx.storage.get<string[]>("queue:pending")) || [];
    return this.pendingCache;
  }

  private async getProcessing(): Promise<string[]> {
    if (this.processingCache) return this.processingCache;
    this.processingCache = (await this.ctx.storage.get<string[]>("queue:processing")) || [];
    return this.processingCache;
  }

  private async getIdleNodes(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>("nodes:idle")) || [];
  }
}
