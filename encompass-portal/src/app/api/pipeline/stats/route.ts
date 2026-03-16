import { NextRequest, NextResponse } from "next/server";
import { getStatus, triggerSync } from "@/lib/supabase-queries";

const STALE_MS = 5 * 60_000; // 5 minutes
let _lastAutoSync = 0;
const AUTO_SYNC_COOLDOWN = 4 * 60_000; // Don't auto-trigger more than once per 4 min

export async function GET(req: NextRequest) {
  const status = await getStatus();

  // Auto-trigger sync if data is stale and we haven't recently triggered
  const now = Date.now();
  const lastRefreshMs = status.lastRefresh
    ? new Date(status.lastRefresh).getTime()
    : 0;
  const isStale = now - lastRefreshMs > STALE_MS;
  const cooldownOk = now - _lastAutoSync > AUTO_SYNC_COOLDOWN;
  const notAlreadySyncing = status.state !== "syncing";

  if (isStale && cooldownOk && notAlreadySyncing && status.totalRows > 0) {
    _lastAutoSync = now;
    // Fire-and-forget: trigger sync in background
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost:3000";
    const baseUrl = `${proto}://${host}`;
    triggerSync(baseUrl).catch(() => {});
  }

  return NextResponse.json(status);
}

export async function POST(req: NextRequest) {
  try {
    // Trigger immediate sync via cron endpoint
    const proto = req.headers.get("x-forwarded-proto") || "http";
    const host = req.headers.get("host") || "localhost:3000";
    const baseUrl = `${proto}://${host}`;
    await triggerSync(baseUrl);
    const status = await getStatus();
    return NextResponse.json(status);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Refresh failed";
    const status = await getStatus();
    return NextResponse.json({ error: message, ...status }, { status: 500 });
  }
}
