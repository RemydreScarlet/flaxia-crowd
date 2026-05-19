import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";
import type { WorkloadType, TaskRecord } from "@flaxia/sdk";

export type NodeStatus = 'idle' | 'busy' | 'disconnected';

export interface NodeRecord {
  id: string;
  status: NodeStatus;
  connectedAt: number;
  lastPongAt: number;
  capabilities: WorkloadType[];
  cpuLoad: number;
  currentTaskId?: string;
}

export class NodeManager extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const nodeId = url.searchParams.get("nodeId") || crypto.randomUUID();
      const capabilities = (url.searchParams.get("capabilities") || "").split(",") as WorkloadType[];

      await this.registerNode(server, nodeId, capabilities);

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/pick") {
      const workload = url.searchParams.get("workload") as WorkloadType;
      const nodeId = await this.pickNode(workload);
      return Response.json({ nodeId });
    }

    if (url.pathname === "/assign") {
      const { nodeId, task } = await request.json() as any;
      await this.assignTask(nodeId, task);
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  }

  async registerNode(ws: WebSocket, nodeId: string, capabilities: WorkloadType[]) {
    this.ctx.acceptWebSocket(ws, [nodeId]);

    const node: NodeRecord = {
      id: nodeId,
      status: 'idle',
      connectedAt: Date.now(),
      lastPongAt: Date.now(),
      capabilities,
      cpuLoad: 0,
    };

    await this.ctx.storage.put(`node:${nodeId}`, node);
    
    // Add to idle list
    const idleNodes = await this.getIdleNodes();
    if (!idleNodes.includes(nodeId)) {
      idleNodes.push(nodeId);
      await this.ctx.storage.put("nodes:idle", idleNodes);
    }

    console.log(`Node registered: ${nodeId} with capabilities: ${capabilities}`);
  }

  async getIdleNodes(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>("nodes:idle")) || [];
  }

  async pickNode(workload: WorkloadType): Promise<string | undefined> {
    const idleNodeIds = await this.getIdleNodes();
    const nodes = await Promise.all(idleNodeIds.map(id => this.ctx.storage.get<NodeRecord>(`node:${id}`)));
    
    const candidates = nodes
      .filter((n): n is NodeRecord => !!n && n.capabilities.includes(workload))
      .sort((a, b) => a.cpuLoad - b.cpuLoad || a.connectedAt - b.connectedAt);

    return candidates[0]?.id;
  }

  async assignTask(nodeId: string, task: TaskRecord): Promise<void> {
    const ws = this.ctx.getWebSockets(nodeId)[0];
    if (!ws) throw new Error(`WebSocket for node ${nodeId} not found`);

    const node = await this.ctx.storage.get<NodeRecord>(`node:${nodeId}`);
    if (node) {
      node.status = 'busy';
      node.currentTaskId = task.id;
      await this.ctx.storage.put(`node:${nodeId}`, node);
      
      // Remove from idle list
      const idleNodes = await this.getIdleNodes();
      await this.ctx.storage.put("nodes:idle", idleNodes.filter(id => id !== nodeId));
    }

    ws.send(JSON.stringify({
      type: 'task',
      taskId: task.id,
      workload: task.workload,
      payload: task.payload
    }));
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const nodeId = this.ctx.getTags(ws)[0];
    const data = JSON.parse(message as string);

    if (data.type === 'pong') {
      const node = await this.ctx.storage.get<NodeRecord>(`node:${nodeId}`);
      if (node) {
        node.lastPongAt = Date.now();
        node.cpuLoad = data.cpuLoad || 0;
        await this.ctx.storage.put(`node:${nodeId}`, node);
      }
    } else if (data.type === 'result') {
      // Handle result - notify TaskQueue
      const taskQueueId = this.env.TASK_QUEUE.idFromName("global-queue");
      const taskQueue = this.env.TASK_QUEUE.get(taskQueueId);
      
      // Use RPC if available, or fetch
      // For now, let's assume we can fetch or use a internal method if they were in the same DO, 
      // but they are separate. We can use stub.fetch.
      await taskQueue.fetch(new Request("http://internal/complete", {
        method: "POST",
        body: JSON.stringify({
          taskId: data.taskId,
          result: data.payload,
          nodeId
        })
      }));

      // Mark node as idle again
      const node = await this.ctx.storage.get<NodeRecord>(`node:${nodeId}`);
      if (node) {
        node.status = 'idle';
        delete node.currentTaskId;
        await this.ctx.storage.put(`node:${nodeId}`, node);
        
        const idleNodes = await this.getIdleNodes();
        if (!idleNodes.includes(nodeId)) {
          idleNodes.push(nodeId);
          await this.ctx.storage.put("nodes:idle", idleNodes);
        }
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    const nodeId = this.ctx.getTags(ws)[0];
    await this.unregisterNode(nodeId);
  }

  async unregisterNode(nodeId: string) {
    await this.ctx.storage.delete(`node:${nodeId}`);
    const idleNodes = await this.getIdleNodes();
    await this.ctx.storage.put("nodes:idle", idleNodes.filter(id => id !== nodeId));
    console.log(`Node unregistered: ${nodeId}`);
  }

  async alarm() {
    // Ping all and check stale nodes
    const websockets = this.ctx.getWebSockets();
    for (const ws of websockets) {
      ws.send(JSON.stringify({ type: 'ping' }));
    }

    const now = Date.now();
    const idleNodeIds = await this.getIdleNodes();
    for (const id of idleNodeIds) {
      const node = await this.ctx.storage.get<NodeRecord>(`node:${id}`);
      if (node && now - node.lastPongAt > 60000) {
        await this.unregisterNode(id);
      }
    }

    await this.ctx.storage.setAlarm(Date.now() + 30000);
  }
}
