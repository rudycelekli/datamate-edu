import { NextResponse } from "next/server";
import { getStatus, forceRefresh, ensureReady } from "@/lib/pipeline-cache";

export async function GET() {
  // Trigger warmup if cold (non-blocking for status check)
  ensureReady();

  return NextResponse.json(getStatus());
}

export async function POST() {
  try {
    await forceRefresh();
    return NextResponse.json(getStatus());
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Refresh failed";
    return NextResponse.json({ error: message, ...getStatus() }, { status: 500 });
  }
}
