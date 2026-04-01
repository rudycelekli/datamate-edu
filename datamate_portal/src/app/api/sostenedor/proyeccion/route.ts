import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";

/**
 * GET /api/sostenedor/proyeccion?sost_id=X&horizonte=2
 *
 * Indicador #8 — Análisis de Proyección de Saldos (AF)
 * Projects future balance, ingresos, and gastos using linear regression
 * on the sostenedor's known period history.
 *
 * Returns:
 *   - Historical data points
 *   - Projected values for the next N periods (default 2)
 *   - Deficit risk flag if projected balance < 0
 *   - Confidence interval (±1 residual std dev)
 *   - Alert thresholds (when projected to cross risk boundaries)
 */

type ProjectedPoint = {
  periodo: string;
  is_actual: boolean;
  ingresos: number | null;
  gastos: number | null;
  balance: number | null;
  ind4_admin_ratio: number | null;
  ind9_payroll_ratio: number | null;
  risk_score: number | null;
  // Projection-only
  ingresos_low?: number;
  ingresos_high?: number;
  gastos_low?: number;
  gastos_high?: number;
  balance_low?: number;
  balance_high?: number;
};

/** Simple OLS linear regression — returns {slope, intercept, residualStd} */
function linearRegression(ys: number[]): { slope: number; intercept: number; residualStd: number } {
  const n = ys.length;
  const xs = ys.map((_, i) => i);
  const xMean = (n - 1) / 2;
  const yMean = ys.reduce((s, v) => s + v, 0) / n;
  const sxy = xs.reduce((s, x, i) => s + (x - xMean) * (ys[i] - yMean), 0);
  const sxx = xs.reduce((s, x) => s + (x - xMean) ** 2, 0);
  const slope = sxx === 0 ? 0 : sxy / sxx;
  const intercept = yMean - slope * xMean;
  const residuals = ys.map((y, i) => y - (intercept + slope * i));
  const residualVar = residuals.reduce((s, r) => s + r ** 2, 0) / Math.max(n - 2, 1);
  return { slope, intercept, residualStd: Math.sqrt(residualVar) };
}

function project(reg: ReturnType<typeof linearRegression>, idx: number): number {
  return reg.intercept + reg.slope * idx;
}

/** Infer the next period label (works for "2021", "2022", "2023" style) */
function nextPeriodo(last: string, offset: number): string {
  const n = parseInt(last);
  if (!isNaN(n)) return String(n + offset);
  return `${last}+${offset}`;
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sostId = sp.get("sost_id");
  const horizonte = Math.min(Math.max(parseInt(sp.get("horizonte") || "2"), 1), 4);

  if (!sostId) {
    return NextResponse.json({ error: "sost_id es requerido" }, { status: 400 });
  }

  try {
    const db = getDesafioClient();

    const { data: profiles, error } = await db
      .from("mv_sostenedor_profile")
      .select("periodo, nombre, total_ingresos, total_gastos, balance, balance_ratio, ind4_admin_ratio, ind9_payroll_ratio, ind10_innovacion_ratio, ind11_hhi, tasa_ejecucion, risk_score, risk_level")
      .eq("sost_id", sostId)
      .order("periodo");

    if (error) throw new Error(error.message);
    if (!profiles || profiles.length < 2) {
      return NextResponse.json({
        error: `Se necesitan al menos 2 períodos históricos para proyectar. Encontrados: ${profiles?.length || 0}`,
      }, { status: 422 });
    }

    const n = profiles.length;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const prows = profiles as any[];

    // Build time series
    const ingresos   = prows.map((p: Record<string, unknown>) => Number(p.total_ingresos) || 0);
    const gastos     = prows.map((p: Record<string, unknown>) => Number(p.total_gastos) || 0);
    const balance    = prows.map((p: Record<string, unknown>) => Number(p.balance) || 0);
    const ind4       = prows.map((p: Record<string, unknown>) => Number(p.ind4_admin_ratio) || 0);
    const ind9       = prows.map((p: Record<string, unknown>) => Number(p.ind9_payroll_ratio) || 0);
    const riskScores = prows.map((p: Record<string, unknown>) => Number(p.risk_score) || 0);

    // Fit regressions
    const regIngresos = linearRegression(ingresos);
    const regGastos   = linearRegression(gastos);
    const regBalance  = linearRegression(balance);
    const regInd4     = linearRegression(ind4);
    const regInd9     = linearRegression(ind9);
    const regRisk     = linearRegression(riskScores);

    // ── Historical points ──
    const points: ProjectedPoint[] = prows.map((p: Record<string, unknown>, i: number) => ({
      periodo: String(p.periodo),
      is_actual: true,
      ingresos: Number(p.total_ingresos) || 0,
      gastos: Number(p.total_gastos) || 0,
      balance: Number(p.balance) || 0,
      ind4_admin_ratio: Number(p.ind4_admin_ratio) || 0,
      ind9_payroll_ratio: Number(p.ind9_payroll_ratio) || 0,
      risk_score: Number(p.risk_score) || 0,
      // Fitted values for R² display
      ingresos_fitted: Math.round(project(regIngresos, i)),
      gastos_fitted: Math.round(project(regGastos, i)),
    }));

    // ── Projected points ──
    const lastPeriodo = String((prows[n - 1] as Record<string, unknown>).periodo);
    const projectedAlerts: string[] = [];

    for (let h = 1; h <= horizonte; h++) {
      const idx = n - 1 + h;
      const pIngresos = Math.max(0, Math.round(project(regIngresos, idx)));
      const pGastos   = Math.max(0, Math.round(project(regGastos, idx)));
      const pBalance  = Math.round(project(regBalance, idx));
      const pInd4     = Math.min(100, Math.max(0, Math.round(project(regInd4, idx) * 10) / 10));
      const pInd9     = Math.min(100, Math.max(0, Math.round(project(regInd9, idx) * 10) / 10));
      const pRisk     = Math.min(100, Math.max(0, Math.round(project(regRisk, idx))));

      // Alert conditions on projections
      if (pBalance < 0) projectedAlerts.push(`Período ${nextPeriodo(lastPeriodo, h)}: balance proyectado negativo ($${pBalance.toLocaleString("es-CL")})`);
      if (pInd9 > 95)   projectedAlerts.push(`Período ${nextPeriodo(lastPeriodo, h)}: gasto remuneracional proyectado crítico (${pInd9}%)`);
      if (pInd4 > 50)   projectedAlerts.push(`Período ${nextPeriodo(lastPeriodo, h)}: concentración administrativa proyectada crítica (${pInd4}%)`);

      points.push({
        periodo: nextPeriodo(lastPeriodo, h),
        is_actual: false,
        ingresos: pIngresos,
        gastos: pGastos,
        balance: pBalance,
        ind4_admin_ratio: pInd4,
        ind9_payroll_ratio: pInd9,
        risk_score: pRisk,
        // Confidence bands (±1 residual std dev)
        ingresos_low:  Math.max(0, Math.round(pIngresos - regIngresos.residualStd)),
        ingresos_high: Math.round(pIngresos + regIngresos.residualStd),
        gastos_low:    Math.max(0, Math.round(pGastos - regGastos.residualStd)),
        gastos_high:   Math.round(pGastos + regGastos.residualStd),
        balance_low:   Math.round(pBalance - regBalance.residualStd),
        balance_high:  Math.round(pBalance + regBalance.residualStd),
      });
    }

    // ── R² goodness of fit ──
    function rSquared(actual: number[], reg: ReturnType<typeof linearRegression>): number {
      const mean = actual.reduce((s, v) => s + v, 0) / actual.length;
      const ssTot = actual.reduce((s, v) => s + (v - mean) ** 2, 0);
      const ssRes = actual.reduce((s, v, i) => s + (v - project(reg, i)) ** 2, 0);
      return ssTot === 0 ? 1 : Math.round((1 - ssRes / ssTot) * 1000) / 1000;
    }

    // ── Risk assessment for projected period ──
    const projBalance = points.find(p => !p.is_actual)?.balance ?? 0;
    const projRiskLevel = projBalance < 0 || projectedAlerts.length >= 2
      ? "CRITICO"
      : projectedAlerts.length >= 1 ? "ALERTA" : "OK";

    return NextResponse.json({
      sost_id: sostId,
      nombre: String((prows[0] as Record<string, unknown>).nombre || sostId),
      periods_used: n,
      horizonte,
      projected_risk_level: projRiskLevel,
      projected_alerts: projectedAlerts,
      model_fit: {
        r2_ingresos: rSquared(ingresos, regIngresos),
        r2_gastos:   rSquared(gastos, regGastos),
        r2_balance:  rSquared(balance, regBalance),
        note: "R² cerca de 1.0 = buena predicción lineal. Valores bajos indican alta volatilidad.",
      },
      trends: {
        ingresos_slope_anual: Math.round(regIngresos.slope),
        gastos_slope_anual:   Math.round(regGastos.slope),
        balance_slope_anual:  Math.round(regBalance.slope),
        ind9_slope_anual:     Math.round(regInd9.slope * 100) / 100,
        risk_score_slope_anual: Math.round(regRisk.slope * 100) / 100,
      },
      points, // historical + projected
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error en proyección";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
