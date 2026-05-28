import { NextRequest, NextResponse } from "next/server";
import { getFlaxiaClient, computeDocId, chunkText } from "@/lib/flaxia-client";
import type { WebCrawlResult, VectorEmbedResult } from "@flaxia/sdk";

export async function POST(request: NextRequest) {
  const { urls, maxDepth = 0 } = await request.json();

  if (!urls || !Array.isArray(urls) || urls.length === 0) {
    return NextResponse.json({ error: "urls array is required" }, { status: 400 });
  }

  try {
    const client = getFlaxiaClient();
    const results: Array<{ url: string; status: string; durationMs: number }> = [];
    let crawled = 0;
    let failed = 0;

    for (const url of urls) {
      const startTime = Date.now();
      try {
        const crawlTask = await client.submit({
          workload: "web-crawl",
          payload: { url, maxDepth },
        });
        const crawlResult = await client.waitForTask(crawlTask.id, 1000, 60000);

        if (crawlResult.status === "failed") {
          failed++;
          results.push({ url, status: "failed", durationMs: Date.now() - startTime });
          continue;
        }

        const { title, content } = crawlResult.result as WebCrawlResult;
        const docId = computeDocId(url);
        const chunks = chunkText(content);

        for (let i = 0; i < chunks.length; i++) {
          const embedTask = await client.submit({
            workload: "vector-embed",
            payload: { text: chunks[i], docId, chunkIndex: i },
          });
          const embedResult = await client.waitForTask(embedTask.id, 1000, 30000);
          if (embedResult.status === "failed") continue;

          const { vector } = embedResult.result as VectorEmbedResult;
          const shardKey = (parseInt(docId, 16) % 65536).toString();

          await client.submit({
            workload: "vector-store",
            payload: {
              docId: `${docId}:${i}`,
              vector,
              metadata: { title, url, snippet: chunks[i].slice(0, 200) },
              shardKey,
            },
          });
        }

        crawled++;
        results.push({ url, status: "indexed", durationMs: Date.now() - startTime });
      } catch {
        failed++;
        results.push({ url, status: "failed", durationMs: Date.now() - startTime });
      }
    }

    return NextResponse.json({ crawled, failed, results });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Batch crawl failed" },
      { status: 503 },
    );
  }
}
