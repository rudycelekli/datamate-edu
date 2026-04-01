"use client";

import { useState, useEffect } from "react";
import { Loader2, TrendingUp, TrendingDown, Minus, Target, AlertTriangle, ChevronRight } from "lucide-react";

interface ProjectedPoint {
  periodo: string;
  is_actual: boolean;
  ingresos: number | null;
  gastos: number | null;
  balance: number | null;
  ind4_admin_ratio: number | null;
  ind9_payroll_ratio: number | null;
  risk_score: number | null;
  ingresos_low?: number;
  ingresos_high?: number;
  gastos_low?: number;
  gastos_high?: number;
  balance_low?: number;
  balance_high?: number;
}

interface ProyeccionData {
  sost_id: string;
  nombre: string;
  periods_used: number;
  horizonte: number;
  projected_risk_level: "OK" | "ALERTA" | "CRITICO";
  projected_alerts: string[];
  model_fit: {
    r2_ingresos: number;
    r2_gastos: number;
    r2_balance: number;
    note: string;
  };
  trends: {
    ingresos_slope_anual: number;
    gastos_slope_anual: number;
    balance_slope_anual: number;
    ind9_slope_anual: number;
    risk_score_slope_anual: number;
  };
  points: ProjectedPoint[];
}

const fmt = (v: number | null) => {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
};

const fmtPct = (v: number | null) => v === null ? "—" : `${v}%`;

const slopeIcon = (slope: number, higherIsBetter = true) => {
  const good = higherIsBetter ? slope > 0 : slope < 0;
  if (Math.abs(slope) < 1) return <Minus className="w-3.5 h-3.5 text-gray-400" />;
  return good
    ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
    : <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
};

const r2Color = (r2: number) => {
  if (r2 >= 0.8) return "text-emerald-600";
  if (r2 >= 0.5) return "text-amber-600";
  return "text-red-600";
};

export default function ProyeccionPanel({ sostId, horizonte = 2 }: { sostId: string; horizonte?: number }) {
  const [data, setData] = useState<ProyeccionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sostId) return;
    setLoading(true);
    fetch(`/api/sostenedor/proyeccion?sost_id=${encodeURIComponent(sostId)}&horizonte=${horizonte}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sostId, horizonte]);

  if (loading) return (
    <div className="glass-card p-6 flex items-center gap-2 text-sm text-[var(--text-muted)]">
      <Loader2 className="w-4 h-4 animate-spin" /> Calculando proyección...
    </div>
  );
  if (error) return <div className="glass-card p-4 text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl">{error}</div>;
  if (!data) return null;

  const actualPoints = data.points.filter(p => p.is_actual);
  const projectedPoints = data.points.filter(p => !p.is_actual);

  return (
    <div className="glass-card p-4 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Target className="w-4 h-4 text-[var(--accent)]" />
          #8 Proyección de Saldos — {horizonte} período{horizonte > 1 ? "s" : ""} adelante
        </h3>
        <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${
          data.projected_risk_level === "CRITICO" ? "text-red-700 bg-red-50 border-red-200"
          : data.projected_risk_level === "ALERTA" ? "text-amber-700 bg-amber-50 border-amber-200"
          : "text-emerald-700 bg-emerald-50 border-emerald-200"
        }`}>
          Riesgo Proyectado: {data.projected_risk_level}
        </span>
      </div>

      {/* Projected alerts */}
      {data.projected_alerts.length > 0 && (
        <div className="mb-4 space-y-1.5">
          {data.projected_alerts.map((alert, i) => (
            <div key={i} className="flex items-start gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              {alert}
            </div>
          ))}
        </div>
      )}

      {data.projected_alerts.length === 0 && (
        <div className="mb-4 p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">
          No se proyectan alertas de riesgo para los próximos {horizonte} períodos bajo la tendencia actual.
        </div>
      )}

      {/* Trend summary */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-4">
        {[
          { label: "Tendencia Ingresos", slope: data.trends.ingresos_slope_anual, higherIsBetter: true, isCurrency: true },
          { label: "Tendencia Gastos", slope: data.trends.gastos_slope_anual, higherIsBetter: false, isCurrency: true },
          { label: "Tendencia Balance", slope: data.trends.balance_slope_anual, higherIsBetter: true, isCurrency: true },
          { label: "Tendencia #9 Remun.", slope: data.trends.ind9_slope_anual, higherIsBetter: false, isCurrency: false },
          { label: "Tendencia Riesgo", slope: data.trends.risk_score_slope_anual, higherIsBetter: false, isCurrency: false },
        ].map(t => (
          <div key={t.label} className="bg-[var(--bg-secondary)] rounded-lg p-2.5 border border-[var(--border)]">
            <div className="text-[10px] text-[var(--text-muted)] mb-1">{t.label}</div>
            <div className="flex items-center gap-1.5">
              {slopeIcon(t.slope, t.higherIsBetter)}
              <span className="text-xs font-mono font-semibold">
                {t.slope >= 0 ? "+" : ""}{t.isCurrency ? fmt(t.slope) : `${t.slope}/período`}
              </span>
            </div>
          </div>
        ))}
        <div className="bg-[var(--bg-secondary)] rounded-lg p-2.5 border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-muted)] mb-1">Ajuste del Modelo (R²)</div>
          <div className="text-[10px] space-y-0.5">
            <div>Ingresos: <span className={`font-mono font-semibold ${r2Color(data.model_fit.r2_ingresos)}`}>{data.model_fit.r2_ingresos}</span></div>
            <div>Gastos: <span className={`font-mono font-semibold ${r2Color(data.model_fit.r2_gastos)}`}>{data.model_fit.r2_gastos}</span></div>
            <div>Balance: <span className={`font-mono font-semibold ${r2Color(data.model_fit.r2_balance)}`}>{data.model_fit.r2_balance}</span></div>
          </div>
        </div>
      </div>

      {/* Timeline table: historical + projected */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="text-left py-2 pr-3 font-semibold text-[var(--text-muted)]">Período</th>
              <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">Ingresos</th>
              <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">Gastos</th>
              <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">Balance</th>
              <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">#4 Admin</th>
              <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">#9 Remun.</th>
              <th className="text-right py-2 pl-2 font-semibold text-[var(--text-muted)]">Riesgo</th>
            </tr>
          </thead>
          <tbody>
            {/* Historical */}
            {actualPoints.map(p => (
              <tr key={p.periodo} className="border-b border-[var(--border)] border-opacity-40 hover:bg-[var(--bg-secondary)]">
                <td className="py-1.5 pr-3 font-medium">{p.periodo}</td>
                <td className="py-1.5 px-2 text-right font-mono">{fmt(p.ingresos)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{fmt(p.gastos)}</td>
                <td className={`py-1.5 px-2 text-right font-mono font-semibold ${(p.balance ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {fmt(p.balance)}
                </td>
                <td className="py-1.5 px-2 text-right font-mono">{fmtPct(p.ind4_admin_ratio)}</td>
                <td className="py-1.5 px-2 text-right font-mono">{fmtPct(p.ind9_payroll_ratio)}</td>
                <td className="py-1.5 pl-2 text-right font-mono">{p.risk_score}</td>
              </tr>
            ))}

            {/* Divider */}
            <tr>
              <td colSpan={7} className="py-1">
                <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)]">
                  <div className="flex-1 h-px border-t border-dashed border-[var(--border)]" />
                  <span className="flex items-center gap-1"><ChevronRight className="w-3 h-3" /> PROYECTADO</span>
                  <div className="flex-1 h-px border-t border-dashed border-[var(--border)]" />
                </div>
              </td>
            </tr>

            {/* Projected */}
            {projectedPoints.map(p => (
              <tr key={p.periodo} className="border-b border-[var(--border)] border-opacity-40 bg-blue-50/40">
                <td className="py-1.5 pr-3 font-medium text-[var(--accent)]">
                  {p.periodo} <span className="text-[10px] text-[var(--text-muted)]">(proj.)</span>
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-[var(--accent)]">
                  {fmt(p.ingresos)}
                  {p.ingresos_low !== undefined && (
                    <div className="text-[10px] text-[var(--text-muted)]">{fmt(p.ingresos_low)}–{fmt(p.ingresos_high ?? null)}</div>
                  )}
                </td>
                <td className="py-1.5 px-2 text-right font-mono text-[var(--accent)]">
                  {fmt(p.gastos)}
                  {p.gastos_low !== undefined && (
                    <div className="text-[10px] text-[var(--text-muted)]">{fmt(p.gastos_low)}–{fmt(p.gastos_high ?? null)}</div>
                  )}
                </td>
                <td className={`py-1.5 px-2 text-right font-mono font-semibold ${(p.balance ?? 0) >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                  {fmt(p.balance)}
                  {p.balance_low !== undefined && (
                    <div className="text-[10px] opacity-70">{fmt(p.balance_low)}–{fmt(p.balance_high ?? null)}</div>
                  )}
                </td>
                <td className={`py-1.5 px-2 text-right font-mono ${(p.ind4_admin_ratio ?? 0) > 50 ? "text-red-600" : (p.ind4_admin_ratio ?? 0) > 35 ? "text-amber-600" : ""}`}>
                  {fmtPct(p.ind4_admin_ratio)}
                </td>
                <td className={`py-1.5 px-2 text-right font-mono ${(p.ind9_payroll_ratio ?? 0) > 95 ? "text-red-600" : (p.ind9_payroll_ratio ?? 0) > 80 ? "text-amber-600" : ""}`}>
                  {fmtPct(p.ind9_payroll_ratio)}
                </td>
                <td className="py-1.5 pl-2 text-right font-mono text-[var(--accent)]">{p.risk_score}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-[10px] text-[var(--text-muted)] mt-2">
        Proyección por regresión lineal sobre {data.periods_used} períodos históricos.
        Las bandas de confianza muestran ±1σ residual. {data.model_fit.note}
      </p>
    </div>
  );
}
