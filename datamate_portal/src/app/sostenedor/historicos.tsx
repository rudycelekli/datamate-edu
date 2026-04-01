"use client";

import { useState, useEffect } from "react";
import { Loader2, TrendingUp, TrendingDown, Minus, History, AlertTriangle } from "lucide-react";

interface IndicatorStat {
  key: string;
  label: string;
  higherIsBetter: boolean;
  isCurrency: boolean;
  historical_mean: number;
  historical_stddev: number;
  latest_value: number;
  latest_zscore: number;
  is_anomaly: boolean;
  trend: "mejorando" | "estable" | "deteriorando";
  trend_slope_per_period: number;
  per_period: { periodo: string; value: number; zscore: number }[];
}

interface HistoricosData {
  sost_id: string;
  nombre: string;
  latest_periodo: string;
  periods_analyzed: number;
  periodos: string[];
  overall_risk: "OK" | "ALERTA" | "CRITICO";
  anomaly_count: number;
  anomaly_indicators: string[];
  indicators: IndicatorStat[];
}

const fmt = (v: number, isCurrency: boolean) =>
  isCurrency
    ? new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v)
    : v.toLocaleString("es-CL", { maximumFractionDigits: 2 });

const trendIcon = (trend: string) => {
  if (trend === "mejorando") return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
  if (trend === "deteriorando") return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
  return <Minus className="w-3.5 h-3.5 text-gray-400" />;
};

const trendLabel = (trend: string) => {
  if (trend === "mejorando") return "text-emerald-600";
  if (trend === "deteriorando") return "text-red-600";
  return "text-gray-500";
};

const zColor = (z: number, isAnomaly: boolean) => {
  if (!isAnomaly) return "text-[var(--text)]";
  return Math.abs(z) > 3 ? "text-red-700 font-bold" : "text-amber-700 font-semibold";
};

/** Mini sparkline using inline SVG */
function Sparkline({ values, width = 80, height = 24 }: { values: number[]; width?: number; height?: number }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - ((v - min) / range) * height;
    return `${x},${y}`;
  }).join(" ");

  return (
    <svg width={width} height={height} className="overflow-visible">
      <polyline points={pts} fill="none" stroke="var(--accent)" strokeWidth="1.5" strokeLinejoin="round" />
      {/* Last point dot */}
      <circle cx={(width)} cy={height - ((values[values.length - 1] - min) / range) * height} r="2.5" fill="var(--accent)" />
    </svg>
  );
}

export default function HistoricosPanel({ sostId }: { sostId: string }) {
  const [data, setData] = useState<HistoricosData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    if (!sostId) return;
    setLoading(true);
    fetch(`/api/sostenedor/historicos?sost_id=${encodeURIComponent(sostId)}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sostId]);

  if (loading) return (
    <div className="glass-card p-6 flex items-center gap-2 text-sm text-[var(--text-muted)]">
      <Loader2 className="w-4 h-4 animate-spin" /> Analizando histórico...
    </div>
  );
  if (error) return <div className="glass-card p-4 text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl">{error}</div>;
  if (!data) return null;

  const displayedIndicators = showAll ? data.indicators : data.indicators.filter(i => i.is_anomaly || i.trend !== "estable");
  const hasAnomalies = data.anomaly_count > 0;

  return (
    <div className="glass-card p-4 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <History className="w-4 h-4 text-[var(--accent)]" />
          #7 Análisis Histórico RC — {data.periods_analyzed} períodos
        </h3>
        <div className="flex items-center gap-2">
          {hasAnomalies && (
            <span className="flex items-center gap-1 text-xs text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full">
              <AlertTriangle className="w-3 h-3" />
              {data.anomaly_count} anomalías detectadas
            </span>
          )}
          <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${
            data.overall_risk === "CRITICO" ? "text-red-700 bg-red-50 border-red-200"
            : data.overall_risk === "ALERTA" ? "text-amber-700 bg-amber-50 border-amber-200"
            : "text-emerald-700 bg-emerald-50 border-emerald-200"
          }`}>
            {data.overall_risk}
          </span>
        </div>
      </div>

      {/* Anomaly summary */}
      {hasAnomalies && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs">
          <div className="font-semibold text-amber-800 mb-1">Indicadores con valores fuera de rango histórico (|Z| &gt; 2σ):</div>
          <div className="text-amber-700">{data.anomaly_indicators.join(" · ")}</div>
        </div>
      )}

      {!hasAnomalies && (
        <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-700">
          Todos los indicadores del período más reciente ({data.latest_periodo}) se encuentran dentro del rango histórico normal de este sostenedor.
        </div>
      )}

      {/* Periods context */}
      <div className="flex items-center gap-2 mb-3 text-[10px] text-[var(--text-muted)]">
        <span>Períodos analizados:</span>
        {data.periodos.map(p => (
          <span key={p} className={`px-1.5 py-0.5 rounded border text-[10px] ${p === data.latest_periodo ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "border-[var(--border)] bg-[var(--bg-secondary)]"}`}>{p}</span>
        ))}
      </div>

      {/* Indicator table */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="text-left py-2 pr-2 font-semibold text-[var(--text-muted)]">Indicador</th>
              <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">Valor Actual</th>
              <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">Media Hist.</th>
              <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">±1σ</th>
              <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">Z-score</th>
              <th className="text-center py-2 px-2 font-semibold text-[var(--text-muted)]">Tendencia</th>
              <th className="py-2 pl-2 font-semibold text-[var(--text-muted)]">Evolución</th>
            </tr>
          </thead>
          <tbody>
            {displayedIndicators.map(ind => (
              <tr key={ind.key} className={`border-b border-[var(--border)] border-opacity-40 ${ind.is_anomaly ? "bg-amber-50" : "hover:bg-[var(--bg-secondary)]"}`}>
                <td className="py-2 pr-2">
                  <div className="flex items-center gap-1.5">
                    {ind.is_anomaly && <AlertTriangle className="w-3 h-3 text-amber-500 shrink-0" />}
                    <span className={ind.is_anomaly ? "font-semibold" : ""}>{ind.label}</span>
                  </div>
                </td>
                <td className="py-2 px-2 text-right font-mono font-semibold">
                  {fmt(ind.latest_value, ind.isCurrency)}
                </td>
                <td className="py-2 px-2 text-right font-mono text-[var(--text-muted)]">
                  {fmt(ind.historical_mean, ind.isCurrency)}
                </td>
                <td className="py-2 px-2 text-right font-mono text-[10px] text-[var(--text-muted)]">
                  ±{fmt(ind.historical_stddev, ind.isCurrency)}
                </td>
                <td className={`py-2 px-2 text-right font-mono ${zColor(ind.latest_zscore, ind.is_anomaly)}`}>
                  {ind.latest_zscore > 0 ? "+" : ""}{ind.latest_zscore.toFixed(2)}
                </td>
                <td className="py-2 px-2">
                  <div className={`flex items-center justify-center gap-1 text-[10px] ${trendLabel(ind.trend)}`}>
                    {trendIcon(ind.trend)}
                    <span className="hidden sm:inline capitalize">{ind.trend}</span>
                  </div>
                </td>
                <td className="py-2 pl-2">
                  <Sparkline values={ind.per_period.map(p => p.value)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button
        onClick={() => setShowAll(!showAll)}
        className="mt-2 text-xs text-[var(--accent)] hover:underline"
      >
        {showAll ? "Mostrar solo relevantes" : `Ver todos los indicadores (${data.indicators.length})`}
      </button>
    </div>
  );
}
