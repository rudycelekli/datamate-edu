import { NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";

/**
 * Dashboard stats — uses materialized views for instant response.
 * Falls back to raw query if views don't exist yet.
 */
export async function GET() {
  try {
    const db = getDesafioClient();

    // Try materialized view first (instant)
    // Fetch all profiles (paginate past 1000 limit)
    const profiles: Record<string, unknown>[] = [];
    let profileOffset = 0;
    while (true) {
      const { data, error: bErr } = await db
        .from("mv_sostenedor_profile")
        .select("sost_id, periodo, total_ingresos, total_gastos, rbd_count, risk_level")
        .range(profileOffset, profileOffset + 999);
      if (bErr || !data || data.length === 0) break;
      profiles.push(...data);
      profileOffset += 1000;
      if (data.length < 1000) break;
    }
    const error = null;

    if (!error && profiles.length > 0) {
      const uniqueSost = new Set<string>();
      const uniquePeriodos = new Set<string>();
      const uniqueRbds = new Set<string>();
      let totalMonto = 0;

      for (const r of profiles) {
        const row = r as Record<string, unknown>;
        if (row.sost_id) uniqueSost.add(String(row.sost_id));
        if (row.periodo) uniquePeriodos.add(String(row.periodo));
        totalMonto += (Number(row.total_ingresos) || 0) + (Number(row.total_gastos) || 0);
      }

      return NextResponse.json({
        totalRows: uniqueSost.size,
        totalMonto,
        totalEstablecimientos: profiles.reduce((s, r) => s + (Number((r as Record<string, unknown>).rbd_count) || 0), 0),
        totalPeriodos: uniquePeriodos.size,
        lastRefresh: new Date().toISOString(),
        state: "ready",
        source: "materialized_views",
      });
    }

    // Fallback to raw query
    const { getDashboardStats } = await import("@/lib/desafio-queries");
    const stats = await getDashboardStats();
    return NextResponse.json({
      totalRows: stats.totalSostenedores,
      totalMonto: stats.totalMonto,
      totalEstablecimientos: stats.totalEstablecimientos,
      totalPeriodos: stats.totalPeriodos,
      lastRefresh: stats.lastRefresh,
      state: "ready",
      source: "raw_query",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({
      error: message,
      totalRows: 0,
      state: "error",
      lastRefresh: null,
    }, { status: 500 });
  }
}
