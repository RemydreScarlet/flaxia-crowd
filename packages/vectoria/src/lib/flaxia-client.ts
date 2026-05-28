import { FlaxiaClient } from "@flaxia/sdk";

let client: FlaxiaClient | null = null;

export function getFlaxiaClient(): FlaxiaClient {
  if (!client) {
    client = new FlaxiaClient({
      apiKey: process.env.FLAXIA_API_KEY || "",
      baseUrl: process.env.FLAXIA_WORKER_URL || "http://localhost:8787/crowd",
    });
  }
  return client;
}

export function chunkText(text: string, maxTokens = 512): string[] {
  const paragraphs = text.split(/\n\n+/);
  const chunks: string[] = [];
  let current = "";

  for (const para of paragraphs) {
    const estimatedTokens = para.length / 3;
    if ((current.length + para.length) / 3 > maxTokens) {
      if (current.trim()) chunks.push(current.trim());
      current = para;
    } else {
      current += (current ? "\n\n" : "") + para;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks;
}

export function computeDocId(url: string): string {
  let hash = 0;
  for (let i = 0; i < url.length; i++) {
    const chr = url.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return (hash >>> 0).toString(16);
}
