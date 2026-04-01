import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";

/**
 * GET /api/sostenedor/historicos?sost_id=X
 *
 * Indicador #7 — Análisis de Promedios Históricos de RC (AP)
 * Compares the latest period's indicators against the sostenedor's own
 * historical mean and standard deviation across all available periods.
 *
 * For each key indicator, returns:
 *   - Historical mean and std dev
 *   - Z-score for the latest (and each) period
 *   - Anomaly flag if |z-score| > 2σ
 *   - Trend direction (improving / deteriorating / stable)
 *
 * Uses only mv_sostenedor_profile (no raw table scan needed).
 */

const INDICATORS = [
  { key: "total_ingresos",        label: "Total Ingresos",          higherIsBetter: true,  isCurrency: true },
  { key: "total_gastos",          label: "Total Gastos",            higherIsBetter: false, isCurrency: true },
  { key: "balance",               label: "Balance",                 higherIsBetter: true,  isCurrency: true },
  { key: "balance_ratio",         label: "Balance / Ingresos (%)",  higherIsBetter: true,  isCurrency: false },
  { key: "ind4_admin_ratio",      label: "#4 Gasto Admin (%)",      higherIsBetter: false, isCurrency: false },
  { key: "ind9_payroll_ratio",    label: "#9 Remuneraciones (%)",   higherIsBetter: false, isCurrency: false },
  { key: "ind10_innovacion_ratio",label: "#10 Innovación (%)",      higherIsBetter: true,  isCurrency: false },
  { key: "ind11_hhi",             label: "#11 HHI Concentración",   higherIsBetter: false, isCurrency: false },
  { key: "tasa_ejecucion",        label: "Tasa Ejecución (%)",      higherIsBetter: false, isCurrency: false },
  { key: "doc_coverage_ratio",    label: "Cobertura Documental (%)",higherIsBetter: true,  isCurrency: false },
  { key: "trabajadores",          label: "Trabajadores",            higherIsBetter: true,  isCurrency: false },
  { key: "risk_score",            label: "Puntaje de Riesgo",       higherIsBetter: false, isCurrency: false },
];

function mean(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[], avg?: number): number {
  if (arr.length < 2) return 0;
  const m = avg ?? mean(arr);
  const variance = arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
  return Math.sqrt(variance);
}

function zscore(value: number, m: number, sd: number): number {
  if (sd === 0) return 0;
  return (value - m) / sd;
}

/** Linear regression slope (y = a + b*x). Returns b (change per period). */
function slope(values: number[]): number {
  const n = values.length;
  if (n < 2) return 0;
  const xs = values.map((_, i) => i);
  const xMean = mean(xs);
  const yMean = mean(values);
  const num = xs.reduce((s, x, i) => s + (x - xMean) * (values[i] - yMean), 0);
  const den = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
  return den === 0 ? 0 : num / den;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sostId = sp.get("sost_id");

  if (!sostId) {
    return NextResponse.json({ error: "sost_id es requerido" }, { status: 400 });
  }

  try {
    const db = getDesafioClient();

    const { data: profiles, error } = await db
      .from("mv_sostenedor_profile")
      .select("*")
      .eq("sost_id", sostId)
      .order("periodo");

    if (error) throw new Error(error.message);
    if (!profiles || profiles.length === 0) {
      return NextResponse.json({ error: `Sin datos para sostenedor ${sostId}` }, { status: 404 });
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows = profiles as any[];
    const periodos = rows.map((p: Record<string, unknown>) => String(p.periodo));
    const latest = rows[rows.length - 1] as Record<string, unknown>;
    const nPeriods = rows.length;

    // ── Compute per-indicator stats ──
    const indicatorStats = INDICATORS.map(ind => {
      const values = rows.map((p: Record<string, unknown>) => Number(p[ind.key]) || 0);
      const m = mean(values);
      const sd = stddev(values, m);
      const latestVal = Number(latest[ind.key]) || 0;
      const z = zscore(latestVal, m, sd);
      const trendSlope = slope(values);

      // Anomaly: |z| > 2σ
      const isAnomaly = Math.abs(z) > 2;

      // Direction: positive slope with higherIsBetter=false → deteriorating
      let trend: "mejorando" | "estable" | "deteriorando";
      const slopeRelative = m !== 0 ? trendSlope / Math.abs(m) : 0;
      if (Math.abs(slopeRelative) < 0.03) {
        trend = "estable";
      } else if ((slopeRelative > 0) === ind.higherIsBetter) {
        trend = "mejorando";
      } else {
        trend = "deteriorando";
      }

      // Per-period Z-scores
      const perPeriod = rows.map((_p: Record<string, unknown>, i: number) => ({
        periodo: periodos[i],
        value: values[i],
        zscore: Math.round(zscore(values[i], m, sd) * 100) / 100,
      }));

      return {
        key: ind.key,
        label: ind.label,
        higherIsBetter: ind.higherIsBetter,
        isCurrency: ind.isCurrency,
        historical_mean: Math.round(m * 100) / 100,
        historical_stddev: Math.round(sd * 100) / 100,
        latest_value: latestVal,
        latest_zscore: Math.round(z * 100) / 100,
        is_anomaly: isAnomaly,
        trend,
        trend_slope_per_period: Math.round(trendSlope * 100) / 100,
        per_period: perPeriod,
      };
    });

    // Overall anomaly count
    const anomalies = indicatorStats.filter(i => i.is_anomaly);
    const overallRisk = anomalies.length >= 4 ? "CRITICO" : anomalies.length >= 2 ? "ALERTA" : "OK";

    return NextResponse.json({
      sost_id: sostId,
      nombre: latest.nombre || sostId,
      latest_periodo: latest.periodo,
      periods_analyzed: nPeriods,
      periodos,
      overall_risk: overallRisk,
      anomaly_count: anomalies.length,
      anomaly_indicators: anomalies.map(a => a.label),
      indicators: indicatorStats,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error en análisis histórico";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
