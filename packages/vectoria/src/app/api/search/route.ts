import { NextRequest, NextResponse } from "next/server";
import { getFlaxiaClient } from "@/lib/flaxia-client";
import type { VectorEmbedResult, VectorQueryResult } from "@flaxia/sdk";

export async function POST(request: NextRequest) {
  const { q, topK = 10 } = await request.json();

  if (!q || typeof q !== "string") {
    return NextResponse.json({ error: "query is required" }, { status: 400 });
  }

  try {
    const client = getFlaxiaClient();
    const orchestratorUrl = process.env.FLAXIA_WORKER_URL || "http://localhost:8787/crowd";

    const embedTask = await client.submit({
      workload: "vector-embed",
      payload: { text: q },
    });

    const embedResult = await client.waitForTask(embedTask.id, 1000, 30000);

    if (embedResult.status === "failed") {
      return NextResponse.json(
        { error: embedResult.error || "Embedding failed" },
        { status: 503 },
      );
    }

    const { vector } = embedResult.result as VectorEmbedResult;

    const queryResponse = await fetch(`${orchestratorUrl}/query`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ queryVector: vector, topK }),
    });

    if (!queryResponse.ok) {
      const body = await queryResponse.text();
      return NextResponse.json(
        { error: body || "Query failed" },
        { status: queryResponse.status as 503 },
      );
    }

    const data = await queryResponse.json() as {
      results: VectorQueryResult["results"];
      totalNodes: number;
      totalResults: number;
    };

    return NextResponse.json({
      query: q,
      totalResults: data.totalResults || data.results.length,
      searchDurationMs: 0,
      results: data.results,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Search failed" },
      { status: 503 },
    );
  }
}
