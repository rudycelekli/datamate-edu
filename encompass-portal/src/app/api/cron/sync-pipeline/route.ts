import { NextRequest, NextResponse } from "next/server";
import { searchPipelineWithFilters, PIPELINE_FIELDS } from "@/lib/encompass";
import { encompassFieldsToDbRow } from "@/lib/encompass-to-db";
import { supabaseAdmin } from "@/lib/supabase";

export const maxDuration = 60; // Vercel Pro

interface PipelineRow {
  loanGuid: string;
  fields: Record<string, string>;
}

export async function POST(req: NextRequest) {
  // Verify CRON_SECRET (Vercel sends Authorization: Bearer <secret>)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization");
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const t0 = Date.now();

  try {
    // Update status → syncing
    await supabaseAdmin
      .from("sync_status")
      .upsert({ id: 1, status: "syncing", error_message: null });

    // Delta sync: fetch loans modified in the last 7 minutes (5min interval + 2min overlap)
    const { data: statusRow } = await supabaseAdmin
      .from("sync_status")
      .select("last_sync_at")
      .eq("id", 1)
      .single();

    const lastSync = statusRow?.last_sync_at
      ? new Date(new Date(statusRow.last_sync_at).getTime() - 2 * 60_000)
      : null;

    let allRows: PipelineRow[] = [];

    if (lastSync) {
      // Delta sync: only fetch recently modified loans
      const sinceStr = lastSync.toISOString();
      console.log(`[cron-sync] Delta sync since ${sinceStr}`);

      let offset = 0;
      const batchSize = 500;
      let hasMore = true;

      while (hasMore && allRows.length < 5000) {
        const batch = await searchPipelineWithFilters(
          {
            operator: "and",
            terms: [
              {
                canonicalName: "Loan.LastModified",
                value: sinceStr,
                matchType: "greaterThanOrEquals",
                include: true,
              },
            ],
          },
          [{ canonicalName: "Loan.LastModified", order: "desc" }],
          offset,
          batchSize,
        );

        const rows: PipelineRow[] = Array.isArray(batch) ? batch : [];
        allRows.push(...rows);
        offset += batchSize;
        hasMore = rows.length === batchSize;
      }
    } else {
      // First sync: this shouldn't happen (use seed script instead)
      // But as a safety net, fetch the 500 most recent loans
      console.log("[cron-sync] No previous sync found — fetching recent 500");
      const batch = await searchPipelineWithFilters(
        null,
        [{ canonicalName: "Loan.LastModified", order: "desc" }],
        0,
        500,
      );
      allRows = Array.isArray(batch) ? batch : [];
    }

    // Upsert to Supabase in batches of 500
    let upserted = 0;
    const BATCH = 500;
    for (let i = 0; i < allRows.length; i += BATCH) {
      const slice = allRows.slice(i, i + BATCH);
      const dbRows = slice.map((r) => encompassFieldsToDbRow(r.loanGuid, r.fields || {}));

      const { error } = await supabaseAdmin
        .from("pipeline_loans")
        .upsert(dbRows, { onConflict: "loan_guid" });

      if (error) {
        console.error(`[cron-sync] Upsert error batch ${i}: ${error.message}`);
      } else {
        upserted += slice.length;
      }
    }

    // Get total row count
    const { count } = await supabaseAdmin
      .from("pipeline_loans")
      .select("loan_guid", { count: "exact", head: true });

    const durationMs = Date.now() - t0;

    // Update sync status
    await supabaseAdmin.from("sync_status").upsert({
      id: 1,
      last_sync_at: new Date().toISOString(),
      total_rows: count || 0,
      status: "ready",
      error_message: null,
      sync_duration_ms: durationMs,
    });

    console.log(
      `[cron-sync] Done: ${upserted} loans upserted, ${count} total, ${durationMs}ms`,
    );

    return NextResponse.json({
      ok: true,
      upserted,
      totalRows: count,
      durationMs,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[cron-sync] Failed: ${msg}`);

    await supabaseAdmin
      .from("sync_status")
      .upsert({ id: 1, status: "error", error_message: msg });

    return NextResponse.json({ error: msg }, { status: 500 });
  }
}

// Vercel Cron uses GET
export async function GET(req: NextRequest) {
  return POST(req);
}
