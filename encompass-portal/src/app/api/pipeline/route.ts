import { NextRequest, NextResponse } from "next/server";
import { searchPipeline } from "@/lib/encompass";
import {
  ensureReady,
  queryPipeline,
  getCompactRows,
  getStatus,
} from "@/lib/pipeline-cache";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const compact = searchParams.get("compact") === "true";
    const all = searchParams.get("all") === "true";

    // Try to use cache (non-blocking: returns true only if ready NOW)
    const ready = ensureReady();

    // ── Compact mode: stripped-down rows for Intelligence page ──
    if (compact && all) {
      if (!ready) {
        // Fallback: fetch directly (limited)
        const batch = await searchPipeline(0, 500);
        return NextResponse.json(Array.isArray(batch) ? batch : []);
      }
      const result = getCompactRows();
      return NextResponse.json(result);
    }

    // ── Legacy all-rows mode (backward compat during transition) ──
    if (all && !compact) {
      if (!ready) {
        const batchSize = 500;
        const allRows: unknown[] = [];
        let start = 0;
        let hasMore = true;
        while (hasMore) {
          const batch = await searchPipeline(start, batchSize);
          const rows = Array.isArray(batch) ? batch : [];
          allRows.push(...rows);
          start += batchSize;
          hasMore = rows.length === batchSize;
        }
        return NextResponse.json(allRows);
      }
      const result = getCompactRows();
      return NextResponse.json(result);
    }

    // ── Cache-backed paginated pipeline query ──
    if (ready) {
      const page = parseInt(searchParams.get("page") || "0");
      const pageSize = parseInt(searchParams.get("pageSize") || "50");
      const search = searchParams.get("search") || undefined;
      const sortField = searchParams.get("sortField") || "modified";
      const sortDir = (searchParams.get("sortDir") || "desc") as "asc" | "desc";
      const milestone = searchParams.get("milestone") || undefined;
      const lo = searchParams.get("lo") || undefined;
      const state = searchParams.get("state") || undefined;
      const purpose = searchParams.get("purpose") || undefined;
      const lock = searchParams.get("lock") || undefined;
      const program = searchParams.get("program") || undefined;
      const amountMin = searchParams.get("amountMin") ? parseFloat(searchParams.get("amountMin")!) : undefined;
      const amountMax = searchParams.get("amountMax") ? parseFloat(searchParams.get("amountMax")!) : undefined;
      const rateMin = searchParams.get("rateMin") ? parseFloat(searchParams.get("rateMin")!) : undefined;
      const rateMax = searchParams.get("rateMax") ? parseFloat(searchParams.get("rateMax")!) : undefined;
      const dateFrom = searchParams.get("dateFrom") || undefined;
      const dateTo = searchParams.get("dateTo") || undefined;

      const result = queryPipeline({
        page, pageSize, search, sortField, sortDir,
        milestone, lo, state, purpose, lock, program,
        amountMin, amountMax, rateMin, rateMax,
        dateFrom, dateTo,
      });

      // Signal if warmup is still loading more data
      const status = getStatus();
      const stillWarming = status.loadedSoFar > status.totalRows;
      return NextResponse.json({
        ...result,
        ...(stillWarming ? { _warming: true, _loadedSoFar: status.loadedSoFar } : {}),
      });
    }

    // ── Fallback: direct Encompass query during warmup ──
    const page = parseInt(searchParams.get("page") || "0");
    const pageSize = parseInt(searchParams.get("pageSize") || "50");
    const search = searchParams.get("search") || undefined;
    const folder = searchParams.get("folder") || undefined;
    // Fetch 500 most recent loans during warmup so users see data immediately
    const warmupSize = 500;
    const rows = await searchPipeline(0, warmupSize, search, folder);

    // Server-side paginate the 500 warmup rows
    const allWarmup = Array.isArray(rows) ? rows : [];
    const start = page * pageSize;
    const pageRows = allWarmup.slice(start, start + pageSize);

    const status = getStatus();
    return NextResponse.json({
      rows: pageRows,
      total: allWarmup.length,
      totalVolume: allWarmup.reduce((s, r) => s + (parseFloat((r as { fields?: Record<string, string> }).fields?.["Loan.LoanAmount"] || "0") || 0), 0),
      page,
      pageSize,
      cacheAge: 0,
      filterOptions: { milestones: [], los: [], states: [], purposes: [], locks: [], programs: [] },
      _warming: true,
      _loadedSoFar: status.loadedSoFar,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
