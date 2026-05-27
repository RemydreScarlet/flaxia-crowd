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

interface WsMessage {
  type: 'pong' | 'result' | 'error' | 'progress';
  taskId?: string;
  payload?: unknown;
  cpuLoad?: number;
  error?: string;
  token?: string;
}

export class NodeManager extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/ws" || url.pathname === "/crowd/signal") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const nodeId = url.searchParams.get("nodeId") || crypto.randomUUID();
      const capabilities = (url.searchParams.get("capabilities") || "").split(",").filter(Boolean) as WorkloadType[];

      await this.registerNode(server, nodeId, capabilities);

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/subscribe") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      const taskId = url.searchParams.get("taskId");
      if (!taskId) return new Response("taskId is required", { status: 400 });

      this.ctx.acceptWebSocket(server, [`client:${taskId}`]);

      server.send(JSON.stringify({ type: 'subscribed', taskId }));

      return new Response(null, { status: 101, webSocket: client });
    }

    if (url.pathname === "/pick") {
      const workload = url.searchParams.get("workload") as WorkloadType;
      const nodeId = await this.pickNode(workload);
      return Response.json({ nodeId });
    }

    if (url.pathname === "/assign") {
      const { nodeId, task } = await request.json() as { nodeId: string; task: TaskRecord };
      await this.assignTask(nodeId, task);
      return new Response("OK");
    }

    if (url.pathname === "/nodes") {
      const nodes = await this.getAllNodes();
      return Response.json({ nodes });
    }

    return new Response("Not Found", { status: 404 });
  }

  async registerNode(ws: WebSocket, nodeId: string, capabilities: WorkloadType[]) {
    console.log(`[NodeManager] registerNode: ${nodeId}`, { capabilities });
    this.ctx.acceptWebSocket(ws, [nodeId]);

    for (const sock of this.ctx.getWebSockets(nodeId)) {
      if (sock === ws) continue;
      try { sock.close(); } catch {}
    }

    console.log(`[NodeManager] WebSockets after accept:`, this.ctx.getWebSockets().length);
    console.log(`[NodeManager] WebSockets tagged ${nodeId}:`, this.ctx.getWebSockets(nodeId).length);

    const node: NodeRecord = {
      id: nodeId,
      status: 'idle',
      connectedAt: Date.now(),
      lastPongAt: Date.now(),
      capabilities,
      cpuLoad: 0,
    };

    await this.ctx.storage.put(`node:${nodeId}`, node);

    const idleNodes = await this.getIdleNodes();
    if (!idleNodes.includes(nodeId)) {
      idleNodes.push(nodeId);
      await this.ctx.storage.put("nodes:idle", idleNodes);
    }
    console.log(`[NodeManager] idle list after register:`, idleNodes);

    const taskQueueId = this.env.TASK_QUEUE.idFromName("global-queue");
    const taskQueue = this.env.TASK_QUEUE.get(taskQueueId);
    try {
      await taskQueue.fetch(new Request("http://internal/assign-next"));
    } catch {
      // TaskQueue might not be ready yet; alarm will retry
    }
  }

  async getIdleNodes(): Promise<string[]> {
    return (await this.ctx.storage.get<string[]>("nodes:idle")) || [];
  }

  async getAllNodes(): Promise<NodeRecord[]> {
    const nodeIds = await this.getNodeIds();
    const nodes = await Promise.all(nodeIds.map(id => this.ctx.storage.get<NodeRecord>(`node:${id}`)));
    return nodes.filter((n): n is NodeRecord => n !== undefined);
  }

  private async getNodeIds(): Promise<string[]> {
    const list = await this.ctx.storage.list<string[]>({ prefix: "node:", limit: 1000 });
    const ids: string[] = [];
    for (const key of list.keys()) {
      const id = key.replace("node:", "");
      if (id !== "idle") ids.push(id);
    }
    return ids;
  }

  async pickNode(workload: WorkloadType): Promise<string | undefined> {
    const idleNodeIds = await this.getIdleNodes();
    console.log(`[NodeManager] pickNode idle list:`, idleNodeIds);
    if (idleNodeIds.length === 0) {
      console.log(`[NodeManager] pickNode: no idle nodes`);
      return undefined;
    }

    const nodes = await Promise.all(
      idleNodeIds.map(id => this.ctx.storage.get<NodeRecord>(`node:${id}`))
    );
    console.log(`[NodeManager] pickNode nodes from storage:`, nodes.map(n => n ? `${n.id} (${n.status}, caps=${n.capabilities})` : 'undefined'));

    const candidates = nodes
      .filter((n): n is NodeRecord =>
        !!n && n.capabilities.includes(workload)
      )
      .filter(n => this.ctx.getWebSockets(n.id).length > 0)
      .sort((a, b) => a.cpuLoad - b.cpuLoad || a.connectedAt - b.connectedAt);

    console.log(`[NodeManager] pickNode candidates for ${workload}:`, candidates.map(n => n.id));

    return candidates[0]?.id;
  }

  async assignTask(nodeId: string, task: TaskRecord): Promise<void> {
    console.log(`[NodeManager] assignTask: node=${nodeId}, task=${task.id}`);

    const sockets = this.ctx.getWebSockets(nodeId);
    let ws: WebSocket | undefined;
    for (const sock of sockets) {
      try {
        sock.send(JSON.stringify({
          type: 'task',
          taskId: task.id,
          workload: task.workload,
          payload: task.payload
        }));
        ws = sock;
        break;
      } catch {}
    }
    if (!ws) throw new Error(`No open WebSocket for node ${nodeId}`);
    console.log(`[NodeManager] assignTask: sent to ws...`);

    const node = await this.ctx.storage.get<NodeRecord>(`node:${nodeId}`);
    if (node) {
      node.status = 'busy';
      node.currentTaskId = task.id;
      await this.ctx.storage.put(`node:${nodeId}`, node);

      const idleNodes = await this.getIdleNodes();
      await this.ctx.storage.put("nodes:idle", idleNodes.filter(id => id !== nodeId));
    }
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer) {
    const nodeId = this.ctx.getTags(ws)[0];
    const data: WsMessage = JSON.parse(message as string);
    console.log(`[NodeManager] webSocketMessage: node=${nodeId}, type=${data.type}`);

    if (data.type === 'pong') {
      const node = await this.ctx.storage.get<NodeRecord>(`node:${nodeId}`);
      if (node) {
        node.lastPongAt = Date.now();
        node.cpuLoad = data.cpuLoad || 0;
        await this.ctx.storage.put(`node:${nodeId}`, node);
      }
    } else if (data.type === 'progress') {
      const taskId = data.taskId;
      const token = data.token;
      if (taskId && token) {
        const clientWss = this.ctx.getWebSockets(`client:${taskId}`);
        for (const ws of clientWss) {
          try { ws.send(JSON.stringify({ type: 'token', token })); } catch {}
        }
      }
    } else if (data.type === 'result' || data.type === 'error') {
      const isError = data.type === 'error';

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

      const taskQueueId = this.env.TASK_QUEUE.idFromName("global-queue");
      const taskQueue = this.env.TASK_QUEUE.get(taskQueueId);

      await taskQueue.fetch(new Request("http://internal/complete", {
        method: "POST",
        body: JSON.stringify({
          taskId: data.taskId,
          result: isError ? null : data.payload,
          nodeId,
          error: isError ? data.error : undefined
        })
      }));

      const clientWss = this.ctx.getWebSockets(`client:${data.taskId}`);
      for (const ws of clientWss) {
        try {
          ws.send(JSON.stringify({ type: isError ? 'error' : 'done', [isError ? 'error' : 'result']: isError ? data.error : data.payload }));
          ws.close();
        } catch {}
      }
    }
  }

  async webSocketClose(ws: WebSocket) {
    const tags = this.ctx.getTags(ws);
    const tag = tags[0];
    if (tag?.startsWith('client:')) return;
    console.log(`[NodeManager] webSocketClose: node=${tag}`);

    const otherSockets = this.ctx.getWebSockets(tag).filter(s => s !== ws);
    if (otherSockets.length > 0) {
      console.log(`[NodeManager] webSocketClose: ${otherSockets.length} other socket(s) remain, skipping unregister`);
      return;
    }

    const node = await this.ctx.storage.get<NodeRecord>(`node:${tag}`);
    if (node?.currentTaskId) {
      const allWebSockets = this.ctx.getWebSockets();
      const hasOtherNode = allWebSockets.some(s => {
        if (s === ws) return false;
        const t = this.ctx.getTags(s)[0];
        return t && !t.startsWith('client:') && t !== tag;
      });

      const taskQueueId = this.env.TASK_QUEUE.idFromName("global-queue");
      const taskQueue = this.env.TASK_QUEUE.get(taskQueueId);

      if (hasOtherNode) {
        console.log(`[NodeManager] webSocketClose: re-queuing task ${node.currentTaskId} (other nodes available)`);
        await taskQueue.fetch(new Request("http://internal/requeue", {
          method: "POST",
          body: JSON.stringify({ taskId: node.currentTaskId, nodeId: tag, error: "Node disconnected" })
        }));
      } else {
        console.log(`[NodeManager] webSocketClose: failing task ${node.currentTaskId} (no other nodes)`);
        await taskQueue.fetch(new Request("http://internal/complete", {
          method: "POST",
          body: JSON.stringify({
            taskId: node.currentTaskId,
            result: null,
            nodeId: tag,
            error: "No available nodes"
          })
        }));

        const clientWss = this.ctx.getWebSockets(`client:${node.currentTaskId}`);
        for (const ws of clientWss) {
          try { ws.send(JSON.stringify({ type: 'error', error: "No available nodes" })); ws.close(); } catch {}
        }
      }
    }

    await this.unregisterNode(tag);
  }

  async unregisterNode(nodeId: string) {
    await this.ctx.storage.delete(`node:${nodeId}`);
    const idleNodes = await this.getIdleNodes();
    await this.ctx.storage.put("nodes:idle", idleNodes.filter(id => id !== nodeId));
  }

  async alarm() {
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
