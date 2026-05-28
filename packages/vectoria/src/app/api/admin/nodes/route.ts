import { NextResponse } from "next/server";

export async function GET() {
  const orchestratorUrl = process.env.FLAXIA_WORKER_URL || "http://localhost:8787/crowd";

  try {
    const resp = await fetch(`${orchestratorUrl}/nodes`);
    const data = await resp.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({ nodes: [] });
  }
}
