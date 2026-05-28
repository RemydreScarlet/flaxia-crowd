import { NextResponse } from "next/server";

export async function GET() {
  const orchestratorUrl = process.env.FLAXIA_WORKER_URL || "http://localhost:8787/crowd";

  try {
    const nodesResp = await fetch(`${orchestratorUrl}/nodes`);
    const nodesData = await nodesResp.json() as { nodes: Array<{ capabilities: string[] }> };

    const nodes = nodesData.nodes || [];
    const totalNodes = nodes.length;
    const storageCapable = nodes.filter((n: { capabilities: string[] }) =>
      n.capabilities.includes("vector-store")
    ).length;
    const crawlCapable = nodes.filter((n: { capabilities: string[] }) =>
      n.capabilities.includes("web-crawl")
    ).length;

    return NextResponse.json({
      totalIndexedDocs: 0,
      totalVectors: 0,
      activeNodes: {
        total: totalNodes,
        storageCapable,
        crawlCapable,
      },
      shards: {
        total: 65536,
        covered: storageCapable > 0 ? 65536 : 0,
        replicationFactor: storageCapable > 0
          ? Math.min(storageCapable, 3) : 0,
      },
    });
  } catch {
    return NextResponse.json({
      totalIndexedDocs: 0,
      totalVectors: 0,
      activeNodes: { total: 0, storageCapable: 0, crawlCapable: 0 },
      shards: { total: 65536, covered: 0, replicationFactor: 0 },
    });
  }
}
