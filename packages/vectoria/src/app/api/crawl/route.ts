import { NextRequest, NextResponse } from "next/server";
import { getFlaxiaClient, computeDocId, chunkText } from "@/lib/flaxia-client";
import type { WebCrawlResult, VectorEmbedResult } from "@flaxia/sdk";

export async function POST(request: NextRequest) {
  const { url, maxDepth = 0, extractSelectors, respectRobotsTxt = true } = await request.json();

  if (!url) {
    return NextResponse.json({ error: "url is required" }, { status: 400 });
  }

  const startTime = Date.now();

  try {
    const client = getFlaxiaClient();

    const crawlTask = await client.submit({
      workload: "web-crawl",
      payload: { url, maxDepth, extractSelectors, respectRobotsTxt },
    });

    const crawlResult = await client.waitForTask(crawlTask.id, 1000, 60000);

    if (crawlResult.status === "failed") {
      return NextResponse.json(
        { error: crawlResult.error || "Crawl failed" },
        { status: 503 },
      );
    }

    const { title, content, links } = crawlResult.result as WebCrawlResult;

    if (!content) {
      return NextResponse.json({
        crawled: true,
        url,
        title,
        linksFound: links.length,
        indexedChunks: 0,
        totalDurationMs: Date.now() - startTime,
        warning: "No content extracted",
      });
    }

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

    return NextResponse.json({
      crawled: true,
      url,
      title,
      linksFound: links.length,
      indexedChunks: chunks.length,
      totalDurationMs: Date.now() - startTime,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Crawl failed" },
      { status: 503 },
    );
  }
}
