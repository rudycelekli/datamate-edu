import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";

/**
 * GET /api/gna
 * Gastos No Aceptados (GNA) — Economic Impact Metric #1
 *
 * Aggregates expenses whose desc_estado indicates non-acceptance
 * (observed, rejected, flagged) across all sostenedores and periods.
 *
 * Params:
 *   sost_id  — (optional) filter to one sostenedor
 *   periodo  — (optional) filter to one period
 *   group_by — "sost_id" | "periodo" | "cuenta" (default: periodo)
 *
 * Returns:
 *   - Total GNA amount and % of total gastos
 *   - YOY change in GNA (growth/reduction)
 *   - Breakdown by desc_estado value
 *   - Top offenders by account category
 */

async function fetchPaginated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
  batchSize = 1000,
  maxRows = 100000,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  let offset = 0;
  while (all.length < maxRows) {
    const { data, error } = await buildQuery().range(offset, offset + batchSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    offset += batchSize;
    if (data.length < batchSize) break;
  }
  return all;
}

function isAccepted(estado: string): boolean {
  const lower = estado.toLowerCase().trim();
  if (!lower) return true;
  const ACCEPTED = ["aceptado", "aprobado", "normal", "declarado", "presentado", "enviado", "recibido", "procesado"];
  return ACCEPTED.some(p => lower.includes(p));
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sostId   = sp.get("sost_id");
  const periodo  = sp.get("periodo");
  const groupBy  = (sp.get("group_by") || "periodo") as "sost_id" | "periodo" | "cuenta";

  try {
    const db = getDesafioClient();

    // Build query — always filter for expenses (Gasto) with non-null desc_estado
    const rows = await fetchPaginated(() => {
      let q = db.from("estado_resultado")
        .select("sost_id, periodo, cuenta_alias, desc_cuenta, desc_cuenta_padre, desc_tipo_cuenta, monto_declarado, desc_estado")
        .eq("desc_tipo_cuenta", "Gasto")
        .not("desc_estado", "is", null);
      if (sostId) q = q.eq("sost_id", sostId);
      if (periodo) q = q.eq("periodo", periodo);
      return q;
    });

    if (rows.length === 0) {
      return NextResponse.json({
        total_rows_scanned: 0,
        gna_total: 0,
        accepted_total: 0,
        gna_ratio: 0,
        message: "Sin datos con desc_estado no nulo para los filtros aplicados",
      });
    }

    // ── Aggregate ──
    let grandTotalGasto = 0;
    let grandGna = 0;
    let grandAccepted = 0;

    // By period
    const byPeriodo = new Map<string, { total: number; gna: number; accepted: number }>();
    // By estado value
    const byEstado = new Map<string, { monto: number; is_accepted: boolean }>();
    // By cuenta padre
    const byCuenta = new Map<string, { desc: string; gna: number; total: number }>();
    // By sostenedor (for ranking)
    const bySost = new Map<string, { gna: number; total: number }>();

    for (const row of rows) {
      const monto = Number(row.monto_declarado) || 0;
      const estado = String(row.desc_estado || "").trim();
      const per = String(row.periodo || "");
      const cuenta = String(row.cuenta_alias_padre || row.cuenta_alias || "");
      const descCuenta = String(row.desc_cuenta_padre || row.desc_cuenta || "");
      const sId = String(row.sost_id || "");
      const accepted = isAccepted(estado);

      grandTotalGasto += monto;
      if (accepted) grandAccepted += monto;
      else grandGna += monto;

      // Period
      if (!byPeriodo.has(per)) byPeriodo.set(per, { total: 0, gna: 0, accepted: 0 });
      const pEntry = byPeriodo.get(per)!;
      pEntry.total += monto;
      if (accepted) pEntry.accepted += monto; else pEntry.gna += monto;

      // Estado
      if (estado) {
        if (!byEstado.has(estado)) byEstado.set(estado, { monto: 0, is_accepted: accepted });
        byEstado.get(estado)!.monto += monto;
      }

      // Cuenta
      if (cuenta) {
        if (!byCuenta.has(cuenta)) byCuenta.set(cuenta, { desc: descCuenta, gna: 0, total: 0 });
        const cEntry = byCuenta.get(cuenta)!;
        cEntry.total += monto;
        if (!accepted) cEntry.gna += monto;
      }

      // Sost
      if (sId) {
        if (!bySost.has(sId)) bySost.set(sId, { gna: 0, total: 0 });
        const sEntry = bySost.get(sId)!;
        sEntry.total += monto;
        if (!accepted) sEntry.gna += monto;
      }
    }

    // ── YOY change in GNA ──
    const periodosSorted = Array.from(byPeriodo.keys()).sort();
    const yoyChanges: { from: string; to: string; gna_from: number; gna_to: number; pct_change: number }[] = [];
    for (let i = 1; i < periodosSorted.length; i++) {
      const from = periodosSorted[i - 1];
      const to   = periodosSorted[i];
      const gnaFrom = byPeriodo.get(from)!.gna;
      const gnaTo   = byPeriodo.get(to)!.gna;
      const pctChange = gnaFrom > 0 ? ((gnaTo - gnaFrom) / gnaFrom) * 100 : null;
      yoyChanges.push({
        from,
        to,
        gna_from: gnaFrom,
        gna_to: gnaTo,
        pct_change: pctChange !== null ? Math.round(pctChange * 10) / 10 : 0,
      });
    }

    // ── Per-period summary ──
    const byPeriodoArr = periodosSorted.map(per => {
      const e = byPeriodo.get(per)!;
      return {
        periodo: per,
        total_gastos: e.total,
        gna: e.gna,
        accepted: e.accepted,
        gna_ratio: e.total > 0 ? Math.round((e.gna / e.total) * 1000) / 10 : 0,
      };
    });

    // ── Top accounts by GNA ──
    const topCuentas = Array.from(byCuenta.entries())
      .map(([cuenta, v]) => ({
        cuenta_alias: cuenta,
        desc_cuenta: v.desc,
        gna: v.gna,
        total: v.total,
        gna_ratio: v.total > 0 ? Math.round((v.gna / v.total) * 1000) / 10 : 0,
      }))
      .filter(c => c.gna > 0)
      .sort((a, b) => b.gna - a.gna)
      .slice(0, 20);

    // ── Top sostenedores by GNA (only if not filtering by sost_id) ──
    const topSostenedores = sostId ? [] : Array.from(bySost.entries())
      .map(([id, v]) => ({
        sost_id: id,
        gna: v.gna,
        total: v.total,
        gna_ratio: v.total > 0 ? Math.round((v.gna / v.total) * 1000) / 10 : 0,
      }))
      .filter(s => s.gna > 0)
      .sort((a, b) => b.gna - a.gna)
      .slice(0, 20);

    // ── Estado breakdown ──
    const estadoBreakdown = Array.from(byEstado.entries())
      .map(([estado, v]) => ({
        desc_estado: estado,
        monto: v.monto,
        is_accepted: v.is_accepted,
        share_pct: grandTotalGasto > 0 ? Math.round((v.monto / grandTotalGasto) * 1000) / 10 : 0,
      }))
      .sort((a, b) => b.monto - a.monto);

    const gnaRatio = grandTotalGasto > 0
      ? Math.round((grandGna / grandTotalGasto) * 1000) / 10
      : 0;

    // Risk level based on GNA ratio
    const riskLevel = gnaRatio > 20 ? "CRITICO" : gnaRatio > 10 ? "ALERTA" : gnaRatio > 5 ? "INFO" : "OK";

    // Latest YOY trend
    const latestYoy = yoyChanges.length > 0 ? yoyChanges[yoyChanges.length - 1] : null;

    return NextResponse.json({
      filters: { sost_id: sostId, periodo, group_by: groupBy },
      summary: {
        total_gastos: grandTotalGasto,
        gna_total: grandGna,
        accepted_total: grandAccepted,
        gna_ratio: gnaRatio,
        risk_level: riskLevel,
        rows_analyzed: rows.length,
        latest_yoy_pct: latestYoy?.pct_change ?? null,
        yoy_trend: latestYoy
          ? latestYoy.pct_change > 10
            ? "aumentando"
            : latestYoy.pct_change < -10
              ? "disminuyendo"
              : "estable"
          : null,
      },
      by_periodo: byPeriodoArr,
      yoy_changes: yoyChanges,
      estado_breakdown: estadoBreakdown,
      top_cuentas: topCuentas,
      top_sostenedores: topSostenedores,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error en análisis GNA";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
