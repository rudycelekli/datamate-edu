"use client";

import React, { useState, useEffect, useCallback } from "react";
import AppHeader from "@/components/AppHeader";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend,
  CartesianGrid, LineChart, Line,
} from "recharts";
import {
  Loader2, TrendingUp, DollarSign, FileText, Users, MapPin, Clock,
  AlertTriangle, Sparkles, X, ChevronDown, ChevronUp, BarChart3, Filter,
  MessageSquare, Send, Trash2, Download, Table2,
} from "lucide-react";
import USMap from "@/components/USMap";

const COLORS = [
  "#EA580C", "#2563EB", "#16A34A", "#D97706", "#7C3AED", "#DC2626",
  "#0891B2", "#4F46E5", "#059669", "#E11D48", "#8B5CF6", "#F59E0B",
];

const fmtCurrency = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(n);

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
        <p key={i} style={{ color: p.color }}>{p.name}: {typeof p.value === "number" && p.name.toLowerCase().includes("volume") ? fmtCurrencyShort(p.value) : p.value.toLocaleString()}</p>
      ))}
    </div>
  );
};

type Section = "snapshot" | "geography" | "characteristics" | "distribution" | "timeline" | "officers" | "performance" | "crosstab";

interface StatsData {
  totalUnits: number;
  totalVolume: number;
  milestoneData: Array<{ name: string; units: number; volume: number }>;
  stateData: Array<{ name: string; units: number; volume: number }>;
  programData: Array<{ name: string; units: number; volume: number }>;
  purposeData: Array<{ name: string; units: number; volume: number }>;
  loData: Array<{ name: string; units: number; volume: number }>;
  lockData: Array<{ name: string; value: number }>;
  rateData: Array<{ name: string; units: number }>;
  amountData: Array<{ name: string; units: number }>;
  trendData: Array<{ name: string; units: number; volume: number }>;
  lienData: Array<{ name: string; value: number }>;
  topState: string;
  topStatePercent: string;
  avgRate: string;
  purchasePercent: string;
  byStateMap: Record<string, { units: number; volume: number }>;
  avgByProgram: Array<{ name: string; avgAmount: number; units: number }>;
  milestoneVolData: Array<{ name: string; units: number; volume: number }>;
  avgRateByProgram: Array<{ name: string; avgRate: number }>;
  statePurposeData: Array<Record<string, unknown>>;
  allPurposes: string[];
  loTableData: Array<{ name: string; units: number; volume: number; avgLoan: number; pct: number }>;
  filterOptions?: { milestones: string[]; los: string[]; states: string[]; purposes: string[]; locks: string[]; programs: string[] };
  cacheAge?: number;
}

export default function IntelligencePage() {
  const [serverStats, setServerStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [expandedSection, setExpandedSection] = useState<Section | null>("snapshot");
  const [cacheAge, setCacheAge] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Filters
  const [filterState, setFilterState] = useState("");
  const [filterLO, setFilterLO] = useState("");
  const [filterMilestone, setFilterMilestone] = useState("");
  const [filterProgram, setFilterProgram] = useState("");
  const [filterPurpose, setFilterPurpose] = useState("");
  const [filterLock, setFilterLock] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // AI insight
  const [insightQuery, setInsightQuery] = useState("");
  const [insightResult, setInsightResult] = useState("");
  const [insightLoading, setInsightLoading] = useState(false);
  const [showInsight, setShowInsight] = useState(false);

  // AI Chat
  interface AiChart {
    type: "bar" | "pie" | "line" | "horizontal-bar" | "table" | "stacked-bar" | "grouped-bar" | "multi-line";
    title: string;
    dataKey: string;
    nameKey: string;
    data: Array<Record<string, unknown>>;
    fullData?: Array<Record<string, unknown>>;
    secondaryDataKey?: string;
    seriesKeys?: string[];
    formatValue?: "currency" | "number" | "percent" | "rate";
  }
  interface AiChatMessage {
    role: "user" | "assistant";
    text: string;
    charts?: AiChart[];
  }
  const [aiChatOpen, setAiChatOpen] = useState(false);
  const [aiChatInput, setAiChatInput] = useState("");
  const [aiChatMessages, setAiChatMessages] = useState<AiChatMessage[]>([]);
  const [aiChatLoading, setAiChatLoading] = useState(false);
  const [aiShowDataIdx, setAiShowDataIdx] = useState<number | null>(null);

  const fetchAll = useCallback(async () => {
    setError("");
    setRefreshing(true);
    try {
      const params = new URLSearchParams();
      if (filterState) params.set("state", filterState);
      if (filterLO) params.set("lo", filterLO);
      if (filterMilestone) params.set("milestone", filterMilestone);
      if (filterProgram) params.set("program", filterProgram);
      if (filterPurpose) params.set("purpose", filterPurpose);
      if (filterLock) params.set("lock", filterLock);
      if (filterDateFrom) params.set("dateFrom", filterDateFrom);
      if (filterDateTo) params.set("dateTo", filterDateTo);

      const res = await fetch(`/api/intelligence/stats?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data = await res.json();
      setServerStats(data);
      setCacheAge(data.cacheAge || 0);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to load data");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filterState, filterLO, filterMilestone, filterProgram, filterPurpose, filterLock, filterDateFrom, filterDateTo]);

  useEffect(() => {
    fetchAll();
    // Clear stale AI results when filters change
    if (aiChatMessages.length > 0) {
      setAiChatMessages([]);
      setAiChatOpen(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchAll]);

  // ─── Filter options (from server) ───
  const fo = serverStats?.filterOptions;
  const filterOptions = {
    states: (fo?.states || []) as string[],
    officers: (fo?.los || []) as string[],
    milestones: (fo?.milestones || []) as string[],
    programs: (fo?.programs || []) as string[],
    purposes: (fo?.purposes || []) as string[],
    locks: (fo?.locks || []) as string[],
  };

  const activeFilterCount = [filterState, filterLO, filterMilestone, filterProgram, filterPurpose, filterLock, filterDateFrom, filterDateTo].filter(Boolean).length;

  // ─── Stats from server (pre-aggregated over ALL loans) ───
  const stats: StatsData = serverStats || {
    totalUnits: 0, totalVolume: 0, milestoneData: [], stateData: [], programData: [],
    purposeData: [], loData: [], lockData: [], rateData: [], amountData: [],
    trendData: [], lienData: [], topState: "--", topStatePercent: "0",
    avgRate: "0", purchasePercent: "0", byStateMap: {}, avgByProgram: [],
    milestoneVolData: [], avgRateByProgram: [], statePurposeData: [], allPurposes: [],
    loTableData: [],
  };

  // AI Insight
  const getInsight = async (chartName: string, data: unknown) => {
    setShowInsight(true);
    setInsightLoading(true);
    setInsightResult("");
    // Build filter context for the insight
    const activeFilters: string[] = [];
    if (filterState) activeFilters.push(`State: ${filterState}`);
    if (filterLO) activeFilters.push(`LO: ${filterLO}`);
    if (filterMilestone) activeFilters.push(`Milestone: ${filterMilestone}`);
    if (filterProgram) activeFilters.push(`Program: ${filterProgram}`);
    if (filterPurpose) activeFilters.push(`Purpose: ${filterPurpose}`);
    if (filterLock) activeFilters.push(`Lock: ${filterLock}`);
    if (filterDateFrom) activeFilters.push(`From: ${filterDateFrom}`);
    if (filterDateTo) activeFilters.push(`To: ${filterDateTo}`);
    const filterNote = activeFilters.length > 0 ? ` (filtered: ${activeFilters.join(", ")})` : "";
    try {
      const res = await fetch("/api/intelligence/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chartName: chartName + filterNote, data, totalUnits: stats.totalUnits, totalVolume: stats.totalVolume }),
      });
      const d = await res.json();
      setInsightResult(d.insight || d.error || "No insights generated");
    } catch {
      setInsightResult("Unable to generate insight. Check API key configuration.");
    } finally {
      setInsightLoading(false);
    }
  };

  // AI Chat handler
  const askAI = async (question: string) => {
    if (!question.trim() || aiChatLoading) return;
    setAiChatMessages([{ role: "user", text: question }]);
    setAiChatInput("");
    setAiChatLoading(true);
    setAiShowDataIdx(null);
    try {
      // Send active filters so AI answers in the context of the filtered view
      const filters: Record<string, string> = {};
      if (filterState) filters.state = filterState;
      if (filterLO) filters.lo = filterLO;
      if (filterMilestone) filters.milestone = filterMilestone;
      if (filterProgram) filters.program = filterProgram;
      if (filterPurpose) filters.purpose = filterPurpose;
      if (filterLock) filters.lock = filterLock;
      if (filterDateFrom) filters.dateFrom = filterDateFrom;
      if (filterDateTo) filters.dateTo = filterDateTo;

      const res = await fetch("/api/intelligence/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question, filters: Object.keys(filters).length > 0 ? filters : undefined }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || "Failed");
      setAiChatMessages([
        { role: "user", text: question },
        { role: "assistant", text: d.summary || "Here are the results:", charts: d.charts || [] },
      ]);
    } catch (err) {
      setAiChatMessages([
        { role: "user", text: question },
        { role: "assistant", text: err instanceof Error ? err.message : "Failed to get response" },
      ]);
    } finally {
      setAiChatLoading(false);
    }
  };

  const fmtAiValue = (v: unknown, format?: string) => {
    const n = Number(v);
    if (isNaN(n)) return String(v);
    if (format === "currency") return fmtCurrencyShort(n);
    if (format === "percent") return `${n.toFixed(1)}%`;
    if (format === "rate") return `${n.toFixed(3)}%`;
    return n.toLocaleString();
  };

  const downloadCsv = (data: Array<Record<string, unknown>>, filename: string) => {
    if (!data.length) return;
    const headers = Object.keys(data[0]);
    const csvRows = [headers.join(",")];
    data.forEach((row) => {
      csvRows.push(headers.map((h) => {
        const v = row[h];
        const s = String(v ?? "");
        return s.includes(",") || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s;
      }).join(","));
    });
    const blob = new Blob([csvRows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const toggleSection = (s: Section) => {
    const isOpening = expandedSection !== s;
    setExpandedSection(expandedSection === s ? null : s);
    if (isOpening) {
      // Scroll the section header to top of viewport after render
      setTimeout(() => {
        document.getElementById(`section-${s}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 50);
    }
  };

  const SectionHeader = ({ id, title, icon: Icon, subtitle }: { id: Section; title: string; icon: React.ElementType; subtitle: string }) => (
    <button id={`section-${id}`} onClick={() => toggleSection(id)} className="w-full flex items-center justify-between p-4 glass-card mb-1 hover:bg-[var(--bg-secondary)] transition-colors scroll-mt-4">
      <div className="flex items-center gap-3">
        <Icon className="w-5 h-5 text-[var(--accent)]" />
        <div className="text-left">
          <h2 className="text-sm font-semibold">{title}</h2>
          <p className="text-xs text-[var(--text-muted)]">{subtitle}</p>
        </div>
      </div>
      {expandedSection === id ? <ChevronUp className="w-4 h-4 text-[var(--text-muted)]" /> : <ChevronDown className="w-4 h-4 text-[var(--text-muted)]" />}
    </button>
  );

  const [openDataTable, setOpenDataTable] = useState<string | null>(null);

  const InsightButton = ({ chartName, data }: { chartName: string; data: unknown }) => (
    <button
      onClick={(e) => { e.stopPropagation(); setInsightQuery(chartName); getInsight(chartName, data); }}
      className="absolute top-2 right-2 p-1.5 rounded-md bg-orange-50 hover:bg-orange-100 text-[var(--accent)] opacity-0 group-hover:opacity-100 transition-opacity"
      title="Get AI Insight"
    >
      <Sparkles className="w-3.5 h-3.5" />
    </button>
  );

  const ChartActions = ({ id, data, formatValue }: { id: string; data: Array<Record<string, unknown>>; formatValue?: "currency" | "number" | "percent" | "rate" }) => {
    const isOpen = openDataTable === id;
    return (
      <>
        <div className="flex items-center gap-1 mb-2">
          <button onClick={() => setOpenDataTable(isOpen ? null : id)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${isOpen ? "bg-[var(--accent)] text-white" : "bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
            <Table2 className="w-3 h-3" /> Data ({data.length})
          </button>
          <button onClick={() => downloadCsv(data, id)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
            <Download className="w-3 h-3" /> CSV
          </button>
        </div>
        {isOpen && (
          <div className="overflow-x-auto max-h-[300px] overflow-y-auto mb-3 border border-[var(--border)] rounded-lg">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-white">
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-1.5 px-2 font-semibold text-[var(--text-muted)]">#</th>
                  {data.length > 0 && Object.keys(data[0]).map((k) => (
                    <th key={k} className="text-left py-1.5 px-2 font-semibold capitalize">{k}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.map((row, ri) => (
                  <tr key={ri} className="border-b border-[var(--border)]/30 hover:bg-[var(--bg-secondary)]">
                    <td className="py-1 px-2 text-[var(--text-muted)]">{ri + 1}</td>
                    {Object.entries(row).map(([, val], vi) => (
                      <td key={vi} className="py-1 px-2">{typeof val === "number" ? fmtAiValue(val, formatValue) : String(val)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </>
    );
  };

  // Auto-refetch if data seems stale (every 5 min)
  useEffect(() => {
    const interval = setInterval(() => fetchAll(), 5 * 60_000);
    return () => clearInterval(interval);
  }, [fetchAll]);

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4">
        <Loader2 className="w-10 h-10 animate-spin text-[var(--accent)]" />
        <p className="text-sm text-[var(--text-muted)]">Loading pipeline data for analytics...</p>
        <p className="text-xs text-[var(--text-muted)]">
          Loading from database...
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <AppHeader activeTab="intelligence" />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-sm text-red-700">
            <AlertTriangle className="w-5 h-5" />{error}
          </div>
        )}

        {/* AI Chat Bar */}
        <div className="glass-card p-3 mb-4 border-l-4 border-[var(--accent)]">
          <div className="flex items-center gap-2 mb-2">
            <MessageSquare className="w-4 h-4 text-[var(--accent)]" />
            <span className="text-sm font-semibold">Ask with AI</span>
            {aiChatMessages.length > 0 && (
              <button onClick={() => { setAiChatMessages([]); setAiChatOpen(false); }} className="ml-auto text-xs text-[var(--text-muted)] hover:text-red-500 flex items-center gap-1">
                <Trash2 className="w-3 h-3" /> Clear
              </button>
            )}
          </div>
          <form onSubmit={(e) => { e.preventDefault(); askAI(aiChatInput); }} className="flex gap-2">
            <input
              value={aiChatInput}
              onChange={(e) => { setAiChatInput(e.target.value); if (!aiChatOpen) setAiChatOpen(true); }}
              placeholder="Ask anything... e.g. &quot;Show me volume by state for FHA loans&quot; or &quot;Which LO has the highest avg loan size?&quot;"
              className="flex-1 text-sm border border-[var(--border)] rounded-lg px-3 py-2 focus:outline-none focus:border-[var(--accent)] focus:ring-1 focus:ring-[var(--accent)]"
            />
            <button
              type="submit"
              disabled={aiChatLoading || !aiChatInput.trim()}
              className="px-3 py-2 bg-[var(--accent)] text-white rounded-lg text-sm font-medium hover:bg-orange-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1.5"
            >
              {aiChatLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              <span className="hidden sm:inline">Ask</span>
            </button>
          </form>
          {!aiChatOpen && aiChatMessages.length === 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {["Top 10 states by volume", "Purchase vs refinance breakdown", "Which LO has the most loans?", "Show monthly trend"].map((q) => (
                <button key={q} onClick={() => { setAiChatOpen(true); setAiChatInput(q); askAI(q); }}
                  className="text-[11px] px-2 py-1 bg-[var(--bg-secondary)] rounded-full hover:bg-orange-50 hover:text-[var(--accent)] transition-colors">
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Chat messages with charts */}
          {aiChatOpen && aiChatMessages.length > 0 && (
            <div className="mt-3 space-y-3 max-h-[600px] overflow-y-auto">
              {aiChatMessages.map((msg, i) => (
                <div key={i}>
                  {msg.role === "user" ? (
                    <div className="inline-block bg-[var(--bg-secondary)] border border-[var(--border)] px-3 py-1.5 rounded-lg text-sm font-medium text-[var(--text)]">
                      <span className="text-[var(--text-muted)] mr-1.5">Q:</span>{msg.text}
                    </div>
                  ) : (
                    <div className="space-y-3">
                      <div className="bg-[var(--bg-secondary)] px-3 py-2 rounded-lg rounded-tl-sm text-sm">
                        <div className="flex items-center gap-1.5 mb-1">
                          <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
                          <span className="font-medium text-xs text-[var(--accent)]">AI Analysis</span>
                        </div>
                        {msg.text.split("\n").filter((l) => l.trim()).map((line, j) => {
                          const trimmed = line.trim();
                          const formatted = trimmed.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
                          return <p key={j} className="text-sm" dangerouslySetInnerHTML={{ __html: formatted }} />;
                        })}
                      </div>
                      {msg.charts && msg.charts.length > 0 && (
                        <div className={`grid gap-3 ${msg.charts.length > 1 ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
                          {msg.charts.map((chart, ci) => {
                            const tableData = chart.fullData || chart.data;
                            const isDataOpen = aiShowDataIdx === ci;
                            return (
                            <div key={ci} className="bg-white border border-[var(--border)] rounded-lg p-3">
                              <div className="flex items-center justify-between mb-2">
                                <h4 className="text-xs font-semibold">{chart.title}</h4>
                                <div className="flex items-center gap-1">
                                  <button onClick={() => setAiShowDataIdx(isDataOpen ? null : ci)}
                                    className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-colors ${isDataOpen ? "bg-[var(--accent)] text-white" : "bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
                                    <Table2 className="w-3 h-3" /> Data{tableData.length > chart.data.length ? ` (${tableData.length})` : ""}
                                  </button>
                                  <button onClick={() => downloadCsv(tableData, chart.title.replace(/\s+/g, "_"))}
                                    className="flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium bg-[var(--bg-secondary)] text-[var(--text-muted)] hover:text-[var(--text)] transition-colors">
                                    <Download className="w-3 h-3" /> CSV
                                  </button>
                                </div>
                              </div>

                              {isDataOpen ? (
                                <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                                  <table className="w-full text-xs">
                                    <thead className="sticky top-0 bg-white">
                                      <tr className="border-b border-[var(--border)]">
                                        <th className="text-left py-1.5 px-1 font-semibold text-[var(--text-muted)]">#</th>
                                        {tableData.length > 0 && Object.keys(tableData[0]).map((k) => (
                                          <th key={k} className="text-left py-1.5 px-1 font-semibold capitalize">{k}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {tableData.map((row, ri) => (
                                        <tr key={ri} className="border-b border-[var(--border)]/30 hover:bg-[var(--bg-secondary)]">
                                          <td className="py-1 px-1 text-[var(--text-muted)]">{ri + 1}</td>
                                          {Object.values(row).map((val, vi) => (
                                            <td key={vi} className="py-1 px-1">{typeof val === "number" ? fmtAiValue(val, chart.formatValue) : String(val)}</td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : chart.type === "table" ? (
                                <div className="overflow-x-auto">
                                  <table className="w-full text-xs">
                                    <thead>
                                      <tr className="border-b border-[var(--border)]">
                                        {chart.data.length > 0 && Object.keys(chart.data[0]).map((k) => (
                                          <th key={k} className="text-left py-1.5 px-1 font-semibold capitalize">{k}</th>
                                        ))}
                                      </tr>
                                    </thead>
                                    <tbody>
                                      {chart.data.slice(0, 20).map((row, ri) => (
                                        <tr key={ri} className="border-b border-[var(--border)]/30">
                                          {Object.values(row).map((val, vi) => (
                                            <td key={vi} className="py-1 px-1">{typeof val === "number" ? fmtAiValue(val, chart.formatValue) : String(val)}</td>
                                          ))}
                                        </tr>
                                      ))}
                                    </tbody>
                                  </table>
                                </div>
                              ) : chart.type === "pie" ? (
                                <ResponsiveContainer width="100%" height={220}>
                                  <PieChart>
                                    <Pie data={chart.data} dataKey={chart.dataKey || "value"} nameKey={chart.nameKey || "name"} cx="50%" cy="50%" outerRadius={80}
                                      label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} style={{ fontSize: 10 }}>
                                      {chart.data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                                    </Pie>
                                    <Tooltip formatter={(v) => fmtAiValue(v, chart.formatValue)} />
                                  </PieChart>
                                </ResponsiveContainer>
                              ) : chart.type === "line" ? (
                                <ResponsiveContainer width="100%" height={220}>
                                  <LineChart data={chart.data}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis dataKey={chart.nameKey || "name"} tick={{ fontSize: 10 }} />
                                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtAiValue(v, chart.formatValue) as string} />
                                    <Tooltip formatter={(v) => fmtAiValue(v, chart.formatValue)} />
                                    <Line type="monotone" dataKey={chart.dataKey || "value"} stroke="#EA580C" strokeWidth={2} dot={{ r: 3 }} />
                                    {chart.secondaryDataKey && (
                                      <Line type="monotone" dataKey={chart.secondaryDataKey} stroke="#2563EB" strokeWidth={2} dot={{ r: 3 }} />
                                    )}
                                  </LineChart>
                                </ResponsiveContainer>
                              ) : chart.type === "stacked-bar" || chart.type === "grouped-bar" ? (
                                <ResponsiveContainer width="100%" height={Math.max(280, 40 + (chart.seriesKeys?.length || 1) * 8)}>
                                  <BarChart data={chart.data} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis dataKey={chart.nameKey || "name"} tick={{ fontSize: 10 }} />
                                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtAiValue(v, chart.formatValue) as string} />
                                    <Tooltip formatter={(v) => fmtAiValue(v, chart.formatValue)} />
                                    <Legend wrapperStyle={{ fontSize: 10 }} />
                                    {(chart.seriesKeys || []).map((key, idx) => (
                                      <Bar key={key} dataKey={key} name={key} fill={COLORS[idx % COLORS.length]}
                                        stackId={chart.type === "stacked-bar" ? "stack" : undefined}
                                        radius={chart.type === "stacked-bar" ? undefined : [4, 4, 0, 0]} />
                                    ))}
                                  </BarChart>
                                </ResponsiveContainer>
                              ) : chart.type === "multi-line" ? (
                                <ResponsiveContainer width="100%" height={280}>
                                  <LineChart data={chart.data} margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis dataKey={chart.nameKey || "name"} tick={{ fontSize: 10 }} />
                                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtAiValue(v, chart.formatValue) as string} />
                                    <Tooltip formatter={(v) => fmtAiValue(v, chart.formatValue)} />
                                    <Legend wrapperStyle={{ fontSize: 10 }} />
                                    {(chart.seriesKeys || []).map((key, idx) => (
                                      <Line key={key} type="monotone" dataKey={key} name={key}
                                        stroke={COLORS[idx % COLORS.length]} strokeWidth={2} dot={{ r: 2 }} />
                                    ))}
                                  </LineChart>
                                </ResponsiveContainer>
                              ) : chart.type === "horizontal-bar" ? (
                                <ResponsiveContainer width="100%" height={Math.max(200, chart.data.length * 28 + 40)}>
                                  <BarChart data={chart.data} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtAiValue(v, chart.formatValue) as string} />
                                    <YAxis type="category" dataKey={chart.nameKey || "name"} tick={{ fontSize: 10 }} width={130} />
                                    <Tooltip formatter={(v) => fmtAiValue(v, chart.formatValue)} />
                                    <Bar dataKey={chart.dataKey || "value"} radius={[0, 4, 4, 0]}>
                                      {chart.data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                                    </Bar>
                                  </BarChart>
                                </ResponsiveContainer>
                              ) : (
                                <ResponsiveContainer width="100%" height={220}>
                                  <BarChart data={chart.data}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                                    <XAxis dataKey={chart.nameKey || "name"} tick={{ fontSize: 10 }} />
                                    <YAxis tick={{ fontSize: 10 }} tickFormatter={(v) => fmtAiValue(v, chart.formatValue) as string} />
                                    <Tooltip formatter={(v) => fmtAiValue(v, chart.formatValue)} />
                                    <Bar dataKey={chart.dataKey || "value"} radius={[4, 4, 0, 0]}>
                                      {chart.data.map((_, idx) => <Cell key={idx} fill={COLORS[idx % COLORS.length]} />)}
                                    </Bar>
                                    {chart.secondaryDataKey && (
                                      <Bar dataKey={chart.secondaryDataKey} radius={[4, 4, 0, 0]} fill="#2563EB" />
                                    )}
                                  </BarChart>
                                </ResponsiveContainer>
                              )}
                            </div>
                          );})}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
              {aiChatLoading && (
                <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                  <Loader2 className="w-4 h-4 animate-spin" /> Analyzing your pipeline data...
                </div>
              )}
            </div>
          )}
        </div>

        {/* Filter Bar - Always visible */}
        <div className="glass-card p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm font-medium">
              <Filter className="w-4 h-4 text-[var(--accent)]" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span className="px-1.5 py-0.5 bg-[var(--accent)] text-white text-xs rounded-full">{activeFilterCount}</span>
              )}
              {refreshing && <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--accent)]" />}
            </div>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2">
            <select value={filterState} onChange={(e) => setFilterState(e.target.value)} className="text-xs border border-[var(--border)] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[var(--accent)]">
              <option value="">All States</option>
              {filterOptions.states.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterLO} onChange={(e) => setFilterLO(e.target.value)} className="text-xs border border-[var(--border)] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[var(--accent)]">
              <option value="">All Loan Officers</option>
              {filterOptions.officers.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterMilestone} onChange={(e) => setFilterMilestone(e.target.value)} className="text-xs border border-[var(--border)] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[var(--accent)]">
              <option value="">All Milestones</option>
              {filterOptions.milestones.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterProgram} onChange={(e) => setFilterProgram(e.target.value)} className="text-xs border border-[var(--border)] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[var(--accent)]">
              <option value="">All Programs</option>
              {filterOptions.programs.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterPurpose} onChange={(e) => setFilterPurpose(e.target.value)} className="text-xs border border-[var(--border)] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[var(--accent)]">
              <option value="">All Purposes</option>
              {filterOptions.purposes.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <select value={filterLock} onChange={(e) => setFilterLock(e.target.value)} className="text-xs border border-[var(--border)] rounded-lg px-2 py-1.5 bg-white focus:outline-none focus:border-[var(--accent)]">
              <option value="">All Lock Status</option>
              {filterOptions.locks.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
            <div className="flex items-center gap-1">
              <label className="text-[10px] text-[var(--text-muted)] whitespace-nowrap"><Clock className="w-3 h-3 inline mr-0.5" />From</label>
              <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} className="text-xs border border-[var(--border)] rounded-lg px-1.5 py-1.5 bg-white focus:outline-none focus:border-[var(--accent)] w-full" />
            </div>
            <div className="flex items-center gap-1">
              <label className="text-[10px] text-[var(--text-muted)] whitespace-nowrap">To</label>
              <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} className="text-xs border border-[var(--border)] rounded-lg px-1.5 py-1.5 bg-white focus:outline-none focus:border-[var(--accent)] w-full" />
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              {filterState && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-orange-50 border border-orange-200 rounded text-xs"><MapPin className="w-3 h-3" />{filterState}<button onClick={() => setFilterState("")}><X className="w-3 h-3" /></button></span>}
              {filterLO && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-50 border border-blue-200 rounded text-xs"><Users className="w-3 h-3" />{filterLO}<button onClick={() => setFilterLO("")}><X className="w-3 h-3" /></button></span>}
              {filterMilestone && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-emerald-50 border border-emerald-200 rounded text-xs">{filterMilestone}<button onClick={() => setFilterMilestone("")}><X className="w-3 h-3" /></button></span>}
              {filterProgram && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-purple-50 border border-purple-200 rounded text-xs">{filterProgram}<button onClick={() => setFilterProgram("")}><X className="w-3 h-3" /></button></span>}
              {filterPurpose && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-50 border border-amber-200 rounded text-xs">{filterPurpose}<button onClick={() => setFilterPurpose("")}><X className="w-3 h-3" /></button></span>}
              {filterLock && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-cyan-50 border border-cyan-200 rounded text-xs">{filterLock}<button onClick={() => setFilterLock("")}><X className="w-3 h-3" /></button></span>}
              {filterDateFrom && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 border border-indigo-200 rounded text-xs"><Clock className="w-3 h-3" />From {filterDateFrom}<button onClick={() => setFilterDateFrom("")}><X className="w-3 h-3" /></button></span>}
              {filterDateTo && <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-50 border border-indigo-200 rounded text-xs"><Clock className="w-3 h-3" />To {filterDateTo}<button onClick={() => setFilterDateTo("")}><X className="w-3 h-3" /></button></span>}
              <button
                onClick={() => { setFilterState(""); setFilterLO(""); setFilterMilestone(""); setFilterProgram(""); setFilterPurpose(""); setFilterLock(""); setFilterDateFrom(""); setFilterDateTo(""); }}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-50 border border-red-200 rounded text-xs text-red-600 hover:bg-red-100 transition-colors font-medium"
              >
                <X className="w-3 h-3" /> Clear All
              </button>
              <span className="text-xs text-[var(--text-muted)] self-center ml-1">{stats.totalUnits.toLocaleString()} loans{cacheAge > 0 ? ` (updated ${Math.floor(cacheAge / 60000)} min ago)` : ""}</span>
            </div>
          )}
        </div>

        {/* KPI Cards */}
        <div className={`grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-4 mb-4 sm:mb-6 transition-opacity duration-200 ${refreshing ? "opacity-50" : ""}`}>
          <div className="glass-card p-3 sm:p-4">
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
              <FileText className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-[var(--accent)]" />
              <span className="text-[10px] sm:text-xs text-[var(--text-muted)]">Pipeline Units</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{stats.totalUnits.toLocaleString()}</div>
          </div>
          <div className="glass-card p-3 sm:p-4">
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
              <DollarSign className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-emerald-600" />
              <span className="text-[10px] sm:text-xs text-[var(--text-muted)]">Pipeline Volume</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{fmtCurrencyShort(stats.totalVolume)}</div>
          </div>
          <div className="glass-card p-3 sm:p-4">
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
              <TrendingUp className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-blue-600" />
              <span className="text-[10px] sm:text-xs text-[var(--text-muted)]">Avg Rate</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{stats.avgRate}%</div>
          </div>
          <div className="glass-card p-3 sm:p-4">
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
              <MapPin className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-purple-600" />
              <span className="text-[10px] sm:text-xs text-[var(--text-muted)]">Top State</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{stats.topState}</div>
            <div className="text-[10px] sm:text-xs text-[var(--text-muted)]">{stats.topStatePercent}% of volume</div>
          </div>
          <div className="glass-card p-3 sm:p-4">
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
              <Users className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-indigo-600" />
              <span className="text-[10px] sm:text-xs text-[var(--text-muted)]">Purchase %</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{stats.purchasePercent}%</div>
          </div>
          <div className="glass-card p-3 sm:p-4">
            <div className="flex items-center gap-1.5 sm:gap-2 mb-1">
              <Clock className="w-3.5 sm:w-4 h-3.5 sm:h-4 text-amber-600" />
              <span className="text-[10px] sm:text-xs text-[var(--text-muted)]">Avg Loan</span>
            </div>
            <div className="text-xl sm:text-2xl font-bold">{stats.totalUnits ? fmtCurrencyShort(stats.totalVolume / stats.totalUnits) : "--"}</div>
          </div>
        </div>

        {/* AI Insight Panel */}
        {showInsight && (
          <div className="glass-card p-4 mb-6 border-l-4 border-[var(--accent)]">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                <span className="text-sm font-semibold">AI Insight: {insightQuery}</span>
              </div>
              <button onClick={() => setShowInsight(false)}><X className="w-4 h-4 text-[var(--text-muted)]" /></button>
            </div>
            {insightLoading ? (
              <div className="flex items-center gap-2 text-sm text-[var(--text-muted)]">
                <Loader2 className="w-4 h-4 animate-spin" /> Analyzing data...
              </div>
            ) : (
              <div className="text-sm space-y-2">
                {insightResult.split("\n").filter(l => l.trim()).map((line, i) => {
                  const trimmed = line.trim();
                  const isBullet = /^[-•·*]\s/.test(trimmed);
                  const text = isBullet ? trimmed.replace(/^[-•·*]\s+/, "") : trimmed;
                  const formatted = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
                  return isBullet ? (
                    <div key={i} className="flex gap-2 items-start">
                      <span className="text-[var(--accent)] mt-1.5 shrink-0 w-1.5 h-1.5 rounded-full bg-[var(--accent)]" />
                      <span dangerouslySetInnerHTML={{ __html: formatted }} />
                    </div>
                  ) : (
                    <p key={i} dangerouslySetInnerHTML={{ __html: formatted }} />
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ─── Section 0: Geographic Heatmap ─── */}
        <SectionHeader id="geography" title="Geographic Distribution" icon={MapPin} subtitle={`${Object.keys(stats.byStateMap).length} states | ${stats.topState} leads`} />
        {expandedSection === "geography" && (
          <div className="glass-card p-4 mb-6">
            <div className="flex flex-col lg:flex-row gap-4">
              {/* US Map */}
              <div className="flex-1 group relative">
                <InsightButton chartName="Geographic Distribution" data={stats.stateData} />
                <h3 className="text-sm font-semibold mb-3">Volume Heatmap by State</h3>
                <USMap
                  data={stats.byStateMap}
                  onStateClick={(st) => setFilterState(filterState === st ? "" : st)}
                  selectedState={filterState}
                  formatCurrency={fmtCurrencyShort}
                />
                {/* Legend */}
                <div className="flex items-center gap-2 mt-3 text-[10px] text-[var(--text-muted)]">
                  <span>Low</span>
                  <div className="flex h-2 rounded overflow-hidden" style={{ width: 120 }}>
                    {[0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1].map((v, i) => (
                      <div key={i} className="flex-1" style={{ backgroundColor: `rgba(234, 88, 12, ${v})` }} />
                    ))}
                  </div>
                  <span>High</span>
                </div>
              </div>

              {/* State ranking table */}
              <div className="w-full lg:w-80 shrink-0">
                <h3 className="text-sm font-semibold mb-2">Top States</h3>
                <div className="max-h-[340px] overflow-y-auto space-y-1">
                  {stats.stateData.map((d, i) => {
                    const pct = stats.totalVolume ? ((d.volume / stats.totalVolume) * 100).toFixed(1) : "0";
                    return (
                      <button key={d.name} onClick={() => setFilterState(filterState === d.name ? "" : d.name)}
                        className={`w-full flex items-center justify-between p-2 rounded text-xs hover:bg-orange-50 transition-colors ${filterState === d.name ? "bg-orange-50 border border-[var(--accent)]" : "bg-[var(--bg-secondary)]"}`}>
                        <div className="flex items-center gap-2">
                          <span className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold" style={{ backgroundColor: COLORS[i % COLORS.length] + "20", color: COLORS[i % COLORS.length] }}>{i + 1}</span>
                          <span className="font-medium">{d.name}</span>
                        </div>
                        <div className="flex items-center gap-3">
                          <span>{d.units} loans</span>
                          <span className="font-semibold">{fmtCurrencyShort(d.volume)}</span>
                          <span className="text-[var(--text-muted)] w-10 text-right">{pct}%</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Section 1: Pipeline Snapshot ─── */}
        <SectionHeader id="snapshot" title="Current Pipeline Snapshot" icon={TrendingUp} subtitle={`${stats.totalUnits} loans | ${fmtCurrencyShort(stats.totalVolume)}`} />
        {expandedSection === "snapshot" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mb-6">
            {/* By Milestone */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Pipeline by Milestone" data={stats.milestoneData} />
              <h3 className="text-sm font-semibold mb-1">Pipeline by Milestone</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">{fmtCurrencyShort(stats.totalVolume)} | {stats.totalUnits} Units</p>
              <ChartActions id="milestone" data={stats.milestoneData} />
              <ResponsiveContainer width="100%" height={Math.max(320, stats.milestoneData.length * 28 + 40)}>
                <BarChart data={stats.milestoneData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={130} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="units" name="Units" fill="#EA580C" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* By State */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Volume by State" data={stats.stateData} />
              <h3 className="text-sm font-semibold mb-1">Volume by State (Top 20)</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">{stats.topStatePercent}% {stats.topState}</p>
              <ChartActions id="state-vol" data={stats.stateData} formatValue="currency" />
              <ResponsiveContainer width="100%" height={Math.max(320, stats.stateData.length * 28 + 40)}>
                <BarChart data={stats.stateData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCurrencyShort(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={35} />
                  <Tooltip content={<CustomTooltip />} formatter={(v) => fmtCurrencyShort(Number(v))} />
                  <Bar dataKey="volume" name="Volume" radius={[0, 4, 4, 0]}>
                    {stats.stateData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Monthly Trend */}
            <div className="glass-card p-4 group relative lg:col-span-2">
              <InsightButton chartName="Monthly Volume Trend" data={stats.trendData} />
              <h3 className="text-sm font-semibold mb-1">Monthly Volume & Units Trend</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Last 12 months</p>
              <ChartActions id="trend" data={stats.trendData} formatValue="currency" />
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stats.trendData} margin={{ left: 20, right: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="volume" tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCurrencyShort(v)} />
                  <YAxis yAxisId="units" orientation="right" tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Legend wrapperStyle={{ fontSize: 11 }} />
                  <Bar yAxisId="volume" dataKey="volume" name="Volume" fill="#EA580C" radius={[4, 4, 0, 0]} />
                  <Line yAxisId="units" type="monotone" dataKey="units" name="Units" stroke="#2563EB" strokeWidth={2} dot={{ r: 3 }} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ─── Section 2: Loan Characteristics ─── */}
        <SectionHeader id="characteristics" title="Pipeline Loan Characteristics" icon={FileText} subtitle="Program, Purpose, Lien Position" />
        {expandedSection === "characteristics" && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {/* By Program */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Loans by Program Type" data={stats.programData} />
              <h3 className="text-sm font-semibold mb-1">By Loan Type</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">
                {stats.programData.map(d => `${d.name} ${(d.volume / stats.totalVolume * 100).toFixed(1)}%`).join(" | ")}
              </p>
              <ChartActions id="program" data={stats.programData} formatValue="currency" />
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={stats.programData} dataKey="volume" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={{ strokeWidth: 1 }} style={{ fontSize: 11 }}>
                    {stats.programData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmtCurrencyShort(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* By Purpose */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Loans by Purpose" data={stats.purposeData} />
              <h3 className="text-sm font-semibold mb-1">By Purpose</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Purchase {stats.purchasePercent}%</p>
              <ChartActions id="purpose" data={stats.purposeData} formatValue="currency" />
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={stats.purposeData} dataKey="volume" nameKey="name" cx="50%" cy="50%" outerRadius={90} label={({ name, percent }) => `${(name ?? "").replace("NoCash-Out ", "No C/O ").replace("Cash-Out ", "C/O ")} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={{ strokeWidth: 1 }} style={{ fontSize: 11 }}>
                    {stats.purposeData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v) => fmtCurrencyShort(Number(v))} />
                </PieChart>
              </ResponsiveContainer>
            </div>

            {/* Lien Position + Lock Status */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Lock Status & Lien Position" data={{ lock: stats.lockData, lien: stats.lienData }} />
              <h3 className="text-sm font-semibold mb-1">Lock Status</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">{stats.lockData.map(d => `${d.name}: ${d.value}`).join(" | ")}</p>
              <ChartActions id="lock-lien" data={[...stats.lockData.map(d => ({ ...d, type: "Lock" })), ...stats.lienData.map(d => ({ ...d, type: "Lien" }))]} />
              <ResponsiveContainer width="100%" height={120}>
                <PieChart>
                  <Pie data={stats.lockData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={45} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} style={{ fontSize: 10 }}>
                    {stats.lockData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
              <h3 className="text-sm font-semibold mb-1 mt-2">Lien Position</h3>
              <ResponsiveContainer width="100%" height={100}>
                <PieChart>
                  <Pie data={stats.lienData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={40} label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} style={{ fontSize: 10 }}>
                    {stats.lienData.map((_, i) => <Cell key={i} fill={COLORS[i + 3 % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ─── Section 3: Distribution ─── */}
        <SectionHeader id="distribution" title="Pipeline Loan Distribution" icon={DollarSign} subtitle="Interest Rate, Loan Amount" />
        {expandedSection === "distribution" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Rate Distribution */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Interest Rate Distribution" data={stats.rateData} />
              <h3 className="text-sm font-semibold mb-1">Interest Rate Distribution</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">{stats.avgRate}% Weighted Average</p>
              <ChartActions id="rate-dist" data={stats.rateData} />
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stats.rateData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="units" name="Units" fill="#2563EB" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Amount Distribution */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Loan Amount Distribution" data={stats.amountData} />
              <h3 className="text-sm font-semibold mb-1">Loan Amount Distribution</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Avg: {stats.totalUnits ? fmtCurrency(stats.totalVolume / stats.totalUnits) : "--"}</p>
              <ChartActions id="amount-dist" data={stats.amountData} />
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={stats.amountData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="units" name="Units" fill="#16A34A" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ─── Section 4: Volume by LO ─── */}
        <SectionHeader id="officers" title="Volume by Loan Officer" icon={Users} subtitle="Top 25 by Volume" />
        {expandedSection === "officers" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mb-6">
            {/* Volume by LO */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Volume by Loan Officer" data={stats.loData} />
              <h3 className="text-sm font-semibold mb-1">Volume by LO (Top 25)</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">{fmtCurrencyShort(stats.totalVolume)} | {stats.totalUnits} Units</p>
              <ChartActions id="lo-volume" data={stats.loData} formatValue="currency" />
              <ResponsiveContainer width="100%" height={Math.max(500, stats.loData.length * 24 + 40)}>
                <BarChart data={stats.loData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtCurrencyShort(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                  <Tooltip content={<CustomTooltip />} formatter={(v) => fmtCurrencyShort(Number(v))} />
                  <Bar dataKey="volume" name="Volume" radius={[0, 4, 4, 0]}>
                    {stats.loData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Units by LO */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Units by Loan Officer" data={stats.loData} />
              <h3 className="text-sm font-semibold mb-1">Units by LO (Top 25)</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">{fmtCurrencyShort(stats.totalVolume)} | {stats.totalUnits} Units</p>
              <ChartActions id="lo-units" data={stats.loData} />
              <ResponsiveContainer width="100%" height={Math.max(500, stats.loData.length * 24 + 40)}>
                <BarChart data={stats.loData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 10 }} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={140} />
                  <Tooltip content={<CustomTooltip />} />
                  <Bar dataKey="units" name="Units" radius={[0, 4, 4, 0]}>
                    {stats.loData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* ─── Section 5: Timeline ─── */}
        <SectionHeader id="timeline" title="Pipeline Timeline & Alerts" icon={AlertTriangle} subtitle="Lock expirations, date trends" />
        {expandedSection === "timeline" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mb-6">
            {/* Monthly units line chart */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Monthly Units Trend" data={stats.trendData} />
              <h3 className="text-sm font-semibold mb-1">Units by Month</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Application dates (last 12 months)</p>
              <ChartActions id="monthly-units" data={stats.trendData} />
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={stats.trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip content={<CustomTooltip />} />
                  <Line type="monotone" dataKey="units" name="Units" stroke="#EA580C" strokeWidth={2} dot={{ r: 4, fill: "#EA580C" }} />
                </LineChart>
              </ResponsiveContainer>
            </div>

            {/* Lock status alert table */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Pipeline Alerts" data={{ lock: stats.lockData, milestones: stats.milestoneData.slice(0, 5) }} />
              <h3 className="text-sm font-semibold mb-3">Pipeline Alerts</h3>
              <ChartActions id="alerts" data={[...stats.lockData, ...stats.milestoneData.slice(0, 5).map(d => ({ name: d.name, value: d.units }))]} />
              <div className="space-y-3">
                {stats.lockData.map((d, i) => (
                  <div key={i} className="flex items-center justify-between p-3 bg-[var(--bg-secondary)] rounded-lg">
                    <div className="flex items-center gap-2">
                      <span className={`w-2.5 h-2.5 rounded-full ${d.name === "Locked" ? "bg-emerald-500" : d.name === "Lock Expired" ? "bg-red-500" : "bg-gray-400"}`} />
                      <span className="text-sm">{d.name}</span>
                    </div>
                    <span className="text-sm font-semibold">{d.value} loans</span>
                  </div>
                ))}
                <div className="border-t border-[var(--border)] pt-3 mt-3">
                  <h4 className="text-xs font-semibold text-[var(--text-muted)] mb-2">Top Milestones</h4>
                  {stats.milestoneData.slice(0, 5).map((d, i) => (
                    <div key={i} className="flex items-center justify-between py-1.5">
                      <span className="text-xs">{d.name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium">{d.units}</span>
                        <span className="text-xs text-[var(--text-muted)]">{fmtCurrencyShort(d.volume)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* ─── Section 6: Performance & Comparison ─── */}
        <SectionHeader id="performance" title="Performance Metrics" icon={TrendingUp} subtitle="Avg loan size, rate by program, LO scorecard" />
        {expandedSection === "performance" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mb-6">
            {/* Avg Loan Amount by Program */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Avg Loan Amount by Program" data={stats.avgByProgram} />
              <h3 className="text-sm font-semibold mb-1">Avg Loan Amount by Type</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Average loan size per program</p>
              <ChartActions id="avg-program" data={stats.avgByProgram} formatValue="currency" />
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.avgByProgram}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => fmtCurrencyShort(v)} />
                  <Tooltip formatter={(v) => fmtCurrency(Number(v))} />
                  <Bar dataKey="avgAmount" name="Avg Loan" radius={[4, 4, 0, 0]}>
                    {stats.avgByProgram.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Avg Rate by Program */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Average Rate by Program" data={stats.avgRateByProgram} />
              <h3 className="text-sm font-semibold mb-1">Avg Interest Rate by Type</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Weighted average note rate</p>
              <ChartActions id="avg-rate" data={stats.avgRateByProgram} formatValue="rate" />
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.avgRateByProgram}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis domain={["auto", "auto"]} tick={{ fontSize: 11 }} tickFormatter={(v) => `${v}%`} />
                  <Tooltip formatter={(v) => `${v}%`} />
                  <Bar dataKey="avgRate" name="Avg Rate" radius={[4, 4, 0, 0]}>
                    {stats.avgRateByProgram.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Milestone Volume Stacked */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Milestone Volume Breakdown" data={stats.milestoneVolData} />
              <h3 className="text-sm font-semibold mb-1">Volume by Milestone</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Units and volume per stage</p>
              <ChartActions id="ms-volume" data={stats.milestoneVolData} formatValue="currency" />
              <ResponsiveContainer width="100%" height={Math.max(320, stats.milestoneVolData.length * 28 + 40)}>
                <BarChart data={stats.milestoneVolData} layout="vertical" margin={{ left: 10, right: 20, top: 5, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtCurrencyShort(v)} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={130} />
                  <Tooltip formatter={(v, name) => name === "Volume" ? fmtCurrencyShort(Number(v)) : v} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar dataKey="volume" name="Volume" fill="#EA580C" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* LO Scorecard */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="LO Performance Scorecard" data={stats.loTableData} />
              <h3 className="text-sm font-semibold mb-1">Loan Officer Scorecard</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Top 15 by volume with avg loan</p>
              <ChartActions id="lo-scorecard" data={stats.loTableData} formatValue="currency" />
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)]">
                      <th className="text-left py-2 font-semibold">#</th>
                      <th className="text-left py-2 font-semibold">Loan Officer</th>
                      <th className="text-right py-2 font-semibold">Units</th>
                      <th className="text-right py-2 font-semibold">Volume</th>
                      <th className="text-right py-2 font-semibold">Avg Loan</th>
                      <th className="text-right py-2 font-semibold">Share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {stats.loTableData.slice(0, 15).map((d, i) => (
                      <tr key={i} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-secondary)]">
                        <td className="py-1.5 text-[var(--text-muted)]">{i + 1}</td>
                        <td className="py-1.5 font-medium truncate max-w-[140px]">{d.name}</td>
                        <td className="py-1.5 text-right">{d.units}</td>
                        <td className="py-1.5 text-right font-medium">{fmtCurrencyShort(d.volume)}</td>
                        <td className="py-1.5 text-right">{fmtCurrencyShort(d.avgLoan)}</td>
                        <td className="py-1.5 text-right">
                          <span className="inline-flex items-center">
                            <span className="w-12 h-1.5 bg-gray-100 rounded-full mr-1 inline-block">
                              <span className="block h-full bg-[var(--accent)] rounded-full" style={{ width: `${Math.min(d.pct * 3, 100)}%` }} />
                            </span>
                            {d.pct}%
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─── Section 7: Cross-Tab Analysis ─── */}
        <SectionHeader id="crosstab" title="Cross-Tab Analysis" icon={BarChart3} subtitle="State vs Purpose, Program mix" />
        {expandedSection === "crosstab" && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 sm:gap-4 mb-6">
            {/* State vs Purpose stacked bar */}
            <div className="glass-card p-4 group relative lg:col-span-2">
              <InsightButton chartName="State vs Purpose" data={stats.statePurposeData} />
              <h3 className="text-sm font-semibold mb-1">Loan Purpose by State (Top 10)</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Purchase vs Refinance distribution</p>
              <ChartActions id="state-purpose" data={stats.statePurposeData as Array<Record<string, unknown>>} />
              <ResponsiveContainer width="100%" height={320}>
                <BarChart data={stats.statePurposeData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  {stats.allPurposes.slice(0, 6).map((purp, i) => (
                    <Bar key={purp} dataKey={purp} name={purp.replace("NoCash-Out ", "No C/O ").replace("Cash-Out ", "C/O ")} stackId="a" fill={COLORS[i % COLORS.length]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Volume vs Units comparison by program */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Units vs Volume by Program" data={stats.programData} />
              <h3 className="text-sm font-semibold mb-1">Volume vs Units by Program</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">Comparing size contribution</p>
              <ChartActions id="vol-vs-units" data={stats.programData} formatValue="currency" />
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={stats.programData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis yAxisId="vol" tick={{ fontSize: 10 }} tickFormatter={(v) => fmtCurrencyShort(v)} />
                  <YAxis yAxisId="u" orientation="right" tick={{ fontSize: 10 }} />
                  <Tooltip formatter={(v, name) => name === "Volume" ? fmtCurrencyShort(Number(v)) : v} />
                  <Legend wrapperStyle={{ fontSize: 10 }} />
                  <Bar yAxisId="vol" dataKey="volume" name="Volume" fill="#EA580C" radius={[4, 4, 0, 0]} />
                  <Bar yAxisId="u" dataKey="units" name="Units" fill="#2563EB" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>

            {/* Lock Status Donut */}
            <div className="glass-card p-4 group relative">
              <InsightButton chartName="Lock Status Detail" data={stats.lockData} />
              <h3 className="text-sm font-semibold mb-1">Lock Status Breakdown</h3>
              <p className="text-xs text-[var(--text-muted)] mb-3">{stats.lockData.map(d => `${d.name}: ${d.value}`).join(", ")}</p>
              <ChartActions id="lock-donut" data={stats.lockData} />
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie data={stats.lockData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={90}
                    label={({ name, percent }) => `${name} ${((percent ?? 0) * 100).toFixed(0)}%`} labelLine={{ strokeWidth: 1 }} style={{ fontSize: 11 }}>
                    {stats.lockData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
