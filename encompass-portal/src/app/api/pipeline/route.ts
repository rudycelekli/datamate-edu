import { NextRequest, NextResponse } from "next/server";
import { searchPipeline } from "@/lib/encompass";

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const all = searchParams.get("all") === "true";
    const search = searchParams.get("search") || undefined;
    const folder = searchParams.get("folder") || undefined;

    if (all) {
      // Fetch all loans by paginating through results
      const batchSize = 500;
      const allRows: unknown[] = [];
      let start = 0;
      let hasMore = true;

      while (hasMore) {
        const batch = await searchPipeline(start, batchSize, search, folder);
        const rows = Array.isArray(batch) ? batch : [];
        allRows.push(...rows);
        start += batchSize;
        hasMore = rows.length === batchSize;
      }

      return NextResponse.json(allRows);
    }

    // Standard paginated mode
    const start = parseInt(searchParams.get("start") || "0");
    const limit = parseInt(searchParams.get("limit") || "50");
    const rows = await searchPipeline(start, limit, search, folder);
    return NextResponse.json(rows);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
