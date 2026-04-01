"use client";

import { useState, useEffect, useCallback } from "react";
import {
  Loader2, TrendingUp, TrendingDown, Minus, DollarSign,
  RefreshCw, Filter, Download, Search, ChevronDown, ChevronUp,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";

interface GnaData {
  summary: {
    total_gastos: number;
    gna_total: number;
    accepted_total: number;
    gna_ratio: number;
    risk_level: string;
    rows_analyzed: number;
    latest_yoy_pct: number | null;
    yoy_trend: string | null;
  };
  by_periodo: { periodo: string; total_gastos: number; gna: number; accepted: number; gna_ratio: number }[];
  yoy_changes: { from: string; to: string; gna_from: number; gna_to: number; pct_change: number }[];
  estado_breakdown: { desc_estado: string; monto: number; is_accepted: boolean; share_pct: number }[];
  top_cuentas: { cuenta_alias: string; desc_cuenta: string; gna: number; total: number; gna_ratio: number }[];
  top_sostenedores: { sost_id: string; gna: number; total: number; gna_ratio: number }[];
}

const fmt = (v: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const yoyIcon = (pct: number) => {
  if (pct > 5) return <TrendingUp className="w-4 h-4 text-red-500" />;
  if (pct < -5) return <TrendingDown className="w-4 h-4 text-emerald-500" />;
  return <Minus className="w-4 h-4 text-gray-400" />;
};

const riskBadge = (level: string) => {
  if (level === "CRITICO") return "bg-red-100 text-red-700 border-red-200";
  if (level === "ALERTA") return "bg-amber-100 text-amber-700 border-amber-200";
  if (level === "INFO") return "bg-blue-100 text-blue-700 border-blue-200";
  return "bg-emerald-100 text-emerald-700 border-emerald-200";
};

export default function GnaPage() {
  const [data, setData] = useState<GnaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filterPeriodo, setFilterPeriodo] = useState("");
  const [searchSost, setSearchSost] = useState("");
  const [showAllCuentas, setShowAllCuentas] = useState(false);
  const [showAllSost, setShowAllSost] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filterPeriodo) params.set("periodo", filterPeriodo);
      const res = await fetch(`/api/gna?${params}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar GNA");
    }
    setLoading(false);
  }, [filterPeriodo]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filteredSost = data?.top_sostenedores.filter(s =>
    !searchSost || s.sost_id.includes(searchSost),
  ) || [];

  const periodos = data ? Array.from(new Set(data.by_periodo.map(p => p.periodo))).sort() : [];

  return (
    <div className="min-h-screen">
      <AppHeader activeTab="gna" />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4">

        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-[var(--accent)]" />
              Gastos No Aceptados (GNA)
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Variación porcentual de gastos observados / rechazados — Métrica de Impacto Económico #1
            </p>
          </div>
          <div className="flex items-center gap-2">
            <a
              href="/api/export?type=alerts&format=csv"
              target="_blank"
              className="flex items-center gap-1.5 text-xs border border-[var(--border)] px-3 py-1.5 rounded-lg hover:bg-[var(--bg-secondary)]"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar
            </a>
            <button
              onClick={fetchData}
              disabled={loading}
              className="flex items-center gap-1.5 text-xs bg-[var(--accent)] text-white px-3 py-1.5 rounded-lg hover:opacity-80 disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </button>
          </div>
        </div>

        {/* Period filter */}
        <div className="flex items-center gap-2 mb-4">
          <Filter className="w-4 h-4 text-[var(--text-muted)]" />
          <select
            value={filterPeriodo}
            onChange={e => setFilterPeriodo(e.target.value)}
            className="px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="">Todos los períodos</option>
            {periodos.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </div>

        {loading && !data ? (
          <div className="flex justify-center py-16"><Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" /></div>
        ) : error ? (
          <div className="glass-card p-6 text-center text-red-500 text-sm">{error}</div>
        ) : data ? (
          <>
            {/* KPI cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              <div className={`glass-card p-4 border-l-4 ${
                data.summary.risk_level === "CRITICO" ? "border-l-red-500"
                : data.summary.risk_level === "ALERTA" ? "border-l-amber-500"
                : "border-l-emerald-500"
              }`}>
                <div className="text-[10px] text-[var(--text-muted)] mb-1">GNA Total</div>
                <div className="text-lg font-bold text-red-600">{fmt(data.summary.gna_total)}</div>
                <div className={`text-xs mt-1 px-1.5 py-0.5 rounded border inline-block ${riskBadge(data.summary.risk_level)}`}>
                  {data.summary.gna_ratio}% del gasto total
                </div>
              </div>
              <div className="glass-card p-4">
                <div className="text-[10px] text-[var(--text-muted)] mb-1">Gasto Total Analizado</div>
                <div className="text-lg font-bold">{fmt(data.summary.total_gastos)}</div>
                <div className="text-xs text-[var(--text-muted)]">{data.summary.rows_analyzed.toLocaleString("es-CL")} registros</div>
              </div>
              <div className="glass-card p-4">
                <div className="text-[10px] text-[var(--text-muted)] mb-1">Variación YOY GNA</div>
                <div className="flex items-center gap-1.5">
                  {data.summary.latest_yoy_pct !== null && yoyIcon(data.summary.latest_yoy_pct)}
                  <span className={`text-lg font-bold ${
                    (data.summary.latest_yoy_pct ?? 0) > 5 ? "text-red-600"
                    : (data.summary.latest_yoy_pct ?? 0) < -5 ? "text-emerald-600"
                    : "text-amber-600"
                  }`}>
                    {data.summary.latest_yoy_pct !== null
                      ? `${data.summary.latest_yoy_pct > 0 ? "+" : ""}${data.summary.latest_yoy_pct}%`
                      : "—"}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-muted)] capitalize">{data.summary.yoy_trend || "—"}</div>
              </div>
              <div className="glass-card p-4">
                <div className="text-[10px] text-[var(--text-muted)] mb-1">Gasto Aceptado</div>
                <div className="text-lg font-bold text-emerald-600">{fmt(data.summary.accepted_total)}</div>
                <div className="text-xs text-[var(--text-muted)]">{(100 - data.summary.gna_ratio).toFixed(1)}% del total</div>
              </div>
            </div>

            {/* GNA by period */}
            {data.by_periodo.length > 0 && (
              <div className="glass-card p-4 mb-4">
                <h2 className="text-sm font-semibold mb-3">GNA por Período</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th className="text-left py-1.5 pr-3 font-semibold text-[var(--text-muted)]">Período</th>
                        <th className="text-right py-1.5 px-2 font-semibold text-[var(--text-muted)]">Gasto Total</th>
                        <th className="text-right py-1.5 px-2 font-semibold text-[var(--text-muted)]">GNA</th>
                        <th className="text-right py-1.5 px-2 font-semibold text-[var(--text-muted)]">Ratio GNA</th>
                        <th className="py-1.5 pl-2 font-semibold text-[var(--text-muted)]">Distribución</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.by_periodo.map(p => (
                        <tr key={p.periodo} className="border-b border-[var(--border)] border-opacity-40 hover:bg-[var(--bg-secondary)]">
                          <td className="py-2 pr-3 font-medium">{p.periodo}</td>
                          <td className="py-2 px-2 text-right font-mono">{fmt(p.total_gastos)}</td>
                          <td className="py-2 px-2 text-right font-mono text-red-600 font-semibold">{fmt(p.gna)}</td>
                          <td className={`py-2 px-2 text-right font-mono font-semibold ${p.gna_ratio > 20 ? "text-red-600" : p.gna_ratio > 10 ? "text-amber-600" : "text-emerald-600"}`}>
                            {p.gna_ratio}%
                          </td>
                          <td className="py-2 pl-2">
                            <div className="w-32 h-2 bg-gray-100 rounded-full overflow-hidden">
                              <div className="h-full bg-red-400 rounded-full" style={{ width: `${Math.min(p.gna_ratio, 100)}%` }} />
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* YOY changes */}
                {data.yoy_changes.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-[var(--border)]">
                    <div className="text-xs font-semibold mb-2 text-[var(--text-muted)]">Variación Interanual del GNA</div>
                    <div className="flex flex-wrap gap-2">
                      {data.yoy_changes.map(c => (
                        <div key={`${c.from}-${c.to}`} className="flex items-center gap-1.5 text-xs border border-[var(--border)] rounded-lg px-2.5 py-1.5">
                          <span className="text-[var(--text-muted)]">{c.from}→{c.to}</span>
                          {yoyIcon(c.pct_change)}
                          <span className={`font-semibold ${c.pct_change > 10 ? "text-red-600" : c.pct_change < -10 ? "text-emerald-600" : "text-amber-600"}`}>
                            {c.pct_change > 0 ? "+" : ""}{c.pct_change}%
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Estado breakdown */}
            {data.estado_breakdown.length > 0 && (
              <div className="glass-card p-4 mb-4">
                <h2 className="text-sm font-semibold mb-3">Estados de Declaración</h2>
                <div className="space-y-1.5">
                  {data.estado_breakdown.slice(0, 12).map(e => (
                    <div key={e.desc_estado} className="flex items-center gap-2">
                      <span className={`w-2 h-2 rounded-full shrink-0 ${e.is_accepted ? "bg-emerald-500" : "bg-red-500"}`} />
                      <span className="text-xs w-48 truncate">{e.desc_estado}</span>
                      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full ${e.is_accepted ? "bg-emerald-400" : "bg-red-400"}`}
                          style={{ width: `${Math.min(e.share_pct, 100)}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono w-12 text-right">{e.share_pct}%</span>
                      <span className="text-xs font-mono text-[var(--text-muted)] w-28 text-right">{fmt(e.monto)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Top accounts */}
            {data.top_cuentas.length > 0 && (
              <div className="glass-card p-4 mb-4">
                <h2 className="text-sm font-semibold mb-3">Cuentas con Mayor GNA</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th className="text-left py-1.5 pr-3 font-semibold text-[var(--text-muted)]">Cuenta</th>
                        <th className="text-right py-1.5 px-2 font-semibold text-[var(--text-muted)]">GNA</th>
                        <th className="text-right py-1.5 px-2 font-semibold text-[var(--text-muted)]">Total</th>
                        <th className="text-right py-1.5 pl-2 font-semibold text-[var(--text-muted)]">% GNA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(showAllCuentas ? data.top_cuentas : data.top_cuentas.slice(0, 8)).map(c => (
                        <tr key={c.cuenta_alias} className="border-b border-[var(--border)] border-opacity-40 hover:bg-[var(--bg-secondary)]">
                          <td className="py-1.5 pr-3">
                            <div className="font-medium">{c.cuenta_alias}</div>
                            <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[200px]">{c.desc_cuenta}</div>
                          </td>
                          <td className="py-1.5 px-2 text-right font-mono text-red-600 font-semibold">{fmt(c.gna)}</td>
                          <td className="py-1.5 px-2 text-right font-mono">{fmt(c.total)}</td>
                          <td className={`py-1.5 pl-2 text-right font-mono font-semibold ${c.gna_ratio > 50 ? "text-red-600" : c.gna_ratio > 20 ? "text-amber-600" : ""}`}>
                            {c.gna_ratio}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.top_cuentas.length > 8 && (
                  <button onClick={() => setShowAllCuentas(!showAllCuentas)} className="mt-2 text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
                    {showAllCuentas ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showAllCuentas ? "Ver menos" : `Ver todas (${data.top_cuentas.length})`}
                  </button>
                )}
              </div>
            )}

            {/* Top sostenedores */}
            {filteredSost.length > 0 && (
              <div className="glass-card p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-sm font-semibold">Sostenedores con Mayor GNA</h2>
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                    <input
                      value={searchSost}
                      onChange={e => setSearchSost(e.target.value)}
                      placeholder="Buscar ID..."
                      className="pl-7 pr-3 py-1 text-xs bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg focus:outline-none"
                    />
                  </div>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)]">
                        <th className="text-left py-1.5 pr-3 font-semibold text-[var(--text-muted)]">Sostenedor</th>
                        <th className="text-right py-1.5 px-2 font-semibold text-[var(--text-muted)]">GNA</th>
                        <th className="text-right py-1.5 px-2 font-semibold text-[var(--text-muted)]">Total Gastos</th>
                        <th className="text-right py-1.5 pl-2 font-semibold text-[var(--text-muted)]">% GNA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(showAllSost ? filteredSost : filteredSost.slice(0, 10)).map(s => (
                        <tr key={s.sost_id} className="border-b border-[var(--border)] border-opacity-40 hover:bg-[var(--bg-secondary)]">
                          <td className="py-1.5 pr-3 font-mono font-medium">{s.sost_id}</td>
                          <td className="py-1.5 px-2 text-right font-mono text-red-600 font-semibold">{fmt(s.gna)}</td>
                          <td className="py-1.5 px-2 text-right font-mono">{fmt(s.total)}</td>
                          <td className={`py-1.5 pl-2 text-right font-mono font-semibold ${s.gna_ratio > 20 ? "text-red-600" : s.gna_ratio > 10 ? "text-amber-600" : ""}`}>
                            {s.gna_ratio}%
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filteredSost.length > 10 && (
                  <button onClick={() => setShowAllSost(!showAllSost)} className="mt-2 text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
                    {showAllSost ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                    {showAllSost ? "Ver menos" : `Ver todos (${filteredSost.length})`}
                  </button>
                )}
              </div>
            )}
          </>
        ) : null}
      </main>
    </div>
  );
}
