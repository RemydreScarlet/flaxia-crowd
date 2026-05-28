import { NextRequest, NextResponse } from "next/server";
import { getFlaxiaClient, computeDocId, chunkText } from "@/lib/flaxia-client";
import type { WebCrawlResult, VectorEmbedResult, VectorStoreResult } from "@flaxia/sdk";

export async function POST(request: NextRequest) {
  const { url, title, content } = await request.json();

  if (!url || !content) {
    return NextResponse.json(
      { error: "url and content are required" },
      { status: 400 },
    );
  }

  const startTime = Date.now();

  try {
    const client = getFlaxiaClient();
    const docId = computeDocId(url);
    const chunks = chunkText(content);

    for (let i = 0; i < chunks.length; i++) {
      const embedTask = await client.submit({
        workload: "vector-embed",
        payload: { text: chunks[i], docId, chunkIndex: i },
      });
      const embedResult = await client.waitForTask(embedTask.id, 1000, 30000);

      if (embedResult.status === "failed") {
        console.error(`Embedding chunk ${i} failed:`, embedResult.error);
        continue;
      }

      const { vector } = embedResult.result as VectorEmbedResult;
      const shardKey = (parseInt(docId, 16) % 65536).toString();

      await client.submit({
        workload: "vector-store",
        payload: {
          docId: `${docId}:${i}`,
          vector,
          metadata: {
            title: title || url,
            url,
            snippet: chunks[i].slice(0, 200),
          },
          shardKey,
        },
      });
    }

    return NextResponse.json({
      indexed: true,
      docId,
      chunks: chunks.length,
      indexDurationMs: Date.now() - startTime,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Indexing failed" },
      { status: 503 },
    );
  }
}

export async function DELETE(request: NextRequest) {
  const { url } = await request.json();

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  try {
    const docId = computeDocId(url);
    return NextResponse.json({ deleted: true, docId });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Delete failed" },
      { status: 503 },
    );
  }
}
