"use client";

import { useState, useEffect } from "react";
import { Loader2, BarChart3, TrendingUp, TrendingDown, Minus, Users, Info } from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Benchmark / Comparacion con Pares                                  */
/* ------------------------------------------------------------------ */

interface Comparison {
  key: string;
  label: string;
  higherIsBetter: boolean;
  isCurrency: boolean;
  targetValue: number;
  peerAvg: number;
  peerMedian: number;
  percentile: number;
  deviationPct: number;
  status: "mejor" | "similar" | "peor";
  peerMin: number;
  peerMax: number;
}

interface BenchmarkData {
  target: {
    sost_id: string;
    nombre: string;
    rut: string;
    dependencia_rbd: string;
    region_rbd: string;
    rbd_count: number;
    periodo: string;
    risk_score: number;
    risk_level: string;
  };
  peerCount: number;
  peerCriteria: string;
  comparisons: Comparison[];
  insights: string[];
}

/* ---------- formatters ---------- */

const fmtCLP = (val: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);

const fmtNum = (val: number, isCurrency: boolean) =>
  isCurrency ? fmtCLP(val) : val.toLocaleString("es-CL", { maximumFractionDigits: 2 });

/* ---------- status helpers ---------- */

const statusColor = (status: string) => {
  switch (status) {
    case "mejor":
      return "text-emerald-600 bg-emerald-50 border-emerald-200";
    case "peor":
      return "text-red-600 bg-red-50 border-red-200";
    default:
      return "text-amber-600 bg-amber-50 border-amber-200";
  }
};

const statusLabel = (status: string) => {
  switch (status) {
    case "mejor":
      return "Mejor";
    case "peor":
      return "Atención";
    default:
      return "Similar";
  }
};

const statusIcon = (status: string) => {
  switch (status) {
    case "mejor":
      return <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />;
    case "peor":
      return <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
    default:
      return <Minus className="w-3.5 h-3.5 text-amber-500" />;
  }
};

/* ---------- bar chart component ---------- */

function DistributionBar({ comp }: { comp: Comparison }) {
  const { peerMin, peerMax, peerAvg, targetValue } = comp;
  const range = peerMax - peerMin || 1;

  // Clamp positions to 0-100
  const clamp = (v: number) => Math.max(0, Math.min(100, ((v - peerMin) / range) * 100));
  const avgPos = clamp(peerAvg);
  const targetPos = clamp(targetValue);

  return (
    <div className="relative h-6 w-full rounded-full bg-gray-100 overflow-hidden">
      {/* Gradient background showing peer range */}
      <div
        className="absolute inset-y-0 bg-gradient-to-r from-blue-100 via-blue-200 to-blue-100 rounded-full"
        style={{ left: "0%", width: "100%" }}
      />

      {/* Peer average marker */}
      <div
        className="absolute top-0 bottom-0 w-0.5 bg-blue-400 z-10"
        style={{ left: `${avgPos}%` }}
        title={`Promedio pares: ${fmtNum(peerAvg, comp.isCurrency)}`}
      />

      {/* Target marker */}
      <div
        className={`absolute top-0.5 bottom-0.5 w-3 rounded-full z-20 border-2 border-white shadow-sm ${
          comp.status === "mejor"
            ? "bg-emerald-500"
            : comp.status === "peor"
              ? "bg-red-500"
              : "bg-amber-500"
        }`}
        style={{ left: `calc(${targetPos}% - 6px)` }}
        title={`Sostenedor: ${fmtNum(targetValue, comp.isCurrency)}`}
      />

      {/* Labels */}
      <span className="absolute left-1 top-1/2 -translate-y-1/2 text-[9px] text-gray-500 font-mono">
        {comp.isCurrency ? fmtCLP(peerMin) : peerMin.toLocaleString("es-CL", { maximumFractionDigits: 1 })}
      </span>
      <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] text-gray-500 font-mono">
        {comp.isCurrency ? fmtCLP(peerMax) : peerMax.toLocaleString("es-CL", { maximumFractionDigits: 1 })}
      </span>
    </div>
  );
}

/* ---------- main component ---------- */

export default function BenchmarkPanel({
  sostId,
  periodo,
}: {
  sostId: string;
  periodo: string;
}) {
  const [data, setData] = useState<BenchmarkData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sostId || !periodo) return;
    setLoading(true);
    setError(null);
    fetch(`/api/sostenedor/benchmark?sost_id=${encodeURIComponent(sostId)}&periodo=${encodeURIComponent(periodo)}`)
      .then((r) => {
        if (!r.ok) return r.json().then((d) => Promise.reject(d.error || "Error"));
        return r.json();
      })
      .then((d) => {
        setData(d);
        setLoading(false);
      })
      .catch((e) => {
        setError(typeof e === "string" ? e : "Error al cargar benchmark");
        setLoading(false);
      });
  }, [sostId, periodo]);

  if (loading) {
    return (
      <div className="glass-card p-6 flex items-center justify-center gap-2 text-sm text-[var(--text-muted)]">
        <Loader2 className="w-5 h-5 animate-spin" />
        Cargando comparacion con pares...
      </div>
    );
  }

  if (error) {
    return (
      <div className="glass-card p-6 text-center text-red-500 text-sm">
        {error}
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="glass-card p-4 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-[var(--accent)]" />
          Benchmark — Comparacion con Pares
        </h3>
        <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
          <Users className="w-3.5 h-3.5" />
          {data.peerCount} pares | {data.peerCriteria}
        </div>
      </div>

      {data.peerCount === 0 ? (
        <div className="text-center text-sm text-[var(--text-muted)] py-6">
          No se encontraron pares suficientes para comparar en este periodo.
        </div>
      ) : (
        <>
          {/* Comparison Table */}
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-2 pr-2 font-semibold text-[var(--text-muted)]">
                    Indicador
                  </th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">
                    Sostenedor
                  </th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">
                    Prom. Pares
                  </th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">
                    Mediana
                  </th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">
                    Percentil
                  </th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">
                    Desviacion
                  </th>
                  <th className="text-center py-2 px-2 font-semibold text-[var(--text-muted)]">
                    Estado
                  </th>
                  <th className="py-2 pl-2 font-semibold text-[var(--text-muted)] min-w-[140px]">
                    Distribucion
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.comparisons.map((comp) => (
                  <tr
                    key={comp.key}
                    className="border-b border-[var(--border)] border-opacity-50 hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <td className="py-2.5 pr-2 font-medium">{comp.label}</td>
                    <td className="py-2.5 px-2 text-right font-mono font-semibold">
                      {fmtNum(comp.targetValue, comp.isCurrency)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-[var(--text-muted)]">
                      {fmtNum(comp.peerAvg, comp.isCurrency)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono text-[var(--text-muted)]">
                      {fmtNum(comp.peerMedian, comp.isCurrency)}
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono">
                      <span className="font-semibold">P{comp.percentile.toFixed(0)}</span>
                    </td>
                    <td className="py-2.5 px-2 text-right font-mono">
                      <span
                        className={
                          comp.status === "mejor"
                            ? "text-emerald-600"
                            : comp.status === "peor"
                              ? "text-red-600"
                              : "text-amber-600"
                        }
                      >
                        {comp.deviationPct > 0 ? "+" : ""}
                        {comp.deviationPct.toFixed(1)}%
                      </span>
                    </td>
                    <td className="py-2.5 px-2 text-center">
                      <span
                        className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-[10px] font-semibold ${statusColor(comp.status)}`}
                      >
                        {statusIcon(comp.status)}
                        {statusLabel(comp.status)}
                      </span>
                    </td>
                    <td className="py-2.5 pl-2 min-w-[140px]">
                      <DistributionBar comp={comp} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-4 text-[10px] text-[var(--text-muted)] mb-4 px-1">
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" /> Sostenedor (mejor)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-amber-500 inline-block" /> Sostenedor (similar)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" /> Sostenedor (atencion)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-0.5 h-3 bg-blue-400 inline-block" /> Promedio pares
            </span>
          </div>

          {/* Insights */}
          {data.insights.length > 0 && (
            <div className="bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border)]">
              <h4 className="text-xs font-semibold flex items-center gap-1.5 mb-2">
                <Info className="w-3.5 h-3.5 text-[var(--accent)]" />
                Observaciones Clave
              </h4>
              <ul className="space-y-1">
                {data.insights.map((insight, i) => (
                  <li key={i} className="text-xs text-[var(--text-muted)] flex items-start gap-1.5">
                    <span className="text-[var(--accent)] mt-0.5 shrink-0">•</span>
                    {insight}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
    </div>
  );
}
