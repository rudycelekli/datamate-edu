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
  AlertTriangle, ShieldAlert, Search, Copy, Check, TrendingDown,
} from "lucide-react";

const COLORS = [
  "#2563EB", "#16A34A", "#D97706", "#7C3AED", "#DC2626",
  "#0891B2", "#4F46E5", "#059669", "#E11D48", "#8B5CF6",
];
const RISK_COLORS = { CRITICAL: "#DC2626", ALERT: "#D97706", OK: "#16A34A" };

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

type Section = "ingresogasto" | "tipodocumento" | "regiones" | "dependencias" | "cuentas" | "tendencia" | "subvenciones" | "remuneraciones";

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
  const [expandedSection, setExpandedSection] = useState<Section | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [filterRegion, setFilterRegion] = useState("");
  const [filterDependencia, setFilterDependencia] = useState("");
  const [filterPeriodo, setFilterPeriodo] = useState("");
  const [filterSubvencion, setFilterSubvencion] = useState("");

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
  const [showChat, setShowChat] = useState(false);

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
  const [riskShowAll, setRiskShowAll] = useState(false);

  // AI Feedback modal
  const [feedbackSost, setFeedbackSost] = useState<FlaggedSostenedor | null>(null);
  const [feedbackResult, setFeedbackResult] = useState("");
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackCopied, setFeedbackCopied] = useState(false);
  const feedbackAbortRef = useRef<AbortController | null>(null);

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
      setServerStats(await res.json());
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
      setRiskData(await res.json());
    } catch {
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

  // Auto-run deep analysis once risk + stats data arrives
  useEffect(() => {
    if (serverStats && riskData && !deepAnalysisRan && !deepAnalysisLoading) {
      runDeepAnalysis();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverStats, riskData]);

  const fo = serverStats?.filterOptions;
  const filterOptions = {
    regiones: (fo?.regiones || []) as string[],
    dependencias: (fo?.dependencias || []) as string[],
    periodos: (fo?.periodos || []) as string[],
    subvenciones: (fo?.subvenciones || []) as string[],
  };

  const stats: StatsData = serverStats || {
    totalRegistros: 0, totalMonto: 0, totalIngresos: 0, totalGastos: 0,
    totalSostenedores: 0, totalPeriodos: 0,
    regionData: [], dependenciaData: [], periodoData: [], cuentaData: [],
    subvencionData: [], tipoCuentaData: [], tipoDocumentoData: [],
    topRegion: "--", topRegionPercent: "0",
    totalRemuneraciones: 0, totalHaber: 0, totalDescuento: 0, totalLiquido: 0,
    promedioLiquido: 0, proporcionRemuneraciones: 0,
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
      setAiChatMessages(prev => [...prev, {
        role: "assistant",
        text: data.summary || data.title || data.error || "Sin resultado",
        charts: data.charts,
      }]);
    } catch {
      setAiChatMessages(prev => [...prev, { role: "assistant", text: "Error de conexion" }]);
    } finally {
      setAiChatLoading(false);
    }
  };

  // Deep Analysis
  const runDeepAnalysis = async () => {
    if (deepAnalysisLoading) return;
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
          riskSummary: riskData ? {
            totalFlagged: riskData.totalFlagged,
            criticalCount: riskData.criticalCount,
            alertCount: riskData.alertCount,
            avgRiskScore: riskData.avgRiskScore,
            topCriticals: riskData.flaggedSostenedores.filter(s => s.riskLevel === "CRITICAL").slice(0, 5),
          } : undefined,
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

  // AI Feedback
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
        setFeedbackResult("Error: " + err.message);
      }
    } finally {
      setFeedbackLoading(false);
    }
  };

  const closeFeedbackModal = () => {
    feedbackAbortRef.current?.abort();
    setFeedbackSost(null);
    setFeedbackResult("");
    setFeedbackLoading(false);
  };

  const copyFeedback = () => {
    navigator.clipboard.writeText(feedbackResult);
    setFeedbackCopied(true);
    setTimeout(() => setFeedbackCopied(false), 2000);
  };

  // Risk table
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
      <div className="flex items-center gap-2">{icon}<h3 className="font-semibold text-sm">{title}</h3></div>
      {expandedSection === section ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
    </button>
  );

  const selectClass = "px-2.5 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--accent)] min-w-0";

  // Derived risk metrics
  const totalSost = stats.totalSostenedores;
  const criticalCount = riskData?.criticalCount ?? 0;
  const alertCount = riskData?.alertCount ?? 0;
  const okCount = Math.max(0, totalSost - (riskData?.totalFlagged ?? 0));
  const portfolioBalance = stats.totalIngresos - stats.totalGastos;

  const riskDistData = [
    { name: "Crítico", value: criticalCount, color: RISK_COLORS.CRITICAL },
    { name: "Alerta", value: alertCount, color: RISK_COLORS.ALERT },
    { name: "OK", value: okCount, color: RISK_COLORS.OK },
  ].filter(d => d.value > 0);

  // Indicator distribution from flagged data
  const flagged = riskData?.flaggedSostenedores ?? [];
  const criticalAdmins = flagged.filter(s => s.adminRatio > 30).length;
  const alertAdmins = flagged.filter(s => s.adminRatio > 20 && s.adminRatio <= 30).length;
  const criticalPayroll = flagged.filter(s => s.payrollRatio > 85).length;
  const alertPayroll = flagged.filter(s => s.payrollRatio > 65 && s.payrollRatio <= 85).length;
  const criticalBalance = flagged.filter(s => s.balance < 0 && s.totalIngresos > 0 && (s.balance / s.totalIngresos * 100) < -5).length;
  const alertBalance = flagged.filter(s => s.balance / Math.max(s.totalIngresos, 1) * 100 >= -5 && s.balance / Math.max(s.totalIngresos, 1) * 100 < 5).length;

  const displayedRisk = riskShowAll ? sortedRiskData : sortedRiskData.slice(0, 25);

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

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6 space-y-4">
        {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

        {/* ═══ FILTERS ═══ */}
        <div className="glass-card p-3">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Región</label>
              <select value={filterRegion} onChange={e => setFilterRegion(e.target.value)} className={`${selectClass} w-full`}>
                <option value="">Todas</option>
                {filterOptions.regiones.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Dependencia</label>
              <select value={filterDependencia} onChange={e => setFilterDependencia(e.target.value)} className={`${selectClass} w-full`}>
                <option value="">Todas</option>
                {filterOptions.dependencias.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Periodo</label>
              <select value={filterPeriodo} onChange={e => setFilterPeriodo(e.target.value)} className={`${selectClass} w-full`}>
                <option value="">Todos</option>
                {filterOptions.periodos.map(p => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Subvención</label>
              <select value={filterSubvencion} onChange={e => setFilterSubvencion(e.target.value)} className={`${selectClass} w-full`}>
                <option value="">Todas</option>
                {filterOptions.subvenciones.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ═══ PORTFOLIO RISK HERO ═══ */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="glass-card p-4 col-span-1">
            <div className="text-[10px] text-[var(--text-muted)] mb-1">Total Sostenedores</div>
            <div className="text-2xl font-bold">{totalSost.toLocaleString()}</div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{stats.totalPeriodos} período(s)</div>
          </div>
          <div className="glass-card p-4 border-l-4 border-red-500">
            <div className="text-[10px] text-red-600 mb-1 font-semibold uppercase">Críticos</div>
            {riskLoading ? <Loader2 className="w-5 h-5 animate-spin text-red-400" /> : (
              <>
                <div className="text-2xl font-bold text-red-700">{criticalCount.toLocaleString()}</div>
                <div className="text-[10px] text-red-500 mt-0.5">{totalSost > 0 ? ((criticalCount / totalSost) * 100).toFixed(1) : 0}% del total</div>
              </>
            )}
          </div>
          <div className="glass-card p-4 border-l-4 border-amber-500">
            <div className="text-[10px] text-amber-600 mb-1 font-semibold uppercase">En Alerta</div>
            {riskLoading ? <Loader2 className="w-5 h-5 animate-spin text-amber-400" /> : (
              <>
                <div className="text-2xl font-bold text-amber-700">{alertCount.toLocaleString()}</div>
                <div className="text-[10px] text-amber-500 mt-0.5">{totalSost > 0 ? ((alertCount / totalSost) * 100).toFixed(1) : 0}% del total</div>
              </>
            )}
          </div>
          <div className="glass-card p-4 border-l-4 border-emerald-500">
            <div className="text-[10px] text-emerald-600 mb-1 font-semibold uppercase">OK</div>
            <div className="text-2xl font-bold text-emerald-700">{okCount.toLocaleString()}</div>
            <div className="text-[10px] text-emerald-500 mt-0.5">{totalSost > 0 ? ((okCount / totalSost) * 100).toFixed(1) : 0}% del total</div>
          </div>
          <div className="glass-card p-4 col-span-1">
            <div className="text-[10px] text-[var(--text-muted)] mb-1">Ingresos Totales</div>
            <div className="text-xl font-bold text-emerald-700">{fmtCurrencyShort(stats.totalIngresos)}</div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Portfolio completo</div>
          </div>
          <div className={`glass-card p-4 border-l-4 ${portfolioBalance >= 0 ? "border-emerald-500" : "border-red-500"}`}>
            <div className="text-[10px] text-[var(--text-muted)] mb-1">Balance Portfolio</div>
            <div className={`text-xl font-bold ${portfolioBalance >= 0 ? "text-emerald-700" : "text-red-700"}`}>
              {fmtCurrencyShort(portfolioBalance)}
            </div>
            <div className="text-[10px] text-[var(--text-muted)] mt-0.5 flex items-center gap-1">
              {portfolioBalance >= 0 ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : <TrendingDown className="w-3 h-3 text-red-500" />}
              {stats.totalIngresos > 0 ? ((portfolioBalance / stats.totalIngresos) * 100).toFixed(1) : 0}% margen
            </div>
          </div>
        </div>

        {/* ═══ RISK TABLE + DISTRIBUTION ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Risk Table */}
          <div className="lg:col-span-2 glass-card overflow-hidden">
            <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-5 h-5 text-red-600" />
                <h2 className="font-semibold text-sm">Sostenedores con Alertas de Riesgo</h2>
                {riskData && <span className="text-[10px] bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-semibold">{riskData.totalFlagged} flaggeados</span>}
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-[var(--text-muted)]" />
                <input
                  value={riskSearch}
                  onChange={e => setRiskSearch(e.target.value)}
                  placeholder="Buscar..."
                  className="pl-8 pr-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--accent)] w-36"
                />
              </div>
            </div>
            {riskLoading ? (
              <div className="flex items-center justify-center py-12 gap-2 text-sm text-[var(--text-muted)]">
                <Loader2 className="w-4 h-4 animate-spin" /> Calculando indicadores...
              </div>
            ) : sortedRiskData.length === 0 ? (
              <div className="py-12 text-center text-sm text-[var(--text-muted)]">
                <ShieldAlert className="w-8 h-8 mx-auto mb-2 text-gray-300" />
                No se detectaron alertas con los filtros actuales
              </div>
            ) : (
              <>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                        <th className="text-left py-2 px-3 font-medium text-[var(--text-muted)]">Sostenedor</th>
                        <th className="text-left py-2 px-2 font-medium text-[var(--text-muted)]">Dep.</th>
                        <th className="text-right py-2 px-2 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--accent)]" onClick={() => toggleRiskSort("adminRatio")}>
                          Admin% {riskSortField === "adminRatio" ? (riskSortDir === "desc" ? "▼" : "▲") : ""}
                        </th>
                        <th className="text-right py-2 px-2 font-medium text-[var(--text-muted)]">Payroll%</th>
                        <th className="text-right py-2 px-2 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--accent)]" onClick={() => toggleRiskSort("balance")}>
                          Balance {riskSortField === "balance" ? (riskSortDir === "desc" ? "▼" : "▲") : ""}
                        </th>
                        <th className="text-right py-2 px-2 font-medium text-[var(--text-muted)] cursor-pointer hover:text-[var(--accent)]" onClick={() => toggleRiskSort("riskScore")}>
                          Score {riskSortField === "riskScore" ? (riskSortDir === "desc" ? "▼" : "▲") : ""}
                        </th>
                        <th className="text-center py-2 px-2 font-medium text-[var(--text-muted)]">Nivel</th>
                        <th className="text-center py-2 px-2 font-medium text-[var(--text-muted)]">IA</th>
                      </tr>
                    </thead>
                    <tbody>
                      {displayedRisk.map((sost) => (
                        <tr key={sost.sostId} className={`border-b border-[var(--border)] hover:bg-[var(--bg-secondary)] ${sost.riskLevel === "CRITICAL" ? "bg-red-50/50" : sost.riskLevel === "ALERT" ? "bg-amber-50/30" : ""}`}>
                          <td className="py-2 px-3">
                            <div className="font-mono text-[10px] text-[var(--text-muted)]">{sost.sostId}</div>
                            <div className="text-[10px] text-[var(--text-muted)]">{sost.region}</div>
                          </td>
                          <td className="py-2 px-2 text-[10px]">{sost.dependencia || "-"}</td>
                          <td className={`py-2 px-2 text-right font-semibold ${sost.adminRatio > 30 ? "text-red-600" : sost.adminRatio > 20 ? "text-amber-600" : ""}`}>
                            {sost.adminRatio}%
                          </td>
                          <td className={`py-2 px-2 text-right ${sost.payrollRatio > 85 ? "text-red-600 font-semibold" : sost.payrollRatio > 65 ? "text-amber-600" : ""}`}>
                            {sost.payrollRatio > 0 ? `${sost.payrollRatio}%` : "—"}
                          </td>
                          <td className={`py-2 px-2 text-right font-medium ${sost.balance < 0 ? "text-red-600" : "text-emerald-600"}`}>
                            {fmtCurrencyShort(sost.balance)}
                          </td>
                          <td className="py-2 px-2 text-right">
                            <span className={`font-bold ${sost.riskScore > 45 ? "text-red-600" : "text-amber-600"}`}>{sost.riskScore}</span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-semibold ${sost.riskLevel === "CRITICAL" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                              <AlertTriangle className="w-2.5 h-2.5" />
                              {sost.riskLevel === "CRITICAL" ? "CRÍTICO" : "ALERTA"}
                            </span>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <button onClick={() => openAiFeedback(sost)} className="p-1 rounded bg-[var(--accent)] text-white hover:bg-[var(--accent-dark)]" title="Analizar con IA">
                              <Brain className="w-3 h-3" />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {sortedRiskData.length > 25 && (
                  <div className="p-3 text-center border-t border-[var(--border)]">
                    <button onClick={() => setRiskShowAll(v => !v)} className="text-xs text-[var(--accent)] hover:underline">
                      {riskShowAll ? "Mostrar menos" : `Ver los ${sortedRiskData.length - 25} restantes`}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Risk Distribution + Indicator Summary */}
          <div className="flex flex-col gap-4">
            {/* Risk donut */}
            <div className="glass-card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-[var(--accent)]" /> Distribución de Riesgo
              </h3>
              {riskLoading ? (
                <div className="flex items-center justify-center py-8"><Loader2 className="w-5 h-5 animate-spin" /></div>
              ) : riskDistData.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={riskDistData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={3}>
                      {riskDistData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                    </Pie>
                    <Tooltip formatter={(v, n) => [`${v} sostenedores`, n]} />
                    <Legend iconSize={10} iconType="circle" formatter={(v, entry) => {
                      const d = riskDistData.find(x => x.name === v);
                      return <span style={{ color: entry.color, fontSize: "11px" }}>{v}: {d?.value ?? 0}</span>;
                    }} />
                  </PieChart>
                </ResponsiveContainer>
              ) : (
                <p className="text-xs text-[var(--text-muted)] text-center py-8">Sin datos de riesgo</p>
              )}
            </div>

            {/* Indicator flags summary */}
            <div className="glass-card p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" /> Indicadores Flaggeados
              </h3>
              <div className="space-y-3 text-xs">
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[var(--text-muted)] font-medium">#4 Concentración Admin</span>
                    <span className="text-[10px]"><span className="text-red-600 font-semibold">{criticalAdmins}</span> crít · <span className="text-amber-600">{alertAdmins}</span> alert</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full flex">
                      <div className="bg-red-500" style={{ width: `${totalSost > 0 ? (criticalAdmins / totalSost) * 100 : 0}%` }} />
                      <div className="bg-amber-400" style={{ width: `${totalSost > 0 ? (alertAdmins / totalSost) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Umbral: &gt;30% crítico, &gt;20% alerta</div>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[var(--text-muted)] font-medium">#9 Gasto Remuneracional</span>
                    <span className="text-[10px]"><span className="text-red-600 font-semibold">{criticalPayroll}</span> crít · <span className="text-amber-600">{alertPayroll}</span> alert</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full flex">
                      <div className="bg-red-500" style={{ width: `${totalSost > 0 ? (criticalPayroll / totalSost) * 100 : 0}%` }} />
                      <div className="bg-amber-400" style={{ width: `${totalSost > 0 ? (alertPayroll / totalSost) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Umbral: &gt;85% crítico, &gt;65% alerta</div>
                </div>
                <div>
                  <div className="flex justify-between items-center mb-1">
                    <span className="text-[var(--text-muted)] font-medium">Balance Deficitario</span>
                    <span className="text-[10px]"><span className="text-red-600 font-semibold">{criticalBalance}</span> crít · <span className="text-amber-600">{alertBalance}</span> alert</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full flex">
                      <div className="bg-red-500" style={{ width: `${totalSost > 0 ? (criticalBalance / totalSost) * 100 : 0}%` }} />
                      <div className="bg-amber-400" style={{ width: `${totalSost > 0 ? (alertBalance / totalSost) * 100 : 0}%` }} />
                    </div>
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Umbral: &lt;-5% crítico, &lt;5% margen alerta</div>
                </div>
              </div>
            </div>

            {/* Avg risk score */}
            {riskData && (
              <div className="glass-card p-4">
                <h3 className="text-xs font-semibold mb-2 text-[var(--text-muted)]">SCORE PROMEDIO (FLAGGEADOS)</h3>
                <div className={`text-3xl font-bold ${riskData.avgRiskScore > 70 ? "text-red-600" : riskData.avgRiskScore > 40 ? "text-amber-600" : "text-emerald-600"}`}>
                  {riskData.avgRiskScore}<span className="text-sm font-normal text-[var(--text-muted)]">/100</span>
                </div>
                <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${riskData.avgRiskScore > 70 ? "bg-red-500" : riskData.avgRiskScore > 40 ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${riskData.avgRiskScore}%` }} />
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ═══ AI DEEP ANALYSIS ═══ */}
        <div className="glass-card overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-[var(--border)]">
            <div className="flex items-center gap-2">
              <Brain className="w-5 h-5 text-purple-600" />
              <h2 className="font-semibold text-sm">Análisis Estratégico con IA</h2>
              {deepAnalysisLoading && <span className="text-[10px] bg-purple-100 text-purple-700 px-2 py-0.5 rounded-full animate-pulse">Generando...</span>}
              {deepAnalysisRan && !deepAnalysisLoading && <span className="text-[10px] bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded-full">Completado</span>}
            </div>
            <div className="flex items-center gap-2">
              <select value={deepFocusRegion} onChange={e => setDeepFocusRegion(e.target.value)} className={`${selectClass} text-[10px]`}>
                <option value="">Todas las regiones</option>
                {filterOptions.regiones.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
              <select value={deepFocusDependencia} onChange={e => setDeepFocusDependencia(e.target.value)} className={`${selectClass} text-[10px]`}>
                <option value="">Todas las dependencias</option>
                {filterOptions.dependencias.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
              <button
                onClick={runDeepAnalysis}
                disabled={deepAnalysisLoading || !serverStats}
                className="px-3 py-1.5 bg-purple-600 text-white rounded-lg text-xs font-medium hover:bg-purple-700 disabled:opacity-40 flex items-center gap-1.5"
              >
                {deepAnalysisLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Brain className="w-3.5 h-3.5" />}
                {deepAnalysisLoading ? "Analizando..." : "Regenerar"}
              </button>
            </div>
          </div>
          <div className="p-5">
            {!deepAnalysisRan && !deepAnalysisLoading ? (
              <div className="text-center py-8 text-sm text-[var(--text-muted)]">
                <Loader2 className="w-6 h-6 animate-spin mx-auto mb-2 text-purple-400" />
                Preparando análisis...
              </div>
            ) : deepAnalysisResult ? (
              <div className="prose prose-sm max-w-none text-sm leading-relaxed whitespace-pre-wrap text-[var(--text-primary)]">
                {deepAnalysisResult}
                {deepAnalysisLoading && <span className="inline-block w-2 h-4 bg-purple-500 animate-pulse ml-0.5" />}
              </div>
            ) : deepAnalysisLoading ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-4">
                <Loader2 className="w-4 h-4 animate-spin text-purple-500" />
                Analizando portfolio educativo...
              </div>
            ) : null}
          </div>
        </div>

        {/* ═══ FINANCIAL CHARTS (2-col) ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="glass-card overflow-hidden">
            <SectionHeader section="ingresogasto" title="Ingresos vs Gastos por Tipo" icon={<BarChart3 className="w-4 h-4 text-emerald-600" />} />
            {expandedSection === "ingresogasto" && (
              <div className="p-4 border-t border-[var(--border)]">
                {stats.tipoCuentaData.length > 0 ? (
                  <>
                    <ResponsiveContainer width="100%" height={260}>
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
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
                      <div className="p-2 bg-emerald-50 rounded"><div className="text-[10px] text-emerald-600">Ingresos</div><div className="font-semibold text-emerald-700">{fmtCurrencyShort(stats.totalIngresos)}</div></div>
                      <div className="p-2 bg-red-50 rounded"><div className="text-[10px] text-red-600">Gastos</div><div className="font-semibold text-red-700">{fmtCurrencyShort(stats.totalGastos)}</div></div>
                      <div className={`p-2 rounded ${portfolioBalance >= 0 ? "bg-emerald-50" : "bg-red-50"}`}>
                        <div className="text-[10px] text-gray-500">Balance</div>
                        <div className={`font-semibold ${portfolioBalance >= 0 ? "text-emerald-700" : "text-red-700"}`}>{fmtCurrencyShort(portfolioBalance)}</div>
                      </div>
                    </div>
                  </>
                ) : <p className="text-sm text-[var(--text-muted)] text-center py-8">Sin datos</p>}
              </div>
            )}
          </div>

          <div className="glass-card overflow-hidden">
            <SectionHeader section="regiones" title="Gasto por Región" icon={<BarChart3 className="w-4 h-4 text-[var(--accent)]" />} />
            {expandedSection === "regiones" && (
              <div className="p-4 border-t border-[var(--border)]">
                {stats.regionData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
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

          <div className="glass-card overflow-hidden">
            <SectionHeader section="dependencias" title="Distribución por Dependencia" icon={<Building2 className="w-4 h-4 text-purple-600" />} />
            {expandedSection === "dependencias" && (
              <div className="p-4 border-t border-[var(--border)]">
                {stats.dependenciaData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <PieChart>
                      <Pie data={stats.dependenciaData} dataKey="monto" nameKey="name" cx="50%" cy="50%" outerRadius={100}
                        label={({ name, percent }: { name?: string; percent?: number }) => `${name ?? ""} (${((percent ?? 0) * 100).toFixed(0)}%)`}>
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

          <div className="glass-card overflow-hidden">
            <SectionHeader section="tendencia" title="Tendencia por Período" icon={<TrendingUp className="w-4 h-4 text-blue-600" />} />
            {expandedSection === "tendencia" && (
              <div className="p-4 border-t border-[var(--border)]">
                {stats.periodoData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
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

          <div className="glass-card overflow-hidden">
            <SectionHeader section="cuentas" title="Top Cuentas de Gasto" icon={<DollarSign className="w-4 h-4 text-emerald-600" />} />
            {expandedSection === "cuentas" && (
              <div className="p-4 border-t border-[var(--border)]">
                {stats.cuentaData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
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

          <div className="glass-card overflow-hidden">
            <SectionHeader section="subvenciones" title="Distribución por Subvención" icon={<FileText className="w-4 h-4 text-amber-600" />} />
            {expandedSection === "subvenciones" && (
              <div className="p-4 border-t border-[var(--border)]">
                {stats.subvencionData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={260}>
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
        </div>

        {/* ═══ AI CHAT ═══ */}
        <div className="glass-card overflow-hidden">
          <button onClick={() => setShowChat(v => !v)} className="w-full flex items-center justify-between p-4 hover:bg-[var(--bg-secondary)] transition-colors">
            <div className="flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-[var(--accent)]" />
              <h3 className="font-semibold text-sm">Consulta con IA</h3>
              {aiChatMessages.length > 0 && <span className="text-[10px] bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{aiChatMessages.length} mensajes</span>}
            </div>
            {showChat ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {showChat && (
            <div className="border-t border-[var(--border)] p-4">
              <div className="flex flex-wrap gap-2 mb-3">
                {["¿Cuáles son los principales riesgos del portfolio?", "Top 10 regiones por gasto", "Distribución por dependencia", "¿Qué sostenedores tienen mayor concentración administrativa?"].map(q => (
                  <button key={q} onClick={() => setAiChatInput(q)} className="px-3 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-full text-xs text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--accent)] transition-colors">
                    {q}
                  </button>
                ))}
              </div>
              <div className="flex gap-2">
                <input
                  value={aiChatInput}
                  onChange={e => setAiChatInput(e.target.value)}
                  onKeyDown={e => e.key === "Enter" && sendAiChat()}
                  placeholder="Pregunta sobre el portfolio educativo..."
                  className="flex-1 px-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                />
                <button onClick={sendAiChat} disabled={aiChatLoading} className="px-5 py-2.5 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:bg-[var(--accent-dark)] disabled:opacity-40 flex items-center gap-2">
                  {aiChatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  Preguntar
                </button>
                {aiChatMessages.length > 0 && (
                  <button onClick={() => setAiChatMessages([])} className="px-3 py-2.5 text-xs text-[var(--text-muted)] hover:text-red-500 flex items-center gap-1">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
              {aiChatMessages.length > 0 && (
                <div className="mt-4 space-y-3 max-h-[500px] overflow-y-auto">
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
                                <Tooltip /><Legend />
                              </PieChart>
                            ) : chart.type === "line" ? (
                              <LineChart data={chart.data}>
                                <CartesianGrid strokeDasharray="3 3" />
                                <XAxis dataKey={chart.nameKey} tick={{ fontSize: 10 }} />
                                <YAxis /><Tooltip />
                                <Line type="monotone" dataKey={chart.dataKey} stroke={COLORS[0]} />
                              </LineChart>
                            ) : (
                              <BarChart data={chart.data} layout={chart.type === "horizontal-bar" ? "vertical" : "horizontal"}>
                                <CartesianGrid strokeDasharray="3 3" />
                                {chart.type === "horizontal-bar" ? (
                                  <><XAxis type="number" /><YAxis type="category" dataKey={chart.nameKey} width={80} tick={{ fontSize: 10 }} /></>
                                ) : (
                                  <><XAxis dataKey={chart.nameKey} tick={{ fontSize: 10 }} /><YAxis /></>
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
          )}
        </div>

        {/* ═══ TIPOS DOCUMENTO + REMUNERACIONES ═══ */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <div className="glass-card overflow-hidden">
            <SectionHeader section="tipodocumento" title="Tipos de Documento" icon={<FileText className="w-4 h-4 text-purple-600" />} />
            {expandedSection === "tipodocumento" && (
              <div className="p-4 border-t border-[var(--border)]">
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

          <div className="glass-card overflow-hidden">
            <SectionHeader section="remuneraciones" title="Resumen Remuneraciones" icon={<DollarSign className="w-4 h-4 text-blue-600" />} />
            {expandedSection === "remuneraciones" && (
              <div className="p-4 border-t border-[var(--border)]">
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { label: "Total Haberes", value: fmtCurrencyShort(stats.totalHaber), color: "text-blue-700" },
                    { label: "Total Descuentos", value: fmtCurrencyShort(stats.totalDescuento), color: "text-red-600" },
                    { label: "Total Líquido", value: fmtCurrencyShort(stats.totalLiquido), color: "text-emerald-700" },
                    { label: "Promedio Líquido", value: fmtCurrencyShort(stats.promedioLiquido), color: "text-[var(--accent)]" },
                  ].map(item => (
                    <div key={item.label} className="p-3 bg-[var(--bg-secondary)] rounded-lg">
                      <div className="text-[10px] text-[var(--text-muted)]">{item.label}</div>
                      <div className={`text-lg font-bold ${item.color}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
                {stats.totalHaber > 0 && (
                  <div className="mt-3 p-3 bg-blue-50 rounded-lg text-xs">
                    <span className="font-semibold">Proporción sobre gastos: </span>
                    <span className={stats.proporcionRemuneraciones > 85 ? "text-red-600 font-bold" : stats.proporcionRemuneraciones > 65 ? "text-amber-600 font-semibold" : "text-emerald-600 font-semibold"}>
                      {stats.proporcionRemuneraciones}%
                    </span>
                    <span className="text-[var(--text-muted)]"> del total de gastos</span>
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
            <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <Brain className="w-5 h-5 text-[var(--accent)]" />
                <h3 className="font-semibold text-sm">Análisis IA — {feedbackSost.sostId}</h3>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${feedbackSost.riskLevel === "CRITICAL" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                  {feedbackSost.riskLevel === "CRITICAL" ? "CRÍTICO" : "ALERTA"} · Score {feedbackSost.riskScore}
                </span>
              </div>
              <div className="flex items-center gap-2">
                {feedbackResult && !feedbackLoading && (
                  <button onClick={copyFeedback} className="flex items-center gap-1 px-2.5 py-1.5 text-xs bg-gray-100 hover:bg-gray-200 rounded-lg">
                    {feedbackCopied ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    {feedbackCopied ? "Copiado" : "Copiar"}
                  </button>
                )}
                <button onClick={closeFeedbackModal} className="p-1 hover:bg-gray-100 rounded"><X className="w-5 h-5 text-gray-500" /></button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto px-5 py-4">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4 text-xs">
                <div className="bg-gray-50 rounded p-2"><span className="text-[10px] text-gray-500 block">Región</span>{feedbackSost.region || "-"}</div>
                <div className="bg-gray-50 rounded p-2"><span className="text-[10px] text-gray-500 block">Admin%</span>
                  <span className={feedbackSost.adminRatio > 30 ? "text-red-600 font-semibold" : feedbackSost.adminRatio > 20 ? "text-amber-600" : ""}>{feedbackSost.adminRatio}%</span>
                </div>
                <div className="bg-gray-50 rounded p-2"><span className="text-[10px] text-gray-500 block">Payroll%</span>
                  <span className={feedbackSost.payrollRatio > 85 ? "text-red-600 font-semibold" : feedbackSost.payrollRatio > 65 ? "text-amber-600" : ""}>{feedbackSost.payrollRatio > 0 ? `${feedbackSost.payrollRatio}%` : "—"}</span>
                </div>
                <div className={`rounded p-2 ${feedbackSost.balance < 0 ? "bg-red-50" : "bg-emerald-50"}`}>
                  <span className="text-[10px] text-gray-500 block">Balance</span>
                  <span className={feedbackSost.balance < 0 ? "text-red-600 font-semibold" : "text-emerald-600"}>{fmtCurrencyShort(feedbackSost.balance)}</span>
                </div>
              </div>
              <div className="mb-4 space-y-1">
                {feedbackSost.flags.map((f, i) => (
                  <div key={i} className={`flex items-center gap-2 px-3 py-1.5 rounded text-xs ${f.level === "CRITICAL" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-700"}`}>
                    <AlertTriangle className="w-3 h-3 flex-shrink-0" />
                    <span className="font-medium">{f.indicator}:</span> {f.detail}
                  </div>
                ))}
              </div>
              {feedbackLoading && !feedbackResult && (
                <div className="flex items-center justify-center py-12 gap-2 text-sm text-gray-500">
                  <Loader2 className="w-5 h-5 animate-spin" /> Generando análisis...
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
