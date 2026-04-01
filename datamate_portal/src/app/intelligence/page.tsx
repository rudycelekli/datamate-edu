"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import AppHeader from "@/components/AppHeader";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
  CartesianGrid, LineChart, Line,
} from "recharts";
import {
  Loader2, TrendingUp, DollarSign, FileText, Building2,
  Sparkles, X, ChevronDown, ChevronUp, BarChart3,
  MessageSquare, Send, Trash2, Brain,
  AlertTriangle, ShieldAlert, Search, Copy, Check,
} from "lucide-react";

const COLORS = [
  "#2563EB", "#16A34A", "#D97706", "#7C3AED", "#DC2626",
  "#0891B2", "#4F46E5", "#059669", "#E11D48", "#8B5CF6",
];

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

const fmtCurrencyShort = (n: number) => {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

const CustomTooltip = ({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number; name: string; color: string }>; label?: string }) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-3 text-xs">
      <p className="font-semibold mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={i} style={{ color: p.color }}>{p.name}: {typeof p.value === "number" && p.name.toLowerCase().includes("monto") ? fmtCurrencyShort(p.value) : p.value.toLocaleString()}</p>
      ))}
    </div>
  );
};

type Section = "snapshot" | "risk" | "ingresogasto" | "tipodocumento" | "regiones" | "dependencias" | "cuentas" | "tendencia" | "subvenciones" | "deepanalysis";

interface StatsData {
  totalRegistros: number;
  totalMonto: number;
  totalIngresos: number;
  totalGastos: number;
  totalSostenedores: number;
  totalPeriodos: number;
  regionData: Array<{ name: string; count: number; monto: number }>;
  dependenciaData: Array<{ name: string; count: number; monto: number }>;
  periodoData: Array<{ name: string; count: number; monto: number }>;
  cuentaData: Array<{ name: string; count: number; monto: number }>;
  subvencionData: Array<{ name: string; count: number; monto: number }>;
  tipoCuentaData: Array<{ name: string; count: number; monto: number }>;
  tipoDocumentoData: Array<{ name: string; count: number; monto: number }>;
  topRegion: string;
  topRegionPercent: string;
  // Remuneraciones
  totalRemuneraciones: number;
  totalHaber: number;
  totalDescuento: number;
  totalLiquido: number;
  promedioLiquido: number;
  proporcionRemuneraciones: number;
  filterOptions?: {
    regiones: string[];
    dependencias: string[];
    periodos: string[];
    subvenciones: string[];
    cuentas: string[];
  };
}

interface RiskFlag {
  indicator: string;
  value: number;
  threshold: string;
  level: "CRITICAL" | "ALERT" | "OK";
  detail: string;
}

interface FlaggedSostenedor {
  sostId: string;
  region: string;
  dependencia: string;
  totalIngresos: number;
  totalGastos: number;
  balance: number;
  adminRatio: number;
  payrollRatio: number;
  riskScore: number;
  riskLevel: "CRITICAL" | "ALERT" | "OK";
  flags: RiskFlag[];
}

interface RiskData {
  flaggedSostenedores: FlaggedSostenedor[];
  totalFlagged: number;
  criticalCount: number;
  alertCount: number;
  avgRiskScore: number;
}

export default function IntelligencePage() {
  const [serverStats, setServerStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedSection, setExpandedSection] = useState<Section | null>("snapshot");
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [filterRegion, setFilterRegion] = useState("");
  const [filterDependencia, setFilterDependencia] = useState("");
  const [filterPeriodo, setFilterPeriodo] = useState("");
  const [filterSubvencion, setFilterSubvencion] = useState("");

  // AI insight
  const [insightQuery, setInsightQuery] = useState("");
  const [insightResult, setInsightResult] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [showInsight, setShowInsight] = useState(false);

  // AI Chat
  interface AiChart {
    type: "bar" | "pie" | "line" | "horizontal-bar" | "table";
    title: string;
    dataKey: string;
    nameKey: string;
    data: Array<Record<string, unknown>>;
    fullData?: Array<Record<string, unknown>>;
    formatValue?: "currency" | "number" | "percent";
  }
  interface AiChatMessage {
    role: "user" | "assistant";
    text: string;
    charts?: AiChart[];
  }
  const [aiChatInput, setAiChatInput] = useState("");
  const [aiChatMessages, setAiChatMessages] = useState<AiChatMessage[]>([]);
  const [aiChatLoading, setAiChatLoading] = useState(false);

  // Deep Analysis
  const [deepAnalysisResult, setDeepAnalysisResult] = useState("");
  const [deepAnalysisLoading, setDeepAnalysisLoading] = useState(false);
  const [deepAnalysisRan, setDeepAnalysisRan] = useState(false);
  const [deepFocusRegion, setDeepFocusRegion] = useState("");
  const [deepFocusDependencia, setDeepFocusDependencia] = useState("");
  const [deepFocusTopic, setDeepFocusTopic] = useState("");
  const deepAbortRef = useRef<AbortController | null>(null);

  // Risk flags
  const [riskData, setRiskData] = useState<RiskData | null>(null);
  const [riskLoading, setRiskLoading] = useState(false);
  const [riskSortField, setRiskSortField] = useState<"riskScore" | "adminRatio" | "balance">("riskScore");
  const [riskSortDir, setRiskSortDir] = useState<"asc" | "desc">("desc");
  const [riskSearch, setRiskSearch] = useState("");

  // AI Feedback modal
  const [feedbackSost, setFeedbackSost] = useState<FlaggedSostenedor | null>(null);
  const [feedbackResult, setFeedbackResult] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackCopied, setFeedbackCopied] = useState(false);
  const feedbackAbortRef = useRef<AbortController | null>(null);

  // Suppress unused warning
  void insightQuery;
  void setInsightQuery;

  const fetchAll = useCallback(async () => {
    setError("");
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (filterRegion) params.set("region", filterRegion);
      if (filterDependencia) params.set("dependencia", filterDependencia);
      if (filterPeriodo) params.set("periodo", filterPeriodo);
      if (filterSubvencion) params.set("subvencion", filterSubvencion);

      const res = await fetch(`/api/intelligence/stats?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setServerStats(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Error al cargar datos");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterRegion, filterDependencia, filterPeriodo, filterSubvencion]);

  const fetchRiskFlags = useCallback(async () => {
    setRiskLoading(true);
    try {
      const params = new URLSearchParams();
      if (filterRegion) params.set("region", filterRegion);
      if (filterDependencia) params.set("dependencia", filterDependencia);
      if (filterPeriodo) params.set("periodo", filterPeriodo);
      if (filterSubvencion) params.set("subvencion", filterSubvencion);

      const res = await fetch(`/api/intelligence/risk-flags?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setRiskData(data);
    } catch {
      // Risk data is supplementary — don't block main page
      setRiskData(null);
    } finally {
      setRiskLoading(false);
    }
  }, [filterRegion, filterDependencia, filterPeriodo, filterSubvencion]);

  useEffect(() => {
    fetchAll();
    fetchRiskFlags();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAll, fetchRiskFlags]);

  const fo = serverStats?.filterOptions;
  const filterOptions = {
    regiones: (fo?.regiones || []) as string[],
    dependencias: (fo?.dependencias || []) as string[],
    periodos: (fo?.periodos || []) as string[],
    subvenciones: (fo?.subvenciones || []) as string[],
  };

  const activeFilterCount = [filterRegion, filterDependencia, filterPeriodo, filterSubvencion].filter(Boolean).length;

  const stats: StatsData = serverStats || {
    totalRegistros: 0, totalMonto: 0, totalIngresos: 0, totalGastos: 0,
    totalSostenedores: 0, totalPeriodos: 0,
    regionData: [], dependenciaData: [], periodoData: [], cuentaData: [],
    subvencionData: [], tipoCuentaData: [], tipoDocumentoData: [],
    topRegion: "--", topRegionPercent: "0",
    totalRemuneraciones: 0, totalHaber: 0, totalDescuento: 0, totalLiquido: 0,
    promedioLiquido: 0, proporcionRemuneraciones: 0,
  };

  // AI Insight
  const getInsight = async (chartName: string, data: unknown) => {
    setShowInsight(true);
    setInsightLoading(true);
    setInsightResult("");
    try {
      const res = await fetch("/api/intelligence/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chartName, data,
          totalRegistros: stats.totalRegistros,
          totalMonto: stats.totalMonto,
        }),
      });
      const result = await res.json();
      setInsightResult(result.insight || result.error || "Sin resultado");
    } catch { setInsightResult("Error al obtener insight"); }
    finally { setInsightLoading(false); }
  };

  // AI Chat
  const sendAiChat = async () => {
    if (!aiChatInput.trim() || aiChatLoading) return;
    const question = aiChatInput.trim();
    setAiChatInput("");
    setAiChatMessages(prev => [...prev, { role: "user", text: question }]);
    setAiChatLoading(true);
    try {
      const res = await fetch("/api/intelligence/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          filters: {
            region: filterRegion || undefined,
            dependencia: filterDependencia || undefined,
            periodo: filterPeriodo || undefined,
            subvencion: filterSubvencion || undefined,
          },
        }),
      });
      const data = await res.json();
      if (data.error) {
        setAiChatMessages(prev => [...prev, { role: "assistant", text: data.error }]);
      } else {
        setAiChatMessages(prev => [...prev, {
          role: "assistant",
          text: data.summary || data.title || "",
          charts: data.charts,
        }]);
      }
    } catch { setAiChatMessages(prev => [...prev, { role: "assistant", text: "Error de conexion" }]); }
    finally { setAiChatLoading(false); }
  };

  // Deep Analysis
  const runDeepAnalysis = async () => {
    setDeepAnalysisLoading(true);
    setDeepAnalysisResult("");
    setDeepAnalysisRan(true);
    deepAbortRef.current = new AbortController();
    try {
      const res = await fetch("/api/intelligence/deep-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stats: serverStats,
          focus: {
            region: deepFocusRegion || undefined,
            dependencia: deepFocusDependencia || undefined,
            topic: deepFocusTopic || undefined,
          },
        }),
        signal: deepAbortRef.current.signal,
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setDeepAnalysisResult(text);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setDeepAnalysisResult(prev => prev + "\n\nError: " + err.message);
      }
    } finally {
      setDeepAnalysisLoading(false);
    }
  };

  // AI Feedback for individual sostenedor
  const openAiFeedback = async (sost: FlaggedSostenedor) => {
    setFeedbackSost(sost);
    setFeedbackResult("");
    setFeedbackLoading(true);
    setFeedbackCopied(false);
    feedbackAbortRef.current = new AbortController();
    try {
      const res = await fetch("/api/intelligence/ai-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sostId: sost.sostId, sostData: sost }),
        signal: feedbackAbortRef.current.signal,
      });
      if (!res.ok) throw new Error(`Error ${res.status}`);
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setFeedbackResult(text);
      }
    } catch (err: unknown) {
      if (err instanceof Error && err.name !== "AbortError") {
        setFeedbackResult(prev => prev + "\n\nError: " + err.message);
      }
    } finally {
      setFeedbackLoading(false);
    }
  };

  const closeFeedbackModal = () => {
    if (feedbackAbortRef.current) feedbackAbortRef.current.abort();
    setFeedbackSost(null);
    setFeedbackResult("");
    setFeedbackLoading(false);
  };

  const copyFeedback = async () => {
    await navigator.clipboard.writeText(feedbackResult);
    setFeedbackCopied(true);
    setTimeout(() => setFeedbackCopied(false), 2000);
  };

  // Risk table sorting + filtering
  const sortedRiskData = (() => {
    if (!riskData) return [];
    let list = [...riskData.flaggedSostenedores];
    if (riskSearch) {
      const q = riskSearch.toLowerCase();
      list = list.filter(s => s.sostId.toLowerCase().includes(q) || s.region.toLowerCase().includes(q));
    }
    list.sort((a, b) => {
      const av = a[riskSortField] as number;
      const bv = b[riskSortField] as number;
      return riskSortDir === "desc" ? bv - av : av - bv;
    });
    return list;
  })();

  const toggleRiskSort = (field: "riskScore" | "adminRatio" | "balance") => {
    if (riskSortField === field) setRiskSortDir(d => d === "desc" ? "asc" : "desc");
    else { setRiskSortField(field); setRiskSortDir("desc"); }
  };

  const toggleSection = (section: Section) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  const SectionHeader = ({ section, title, icon }: { section: Section; title: string; icon: React.ReactNode }) => (
    <button onClick={() => toggleSection(section)} className="w-full flex items-center justify-between p-4 hover:bg-[var(--bg-secondary)] transition-colors">
      <div className="flex items-center gap-2">
        {icon}
        <h3 className="font-semibold text-sm">{title}</h3>
      </div>
      {expandedSection === section ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
    </button>
  );

  const InsightButton = ({ chartName, data }: { chartName: string; data: unknown }) => (
    <button onClick={() => getInsight(chartName, data)} className="text-xs text-[var(--accent)] hover:underline flex items-center gap-1">
      <Sparkles className="w-3 h-3" /> Insight AI
    </button>
  );

  const selectClass = "px-2.5 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--accent)] min-w-0";

  if (loading) {
    return (
      <div className="min-h-screen">
        <AppHeader activeTab="intelligence" />
        <div className="flex items-center justify-center h-[60vh]">
          <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader activeTab="intelligence" rightContent={
        <button onClick={() => { fetchAll(); fetchRiskFlags(); }} disabled={refreshing} className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--accent)]">
          <TrendingUp className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} /> {refreshing ? "Actualizando..." : "Actualizar"}
        </button>
      } />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

        {/* Ask with AI - fixed full-width bar */}
        <div className="glass-card mb-4 p-4">
          <div className="flex items-center gap-2 mb-3">
            <MessageSquare className="w-5 h-5 text-[var(--accent)]" />
            <h3 className="text-sm font-semibold">Pregunta con IA</h3>
            {aiChatMessages.length > 0 && (
              <button onClick={() => setAiChatMessages([])} className="ml-auto text-xs text-[var(--text-muted)] hover:text-red-500 flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Limpiar
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <input
              value={aiChatInput}
              onChange={e => setAiChatInput(e.target.value)}
              onKeyDown={e => e.key === "Enter" && sendAiChat()}
              placeholder="Pregunta sobre gastos educativos..."
              className="flex-1 px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
            />
            <button onClick={sendAiChat} disabled={aiChatLoading} className="px-5 py-2.5 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:bg-[var(--accent-dark)] disabled:opacity-40 flex items-center gap-2">
              {aiChatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              Preguntar
            </button>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {["Top 10 regiones por gasto", "Distribucion por dependencia", "Tendencia por periodo", "Top cuentas de gasto"].map(q => (
              <button key={q} onClick={() => { setAiChatInput(q); }} className="px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-full text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
                {q}
              </button>
            ))}
          </div>
          {aiChatMessages.length > 0 && (
            <div className="mt-4 border-t border-[var(--border)] pt-4 space-y-3 max-h-[500px] overflow-y-auto">
              {aiChatMessages.map((msg, i) => (
                <div key={i} className={`text-sm ${msg.role === "user" ? "text-right" : ""}`}>
                  <div className={`inline-block max-w-[90%] px-3 py-2 rounded-lg ${msg.role === "user" ? "bg-[var(--accent)] text-white" : "bg-[var(--bg-secondary)]"}`}>
                    {msg.text}
                  </div>
                  {msg.charts?.map((chart, ci) => (
                    <div key={ci} className="mt-2 bg-white border border-[var(--border)] rounded-lg p-3">
                      <p className="text-xs font-semibold mb-2">{chart.title}</p>
                      <ResponsiveContainer width="100%" height={200}>
                        {chart.type === "pie" ? (
                          <PieChart>
                            <Pie data={chart.data} dataKey={chart.dataKey} nameKey={chart.nameKey} cx="50%" cy="50%" outerRadius={70}>
                              {chart.data.map((_, j) => <Cell key={j} fill={COLORS[j % COLORS.length]} />)}
                            </Pie>
                            <Tooltip />
                            <Legend />
                          </PieChart>
                        ) : chart.type === "line" ? (
                          <LineChart data={chart.data}>
                            <CartesianGrid strokeDasharray="3 3" />
                            <XAxis dataKey={chart.nameKey} tick={{ fontSize: 10 }} />
                            <YAxis />
                            <Tooltip />
                            <Line type="monotone" dataKey={chart.dataKey} stroke={COLORS[0]} />
                          </LineChart>
                        ) : (
                          <BarChart data={chart.data} layout={chart.type === "horizontal-bar" ? "vertical" : "horizontal"}>
                            <CartesianGrid strokeDasharray="3 3" />
                            {chart.type === "horizontal-bar" ? (
                              <>
                                <XAxis type="number" />
                                <YAxis type="category" dataKey={chart.nameKey} width={80} tick={{ fontSize: 10 }} />
                              </>
                            ) : (
                              <>
                                <XAxis dataKey={chart.nameKey} tick={{ fontSize: 10 }} />
                                <YAxis />
                              </>
                            )}
                            <Tooltip />
                            <Bar dataKey={chart.dataKey} fill={COLORS[0]} />
                          </BarChart>
                        )}
                      </ResponsiveContainer>
                    </div>
                  ))}
                </div>
              ))}
              {aiChatLoading && (
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" /> Pensando...
                </div>
              )}
            </div>
          )}
        </div>

        {showInsight && (
          <div className="glass-card p-4 mb-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-1.5"><Sparkles className="w-4 h-4 text-[var(--accent)]" /><span className="text-sm font-semibold">Insight AI</span></div>
              <button onClick={() => setShowInsight(false)}><X className="w-4 h-4 text-[var(--text-muted)]" /></button>
            </div>
            {insightLoading ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]"><Loader2 className="w-4 h-4 animate-spin" /> Analizando...</div>
            ) : (
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{insightResult}</p>
            )}
          </div>
        )}

        {/* Filters */}
        <div className="glass-card p-3 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Region</label>
              <select value={filterRegion} onChange={e => { setFilterRegion(e.target.value); }} className={`${selectClass} w-full`}>
                <option value="">Todas</option>
                {filterOptions.regiones.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Dependencia</label>
              <select value={filterDependencia} onChange={e => { setFilterDependencia(e.target.value); }} className={`${selectClass} w-full`}>
                <option value="">Todas</option>
                {filterOptions.dependencias.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Periodo</label>
              <select value={filterPeriodo} onChange={e => { setFilterPeriodo(e.target.value); }} className={`${selectClass} w-full`}>
                <option value="">Todos</option>
                {filterOptions.periodos.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Subvencion</label>
              <select value={filterSubvencion} onChange={e => { setFilterSubvencion(e.target.value); }} className={`${selectClass} w-full`}>
                <option value="">Todas</option>
                {filterOptions.subvenciones.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--border)]">
              <button onClick={() => { setFilterRegion(""); setFilterDependencia(""); setFilterPeriodo(""); setFilterSubvencion(""); }} className="text-xs text-[var(--accent)] hover:underline">
                Limpiar filtros ({activeFilterCount})
              </button>
            </div>
          )}
        </div>

        {/* Stats cards — original 4 + 4 remuneraciones */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-4">
          <div className="glass-card p-3 sm:p-4 flex items-center gap-3">
            <FileText className="w-5 h-5 text-[var(--accent)]" />
            <div><div className="text-[10px] text-[var(--text-muted)]">Total Registros</div><div className="text-lg font-semibold">{stats.totalRegistros.toLocaleString()}</div></div>
          </div>
          <div className="glass-card p-3 sm:p-4 flex items-center gap-3">
            <DollarSign className="w-5 h-5 text-emerald-600" />
            <div><div className="text-[10px] text-[var(--text-muted)]">Monto Total</div><div className="text-lg font-semibold">{fmtCurrencyShort(stats.totalMonto)}</div></div>
          </div>
          <div className="glass-card p-3 sm:p-4 flex items-center gap-3">
            <Building2 className="w-5 h-5 text-[var(--accent)]" />
            <div><div className="text-[10px] text-[var(--text-muted)]">Sostenedores</div><div className="text-lg font-semibold">{stats.totalSostenedores.toLocaleString()}</div></div>
          </div>
          <div className="glass-card p-3 sm:p-4 flex items-center gap-3">
            <TrendingUp className="w-5 h-5 text-emerald-600" />
            <div><div className="text-[10px] text-[var(--text-muted)]">Top Region</div><div className="text-lg font-semibold">{stats.topRegion} ({stats.topRegionPercent}%)</div></div>
          </div>
        </div>

        {/* Remuneraciones summary cards */}
        {stats.totalRemuneraciones > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-4">
            <div className="glass-card p-3 sm:p-4">
              <div className="text-[10px] text-[var(--text-muted)]">Total Haber</div>
              <div className="text-lg font-semibold text-emerald-700">{fmtCurrencyShort(stats.totalHaber)}</div>
            </div>
            <div className="glass-card p-3 sm:p-4">
              <div className="text-[10px] text-[var(--text-muted)]">Total Descuento</div>
              <div className="text-lg font-semibold text-red-600">{fmtCurrencyShort(stats.totalDescuento)}</div>
            </div>
            <div className="glass-card p-3 sm:p-4">
              <div className="text-[10px] text-[var(--text-muted)]">Total Liquido</div>
              <div className="text-lg font-semibold">{fmtCurrencyShort(stats.totalLiquido)}</div>
            </div>
            <div className="glass-card p-3 sm:p-4">
              <div className="text-[10px] text-[var(--text-muted)]">Promedio Liquido</div>
              <div className="text-lg font-semibold">{fmtCurrency(stats.promedioLiquido)}</div>
              {stats.proporcionRemuneraciones > 0 && (
                <div className="mt-1">
                  <div className="flex items-center justify-between text-[10px] text-[var(--text-muted)] mb-0.5">
                    <span>Remun/Gasto</span>
                    <span className={stats.proporcionRemuneraciones > 80 ? "text-red-600 font-semibold" : ""}>{stats.proporcionRemuneraciones}%</span>
                  </div>
                  <div className="w-full bg-gray-200 rounded-full h-1.5">
                    <div
                      className={`h-1.5 rounded-full ${stats.proporcionRemuneraciones > 80 ? "bg-red-500" : stats.proporcionRemuneraciones > 67 ? "bg-amber-500" : "bg-emerald-500"}`}
                      style={{ width: `${Math.min(100, stats.proporcionRemuneraciones)}%` }}
                    />
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ═══ RISK ALERTS SECTION ═══ */}
        <div className="glass-card overflow-hidden mb-4">
          <SectionHeader section="risk" title={`Alertas de Riesgo${riskData ? ` (${riskData.totalFlagged})` : ""}`} icon={<ShieldAlert className="w-4 h-4 text-red-600" />} />
          {expandedSection === "risk" && (
            <div className="p-4 border-t border-[var(--border)]">
              {riskLoading ? (
                <div className="flex items-center justify-center py-8 gap-2 text-sm text-[var(--text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" /> Calculando indicadores de riesgo...
                </div>
              ) : riskData && riskData.totalFlagged > 0 ? (
                <>
                  {/* Risk stat cards */}
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-4">
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <div className="text-[10px] text-red-600">Total Flagged</div>
                      <div className="text-xl font-bold text-red-700">{riskData.totalFlagged}</div>
                    </div>
                    <div className="bg-red-50 border border-red-200 rounded-lg p-3">
                      <div className="text-[10px] text-red-600">Criticos</div>
                      <div className="text-xl font-bold text-red-700">{riskData.criticalCount}</div>
                    </div>
                    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
                      <div className="text-[10px] text-amber-600">Alertas</div>
                      <div className="text-xl font-bold text-amber-700">{riskData.alertCount}</div>
                    </div>
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <div className="text-[10px] text-gray-500">Riesgo Promedio</div>
                      <div className={`text-xl font-bold ${riskData.avgRiskScore > 70 ? "text-red-700" : riskData.avgRiskScore > 40 ? "text-amber-700" : "text-emerald-700"}`}>
                        {riskData.avgRiskScore}/100
                      </div>
                    </div>
                  </div>

                  {/* Search */}
                  <div className="flex items-center gap-2 mb-3">
                    <div className="relative flex-1">
                      <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                      <input
                        value={riskSearch}
                        onChange={e => setRiskSearch(e.target.value)}
                        placeholder="Buscar por ID o region..."
                        className="w-full pl-8 pr-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--accent)]"
                      />
                    </div>
                    <span className="text-xs text-[var(--text-muted)]">{sortedRiskData.length} resultados</span>
                  </div>

                  {/* Flagged Sostenedores Table */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-[var(--border)]">
                          <th className="text-left py-2 px-2 font-medium text-[var(--text-muted)]">ID</th>
                          <th className="text-left py-2 px-2 font-medium text-[var(--text-muted)]">Region</th>
                          <th className="text-left py-2 px-2 font-medium text-[var(--text-muted)]">Dep.</th>
                          <th className="text-right py-2 px-2 font-medium text-[var(--text-muted)]">Ingresos</th>
                          <th className="text-right py-2 px-2 font-medium text-[var(--text-muted)]">Gastos</th>
                          <th className="text-right py-2 px-2 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--accent)]" onClick={() => toggleRiskSort("balance")}>
                            Balance {riskSortField === "balance" ? (riskSortDir === "desc" ? "▼" : "▲") : ""}
                          </th>
                          <th className="text-right py-2 px-2 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--accent)]" onClick={() => toggleRiskSort("adminRatio")}>
                            Admin% {riskSortField === "adminRatio" ? (riskSortDir === "desc" ? "▼" : "▲") : ""}
                          </th>
                          <th className="text-right py-2 px-2 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--accent)]" onClick={() => toggleRiskSort("riskScore")}>
                            Riesgo {riskSortField === "riskScore" ? (riskSortDir === "desc" ? "▼" : "▲") : ""}
                          </th>
                          <th className="text-center py-2 px-2 font-medium text-[var(--text-muted)]">Nivel</th>
                          <th className="text-center py-2 px-2 font-medium text-[var(--text-muted)]">Accion</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedRiskData.slice(0, 50).map((sost) => (
                          <tr
                            key={sost.sostId}
                            className={`border-b border-[var(--border)] ${
                              sost.riskLevel === "CRITICAL" ? "bg-red-50" : sost.riskLevel === "ALERT" ? "bg-amber-50" : ""
                            }`}
                          >
                            <td className="py-2 px-2 font-mono">{sost.sostId}</td>
                            <td className="py-2 px-2">{sost.region || "-"}</td>
                            <td className="py-2 px-2">{sost.dependencia || "-"}</td>
                            <td className="py-2 px-2 text-right">{fmtCurrencyShort(sost.totalIngresos)}</td>
                            <td className="py-2 px-2 text-right">{fmtCurrencyShort(sost.totalGastos)}</td>
                            <td className={`py-2 px-2 text-right font-medium ${sost.balance < 0 ? "text-red-600" : "text-emerald-600"}`}>
                              {fmtCurrencyShort(sost.balance)}
                            </td>
                            <td className={`py-2 px-2 text-right ${sost.adminRatio > 50 ? "text-red-600 font-semibold" : sost.adminRatio > 35 ? "text-amber-600" : ""}`}>
                              {sost.adminRatio}%
                            </td>
                            <td className="py-2 px-2 text-right font-semibold">{sost.riskScore}</td>
                            <td className="py-2 px-2 text-center">
                              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                                sost.riskLevel === "CRITICAL" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                              }`}>
                                <AlertTriangle className="w-3 h-3" />
                                {sost.riskLevel === "CRITICAL" ? "CRITICO" : "ALERTA"}
                              </span>
                            </td>
                            <td className="py-2 px-2 text-center">
                              <button
                                onClick={() => openAiFeedback(sost)}
                                className="px-2 py-1 bg-[var(--accent)] text-white rounded text-[10px] font-medium hover:bg-[var(--accent-dark)] flex items-center gap-1 mx-auto"
                              >
                                <Brain className="w-3 h-3" /> Analizar con IA
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {sortedRiskData.length > 50 && (
                    <p className="text-xs text-[var(--text-muted)] mt-2 text-center">
                      Mostrando 50 de {sortedRiskData.length} sostenedores flaggeados
                    </p>
                  )}
                </>
              ) : (
                <p className="text-sm text-[var(--text-muted)] text-center py-8">
                  No se detectaron sostenedores con alertas de riesgo en los datos actuales.
                </p>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* ═══ NEW: Ingreso vs Gasto ═══ */}
            <div className="glass-card overflow-hidden">
              <SectionHeader section="ingresogasto" title="Ingresos vs Gastos por Tipo de Cuenta" icon={<BarChart3 className="w-4 h-4 text-emerald-600" />} />
              {expandedSection === "ingresogasto" && (
                <div className="p-4 border-t border-[var(--border)]">
                  <div className="flex justify-end mb-2"><InsightButton chartName="Ingresos vs Gastos" data={stats.tipoCuentaData} /></div>
                  {stats.tipoCuentaData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={stats.tipoCuentaData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={v => fmtCurrencyShort(v)} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="monto" name="Monto" fill={COLORS[0]}>
                          {stats.tipoCuentaData.map((entry, i) => (
                            <Cell key={i} fill={entry.name.toLowerCase().includes("ingreso") ? "#16A34A" : "#DC2626"} />
                          ))}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-[var(--text-muted)] text-center py-8">Sin datos</p>}
                  {/* Summary below chart */}
                  {stats.totalIngresos > 0 && (
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="p-2 bg-emerald-50 rounded"><div className="text-[10px] text-emerald-600">Ingresos</div><div className="font-semibold text-emerald-700">{fmtCurrencyShort(stats.totalIngresos)}</div></div>
                      <div className="p-2 bg-red-50 rounded"><div className="text-[10px] text-red-600">Gastos</div><div className="font-semibold text-red-700">{fmtCurrencyShort(stats.totalGastos)}</div></div>
                      <div className={`p-2 rounded ${stats.totalIngresos - stats.totalGastos >= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
                        <div className="text-[10px] text-gray-500">Balance</div>
                        <div className={`font-semibold ${stats.totalIngresos - stats.totalGastos >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                          {fmtCurrencyShort(stats.totalIngresos - stats.totalGastos)}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* ═══ NEW: Tipos de Documento ═══ */}
            <div className="glass-card overflow-hidden">
              <SectionHeader section="tipodocumento" title="Tipos de Documento" icon={<FileText className="w-4 h-4 text-purple-600" />} />
              {expandedSection === "tipodocumento" && (
                <div className="p-4 border-t border-[var(--border)]">
                  <div className="flex justify-end mb-2"><InsightButton chartName="Tipos de Documento" data={stats.tipoDocumentoData} /></div>
                  {stats.tipoDocumentoData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={Math.max(200, stats.tipoDocumentoData.slice(0, 12).length * 28)}>
                      <BarChart data={stats.tipoDocumentoData.slice(0, 12)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={v => fmtCurrencyShort(v)} />
                        <YAxis type="category" dataKey="name" width={70} tick={{ fontSize: 10 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="monto" fill={COLORS[3]} name="Monto" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-[var(--text-muted)] text-center py-8">Sin datos de documentos</p>}
                </div>
              )}
            </div>

            {/* Gasto por Region */}
            <div className="glass-card overflow-hidden">
              <SectionHeader section="regiones" title="Gasto por Region" icon={<BarChart3 className="w-4 h-4 text-[var(--accent)]" />} />
              {expandedSection === "regiones" && (
                <div className="p-4 border-t border-[var(--border)]">
                  <div className="flex justify-end mb-2"><InsightButton chartName="Gasto por Region" data={stats.regionData} /></div>
                  {stats.regionData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={stats.regionData.slice(0, 15)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={v => fmtCurrencyShort(v)} />
                        <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="monto" fill={COLORS[0]} name="Monto" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-[var(--text-muted)] text-center py-8">Sin datos</p>}
                </div>
              )}
            </div>

            {/* Distribucion por Dependencia */}
            <div className="glass-card overflow-hidden">
              <SectionHeader section="dependencias" title="Distribucion por Tipo de Dependencia" icon={<Building2 className="w-4 h-4 text-purple-600" />} />
              {expandedSection === "dependencias" && (
                <div className="p-4 border-t border-[var(--border)]">
                  <div className="flex justify-end mb-2"><InsightButton chartName="Distribucion por Dependencia" data={stats.dependenciaData} /></div>
                  {stats.dependenciaData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <PieChart>
                        <Pie data={stats.dependenciaData} dataKey="monto" nameKey="name" cx="50%" cy="50%" outerRadius={100} label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} (${((percent ?? 0) * 100).toFixed(0)}%)`}>
                          {stats.dependenciaData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => fmtCurrency(Number(v))} />
                        <Legend />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-[var(--text-muted)] text-center py-8">Sin datos</p>}
                </div>
              )}
            </div>

            {/* Top Cuentas de Gasto */}
            <div className="glass-card overflow-hidden">
              <SectionHeader section="cuentas" title="Top Cuentas de Gasto" icon={<DollarSign className="w-4 h-4 text-emerald-600" />} />
              {expandedSection === "cuentas" && (
                <div className="p-4 border-t border-[var(--border)]">
                  <div className="flex justify-end mb-2"><InsightButton chartName="Top Cuentas de Gasto" data={stats.cuentaData} /></div>
                  {stats.cuentaData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={stats.cuentaData.slice(0, 10)} layout="vertical">
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis type="number" tickFormatter={v => fmtCurrencyShort(v)} />
                        <YAxis type="category" dataKey="name" width={150} tick={{ fontSize: 10 }} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="monto" fill={COLORS[3]} name="Monto" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-[var(--text-muted)] text-center py-8">Sin datos</p>}
                </div>
              )}
            </div>

            {/* Tendencia por Periodo */}
            <div className="glass-card overflow-hidden">
              <SectionHeader section="tendencia" title="Tendencia de Gastos por Periodo" icon={<TrendingUp className="w-4 h-4 text-blue-600" />} />
              {expandedSection === "tendencia" && (
                <div className="p-4 border-t border-[var(--border)]">
                  <div className="flex justify-end mb-2"><InsightButton chartName="Tendencia por Periodo" data={stats.periodoData} /></div>
                  {stats.periodoData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <LineChart data={stats.periodoData}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                        <YAxis tickFormatter={v => fmtCurrencyShort(v)} />
                        <Tooltip content={<CustomTooltip />} />
                        <Line type="monotone" dataKey="monto" stroke={COLORS[0]} strokeWidth={2} name="Monto" dot={{ r: 3 }} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-[var(--text-muted)] text-center py-8">Sin datos</p>}
                </div>
              )}
            </div>

            {/* Subvenciones */}
            <div className="glass-card overflow-hidden">
              <SectionHeader section="subvenciones" title="Distribucion por Subvencion" icon={<FileText className="w-4 h-4 text-amber-600" />} />
              {expandedSection === "subvenciones" && (
                <div className="p-4 border-t border-[var(--border)]">
                  <div className="flex justify-end mb-2"><InsightButton chartName="Distribucion por Subvencion" data={stats.subvencionData} /></div>
                  {stats.subvencionData.length > 0 ? (
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={stats.subvencionData.slice(0, 10)}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} angle={-45} textAnchor="end" height={80} />
                        <YAxis tickFormatter={v => fmtCurrencyShort(v)} />
                        <Tooltip content={<CustomTooltip />} />
                        <Bar dataKey="monto" fill={COLORS[1]} name="Monto" />
                      </BarChart>
                    </ResponsiveContainer>
                  ) : <p className="text-sm text-[var(--text-muted)] text-center py-8">Sin datos</p>}
                </div>
              )}
            </div>

            {/* Deep Analysis */}
            <div className="glass-card overflow-hidden">
              <SectionHeader section="deepanalysis" title="Analisis Profundo con IA" icon={<Brain className="w-4 h-4 text-purple-600" />} />
              {expandedSection === "deepanalysis" && (
                <div className="p-4 border-t border-[var(--border)]">
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                    <div>
                      <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Enfoque Region</label>
                      <select value={deepFocusRegion} onChange={e => setDeepFocusRegion(e.target.value)} className={`${selectClass} w-full`}>
                        <option value="">Todas</option>
                        {filterOptions.regiones.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Enfoque Dependencia</label>
                      <select value={deepFocusDependencia} onChange={e => setDeepFocusDependencia(e.target.value)} className={`${selectClass} w-full`}>
                        <option value="">Todas</option>
                        {filterOptions.dependencias.map(d => <option key={d} value={d}>{d}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Tema Especifico</label>
                      <input type="text" value={deepFocusTopic} onChange={e => setDeepFocusTopic(e.target.value)} placeholder="ej: concentracion de proveedores" className={`${selectClass} w-full`} />
                    </div>
                  </div>
                  <button
                    onClick={runDeepAnalysis}
                    disabled={deepAnalysisLoading || !serverStats}
                    className="w-full py-2.5 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:bg-[var(--accent-dark)] disabled:opacity-40 flex items-center justify-center gap-2"
                  >
                    {deepAnalysisLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
                    {deepAnalysisLoading ? "Analizando..." : deepAnalysisRan ? "Ejecutar Nuevo Analisis" : "Ejecutar Analisis Profundo"}
                  </button>
                  {deepAnalysisResult && (
                    <div className="mt-4 prose prose-sm max-w-none text-sm leading-relaxed whitespace-pre-wrap">
                      {deepAnalysisResult}
                    </div>
                  )}
                </div>
              )}
            </div>
        </div>
      </main>

      {/* ═══ AI FEEDBACK MODAL ═══ */}
      {feedbackSost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-[var(--accent)]" />
                <h3 className="font-semibold text-sm">Analisis IA — Sostenedor {feedbackSost.sostId}</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                  feedbackSost.riskLevel === "CRITICAL" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                }`}>
                  {feedbackSost.riskLevel === "CRITICAL" ? "CRITICO" : "ALERTA"} — Score {feedbackSost.riskScore}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {feedbackResult && !feedbackLoading && (
                  <button onClick={copyFeedback} className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg transition-colors">
                    {feedbackCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {feedbackCopied ? "Copiado" : "Copiar"}
                  </button>
                )}
                <button onClick={closeFeedbackModal} className="p-1 hover:bg-gray-100 rounded">
                  <X className="w-5 h-5 text-gray-500" />
                </button>
              </div>
            </div>

            {/* Modal Body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {/* Sostenedor summary */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-xs">
                <div className="bg-gray-50 rounded p-2"><span className="text-[10px] text-gray-500 block">Region</span>{feedbackSost.region || "-"}</div>
                <div className="bg-gray-50 rounded p-2"><span className="text-[10px] text-gray-500 block">Admin%</span><span className={feedbackSost.adminRatio > 50 ? "text-red-600 font-semibold" : ""}>{feedbackSost.adminRatio}%</span></div>
                <div className="bg-gray-50 rounded p-2"><span className="text-[10px] text-gray-500 block">Payroll%</span><span className={feedbackSost.payrollRatio > 95 ? "text-red-600 font-semibold" : ""}>{feedbackSost.payrollRatio}%</span></div>
                <div className={`rounded p-2 ${feedbackSost.balance < 0 ? "bg-red-50" : "bg-emerald-50"}`}>
                  <span className="text-[10px] text-gray-500 block">Balance</span>
                  <span className={feedbackSost.balance < 0 ? "text-red-600 font-semibold" : "text-emerald-600"}>{fmtCurrencyShort(feedbackSost.balance)}</span>
                </div>
              </div>

              {/* Flags summary */}
              <div className="mb-4 space-y-1">
                {feedbackSost.flags.map((f, i) => (
                  <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${
                    f.level === "CRITICAL" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"
                  }`}>
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    <span className="font-medium">{f.indicator}:</span> {f.detail}
                  </div>
                ))}
              </div>

              {/* AI Analysis */}
              {feedbackLoading && !feedbackResult && (
                <div className="flex items-center justify-center py-12 gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Generando analisis...
                </div>
              )}
              {feedbackResult && (
                <div className="prose prose-sm max-w-none text-sm leading-relaxed whitespace-pre-wrap">
                  {feedbackResult}
                  {feedbackLoading && <span className="inline-block w-2 h-4 bg-[var(--accent)] animate-pulse ml-0.5" />}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
