import { NextRequest, NextResponse } from "next/server";
import { queryPipeline, getCompactRows } from "@/lib/supabase-queries";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const compact = searchParams.get("compact") === "true";
    const all = searchParams.get("all") === "true";

    // ── Compact mode: stripped-down rows for Intelligence page ──
    if (compact && all) {
      const result = await getCompactRows();
      return NextResponse.json(result);
    }

    // ── Legacy all-rows mode ──
    if (all && !compact) {
      const result = await getCompactRows();
      return NextResponse.json(result);
    }

    // ── Paginated pipeline query ──
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

    const result = await queryPipeline({
      page, pageSize, search, sortField, sortDir,
      milestone, lo, state, purpose, lock, program,
      amountMin, amountMax, rateMin, rateMax,
      dateFrom, dateTo,
    });

    return NextResponse.json(result);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
