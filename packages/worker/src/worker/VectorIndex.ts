import { DurableObject } from "cloudflare:workers";
import type { Env } from "../index";

interface NodeShardInfo {
  nodeId: string;
  rangeStart: number;
  rangeEnd: number;
  vectorCount: number;
  lastHeartbeat: number;
}

interface ShardAssignment {
  rangeStart: number;
  rangeEnd: number;
  nodeIds: string[];
}

const TOTAL_SHARDS = 65536;

export class VectorIndex extends DurableObject<Env> {
  private shards = new Map<string, ShardAssignment>();
  private nodes = new Map<string, NodeShardInfo>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/register-storage-node") {
      const { nodeId } = await request.json() as { nodeId: string };
      const result = await this.registerStorageNode(nodeId);
      return Response.json(result);
    }

    if (url.pathname === "/unregister-storage-node") {
      const { nodeId } = await request.json() as { nodeId: string };
      await this.unregisterStorageNode(nodeId);
      return new Response("OK");
    }

    if (url.pathname === "/query-nodes") {
      const nodes = Array.from(this.nodes.values());
      return Response.json({ nodes });
    }

    if (url.pathname === "/get-shard") {
      const { shardKey } = await request.json() as { shardKey: string };
      const assignment = this.getShardAssignment(parseInt(shardKey, 10));
      return Response.json({ assignment });
    }

    if (url.pathname === "/stats") {
      const aliveNodes = Array.from(this.nodes.values())
        .filter(n => Date.now() - n.lastHeartbeat < 120000);
      const totalVectors = aliveNodes.reduce((sum, n) => sum + n.vectorCount, 0);
      return Response.json({
        totalNodes: this.nodes.size,
        aliveNodes: aliveNodes.length,
        totalVectors,
        totalShards: TOTAL_SHARDS,
        coveredShards: aliveNodes.length > 0 ? TOTAL_SHARDS : 0,
        replicationFactor: aliveNodes.length > 0 ?
          (aliveNodes.reduce((s, n) => s + 1, 0) / Math.max(1, aliveNodes.length)) : 0,
      });
    }

    if (url.pathname === "/heartbeat") {
      const { nodeId, vectorCount } = await request.json() as { nodeId: string; vectorCount: number };
      const node = this.nodes.get(nodeId);
      if (node) {
        node.lastHeartbeat = Date.now();
        node.vectorCount = vectorCount;
        this.nodes.set(nodeId, node);
      }
      return new Response("OK");
    }

    return new Response("Not Found", { status: 404 });
  }

  private async registerStorageNode(nodeId: string): Promise<{ rangeStart: number; rangeEnd: number }> {
    const nodeCount = this.nodes.size + 1;
    const shardSize = Math.floor(TOTAL_SHARDS / nodeCount);

    const nodeIndex = this.nodes.size;
    const rangeStart = nodeIndex * shardSize;
    const rangeEnd = (nodeIndex + 1) * shardSize - 1;

    this.nodes.set(nodeId, {
      nodeId,
      rangeStart,
      rangeEnd,
      vectorCount: 0,
      lastHeartbeat: Date.now(),
    });

    await this.ctx.storage.put(`node:${nodeId}`, this.nodes.get(nodeId));

    return { rangeStart, rangeEnd };
  }

  private async unregisterStorageNode(nodeId: string): Promise<void> {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    this.nodes.delete(nodeId);
    await this.ctx.storage.delete(`node:${nodeId}`);

    const remainingNodes = Array.from(this.nodes.values())
      .filter(n => Date.now() - n.lastHeartbeat < 120000);

    if (remainingNodes.length === 0) return;

    const shardSize = Math.floor(TOTAL_SHARDS / remainingNodes.length);
    for (let i = 0; i < remainingNodes.length; i++) {
      const n = remainingNodes[i];
      n.rangeStart = i * shardSize;
      n.rangeEnd = (i + 1) * shardSize - 1;
      this.nodes.set(n.nodeId, n);
      await this.ctx.storage.put(`node:${n.nodeId}`, n);
    }
  }

  private getShardAssignment(shardKey: number): ShardAssignment | null {
    const aliveNodes = Array.from(this.nodes.values())
      .filter(n => Date.now() - n.lastHeartbeat < 120000);

    for (const node of aliveNodes) {
      if (shardKey >= node.rangeStart && shardKey <= node.rangeEnd) {
        return {
          rangeStart: node.rangeStart,
          rangeEnd: node.rangeEnd,
          nodeIds: [node.nodeId],
        };
      }
    }

    return null;
  }
}
