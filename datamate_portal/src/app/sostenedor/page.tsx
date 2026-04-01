"use client";

import { useState, useEffect, useRef } from "react";
import {
  AlertTriangle, Shield, ShieldAlert, ShieldCheck,
  TrendingUp, TrendingDown, DollarSign, Users, FileText,
  Building2, ChevronRight, Loader2, Search, Sparkles,
  BarChart3, PieChart, ArrowUpRight, ArrowDownRight, Minus, Download,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";
import BenchmarkPanel from "./benchmark";
import SimulatePanel from "./simulate";
import AcreditacionPanel from "./acreditacion";
import HistoricosPanel from "./historicos";
import ProyeccionPanel from "./proyeccion";
import MineducPanel from "./mineduc";

interface SostenedorProfile {
  sost_id: string;
  periodo: string;
  nombre: string;
  rut: string;
  region_rbd: string;
  dependencia_rbd: string;
  rbd_count: number;
  total_ingresos: number;
  total_gastos: number;
  balance: number;
  subvenciones: string;
  gasto_admin: number;
  gasto_pedagogico: number;
  gasto_innovacion: number;
  gasto_operacion: number;
  gasto_infraestructura: number;
  ind4_admin_ratio: number;
  ind4_level: string;
  ind10_innovacion_ratio: number;
  balance_ratio: number;
  balance_level: string;
  total_haberes: number;
  total_liquido: number;
  trabajadores: number;
  planta_fija: number;
  contrata: number;
  total_horas: number;
  ind9_payroll_ratio: number;
  ind9_level: string;
  ind11_hhi: number;
  ind11_level: string;
  doc_count: number;
  doc_monto: number;
  doc_types: string;
  proveedores_unicos: number;
  doc_coverage_ratio: number;
  risk_score: number;
  risk_level: string;
}

interface SostenedorSummary {
  sostenedores: SostenedorProfile[];
  total: number;
  criticos: number;
  alertas: number;
  ok: number;
}

const fmt = (val: number) => {
  if (!val) return "$0";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(val);
};

const fmtPct = (val: number) => (val !== null && val !== undefined ? `${val}%` : "--");

const riskColor = (level: string) => {
  switch (level) {
    case "CRITICO": return "text-red-600 bg-red-50 border-red-200";
    case "ALERTA": return "text-amber-600 bg-amber-50 border-amber-200";
    default: return "text-emerald-600 bg-emerald-50 border-emerald-200";
  }
};

const riskIcon = (level: string) => {
  switch (level) {
    case "CRITICO": return <ShieldAlert className="w-5 h-5 text-red-500" />;
    case "ALERTA": return <AlertTriangle className="w-5 h-5 text-amber-500" />;
    default: return <ShieldCheck className="w-5 h-5 text-emerald-500" />;
  }
};

const trendIcon = (val: number | null) => {
  if (val === null || val === undefined) return <Minus className="w-3 h-3 text-gray-400" />;
  if (val > 5) return <ArrowUpRight className="w-3 h-3 text-emerald-500" />;
  if (val < -5) return <ArrowDownRight className="w-3 h-3 text-red-500" />;
  return <Minus className="w-3 h-3 text-gray-400" />;
};

function IndicatorCard({ label, value, threshold, level, icon }: {
  label: string; value: string; threshold: string; level: string; icon: React.ReactNode;
}) {
  return (
    <div className={`p-3 rounded-lg border ${riskColor(level)}`}>
      <div className="flex items-center gap-2 mb-1">
        {icon}
        <span className="text-xs font-medium">{label}</span>
      </div>
      <div className="text-xl font-bold">{value}</div>
      <div className="text-[10px] opacity-70">Umbral: {threshold}</div>
    </div>
  );
}

export default function SostenedorPage() {
  const [summary, setSummary] = useState<SostenedorSummary | null>(null);
  const [selectedSost, setSelectedSost] = useState<string | null>(null);
  const [profile, setProfile] = useState<SostenedorProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingProfile, setLoadingProfile] = useState(false);
  const [analysis, setAnalysis] = useState("");
  const [analyzingAI, setAnalyzingAI] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [chatInput, setChatInput] = useState("");
  const [activeDetailTab, setActiveDetailTab] = useState<"analisis" | "benchmark" | "simulacion" | "acreditacion" | "historicos" | "proyeccion" | "mineduc">("analisis");
  const analysisRef = useRef<HTMLDivElement>(null);

  // Load sostenedores list
  useEffect(() => {
    fetch("/api/sostenedor/profile")
      .then(r => { if (!r.ok) throw new Error("API error"); return r.json(); })
      .then(d => { if (d?.sostenedores) setSummary(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  // Load individual profile
  const loadProfile = async (sostId: string) => {
    setSelectedSost(sostId);
    setLoadingProfile(true);
    setAnalysis("");
    try {
      const res = await fetch(`/api/sostenedor/profile?sost_id=${sostId}`);
      const data = await res.json();
      setProfile(data.profile || []);
    } catch { /* */ }
    setLoadingProfile(false);
  };

  // AI Analysis
  const runAnalysis = async (question?: string) => {
    if (!selectedSost) return;
    setAnalyzingAI(true);
    setAnalysis("");
    try {
      const res = await fetch("/api/sostenedor/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sost_id: selectedSost, question }),
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let text = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setAnalysis(text);
        analysisRef.current?.scrollTo({ top: analysisRef.current.scrollHeight });
      }
    } catch { /* */ }
    setAnalyzingAI(false);
  };

  const handleChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (chatInput.trim()) {
      runAnalysis(chatInput.trim());
      setChatInput("");
    }
  };

  const latest = profile.length > 0 ? profile[profile.length - 1] : null;
  const filteredSost = summary?.sostenedores?.filter(s =>
    !searchInput || s.nombre.toLowerCase().includes(searchInput.toLowerCase()) || s.sost_id.includes(searchInput)
  ) || [];

  return (
    <div className="min-h-screen">
      <AppHeader activeTab="perfiles" />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4">

        {!selectedSost ? (
          /* ── SOSTENEDOR LIST ── */
          <>
            <h1 className="text-xl font-bold mb-4">Perfiles de Sostenedores</h1>

            {/* Risk Summary Cards */}
            {summary && (
              <div className="grid grid-cols-4 gap-3 mb-4">
                <div className="glass-card p-4 text-center">
                  <div className="text-2xl font-bold">{summary.total}</div>
                  <div className="text-xs text-[var(--text-muted)]">Total Sostenedores</div>
                </div>
                <div className="glass-card p-4 text-center border-l-4 border-red-400">
                  <div className="text-2xl font-bold text-red-600">{summary.criticos}</div>
                  <div className="text-xs text-red-500">Criticos</div>
                </div>
                <div className="glass-card p-4 text-center border-l-4 border-amber-400">
                  <div className="text-2xl font-bold text-amber-600">{summary.alertas}</div>
                  <div className="text-xs text-amber-500">En Alerta</div>
                </div>
                <div className="glass-card p-4 text-center border-l-4 border-emerald-400">
                  <div className="text-2xl font-bold text-emerald-600">{summary.ok}</div>
                  <div className="text-xs text-emerald-500">OK</div>
                </div>
              </div>
            )}

            {/* Search */}
            <div className="relative mb-4">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
              <input
                type="text" value={searchInput} onChange={e => setSearchInput(e.target.value)}
                placeholder="Buscar por nombre o ID de sostenedor..."
                className="w-full pl-10 pr-4 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
              />
            </div>

            {loading ? (
              <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" /></div>
            ) : (
              <div className="space-y-2">
                {filteredSost.map(s => (
                  <button key={s.sost_id} onClick={() => loadProfile(s.sost_id)}
                    className="w-full glass-card p-4 flex items-center gap-4 hover:bg-[var(--bg-secondary)] transition-colors text-left"
                  >
                    {riskIcon(s.risk_level)}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm truncate">{s.nombre || s.sost_id}</div>
                      <div className="text-xs text-[var(--text-muted)]">
                        ID: {s.sost_id} | {s.dependencia_rbd} | Region {s.region_rbd} | {s.rbd_count} establec.
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className={`text-sm font-bold px-2 py-0.5 rounded border ${riskColor(s.risk_level)}`}>
                        {s.risk_score}
                      </div>
                      <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{s.periodo}</div>
                    </div>
                    <div className="text-right shrink-0 hidden sm:block">
                      <div className="text-xs text-[var(--text-muted)]">Ingresos</div>
                      <div className="text-sm font-mono">{fmt(s.total_ingresos)}</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-[var(--text-muted)] shrink-0" />
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          /* ── SOSTENEDOR DETAIL ── */
          <>
            <button onClick={() => setSelectedSost(null)} className="text-sm text-[var(--accent)] hover:underline mb-3 flex items-center gap-1">
              &larr; Volver a lista
            </button>

            {loadingProfile ? (
              <div className="flex justify-center py-12"><Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" /></div>
            ) : latest ? (
              <>
                {/* Header */}
                <div className="glass-card p-4 mb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <h1 className="text-xl font-bold">{latest.nombre || latest.sost_id}</h1>
                      <div className="text-sm text-[var(--text-muted)]">
                        ID: {latest.sost_id} | RUT: {latest.rut} | {latest.dependencia_rbd} | Region {latest.region_rbd} | {latest.rbd_count} establecimientos
                      </div>
                    </div>
                    <div className={`text-center px-4 py-2 rounded-lg border ${riskColor(latest.risk_level)}`}>
                      <div className="text-2xl font-bold">{latest.risk_score}</div>
                      <div className="text-xs font-medium">{latest.risk_level}</div>
                    </div>
                  </div>
                </div>

                {/* SIE Indicators Grid */}
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
                  <IndicatorCard
                    label="#4 Concentracion Admin"
                    value={fmtPct(latest.ind4_admin_ratio)}
                    threshold=">20% alerta, >30% critico"
                    level={latest.ind4_level}
                    icon={<PieChart className="w-4 h-4" />}
                  />
                  <IndicatorCard
                    label="#9 Gasto Remuneracional"
                    value={fmtPct(latest.ind9_payroll_ratio)}
                    threshold=">65% alerta, >85% critico"
                    level={latest.ind9_level}
                    icon={<Users className="w-4 h-4" />}
                  />
                  <IndicatorCard
                    label="#10 Innovacion Pedagogica"
                    value={fmtPct(latest.ind10_innovacion_ratio)}
                    threshold="Mayor = mejor"
                    level={latest.ind10_innovacion_ratio < 5 ? "ALERTA" : "OK"}
                    icon={<Sparkles className="w-4 h-4" />}
                  />
                  <IndicatorCard
                    label="#11 Concentracion HHI"
                    value={latest.ind11_hhi?.toFixed(3) || "--"}
                    threshold=">0.25 alerta, >0.5 critico"
                    level={latest.ind11_level}
                    icon={<BarChart3 className="w-4 h-4" />}
                  />
                </div>

                {/* Financial Summary + Balance */}
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                  <div className="glass-card p-3">
                    <div className="text-[10px] text-[var(--text-muted)]">Total Ingresos</div>
                    <div className="text-sm font-bold font-mono text-emerald-600">{fmt(latest.total_ingresos)}</div>
                  </div>
                  <div className="glass-card p-3">
                    <div className="text-[10px] text-[var(--text-muted)]">Total Gastos</div>
                    <div className="text-sm font-bold font-mono text-red-600">{fmt(latest.total_gastos)}</div>
                  </div>
                  <div className="glass-card p-3">
                    <div className="text-[10px] text-[var(--text-muted)]">Saldo (Balance)</div>
                    <div className={`text-sm font-bold font-mono ${latest.balance >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                      {fmt(latest.balance)}
                    </div>
                  </div>
                  <div className="glass-card p-3">
                    <div className="text-[10px] text-[var(--text-muted)]">Trabajadores</div>
                    <div className="text-sm font-bold">{latest.trabajadores.toLocaleString()}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{latest.planta_fija} fija + {latest.contrata} contrata</div>
                  </div>
                  <div className="glass-card p-3">
                    <div className="text-[10px] text-[var(--text-muted)]">Documentos</div>
                    <div className="text-sm font-bold">{latest.doc_count.toLocaleString()}</div>
                    <div className="text-[10px] text-[var(--text-muted)]">{latest.proveedores_unicos} proveedores</div>
                  </div>
                </div>

                {/* Spending Breakdown */}
                <div className="glass-card p-4 mb-4">
                  <h3 className="text-sm font-semibold mb-3">Distribucion del Gasto ({latest.periodo})</h3>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {[
                      { label: "Pedagogico (410*)", val: latest.gasto_pedagogico, color: "bg-emerald-500" },
                      { label: "Administrativo (420*)", val: latest.gasto_admin, color: "bg-red-400" },
                      { label: "Operacional (4109*)", val: latest.gasto_operacion, color: "bg-blue-400" },
                      { label: "Infraestructura (4116*)", val: latest.gasto_infraestructura, color: "bg-amber-400" },
                    ].map(item => {
                      const pct = latest.total_gastos > 0 ? (item.val / latest.total_gastos * 100) : 0;
                      return (
                        <div key={item.label}>
                          <div className="flex justify-between text-xs mb-1">
                            <span>{item.label}</span>
                            <span className="font-medium">{pct.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-gray-100 rounded-full h-2">
                            <div className={`${item.color} h-2 rounded-full`} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{fmt(item.val)}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Historical Timeline */}
                {profile.length > 1 && (
                  <div className="glass-card p-4 mb-4">
                    <h3 className="text-sm font-semibold mb-3">Evolucion Historica</h3>
                    <div className="overflow-x-auto">
                      <table className="data-table text-xs">
                        <thead>
                          <tr>
                            <th>Periodo</th>
                            <th>Ingresos</th>
                            <th>Gastos</th>
                            <th>Saldo</th>
                            <th>#4 Admin</th>
                            <th>#9 Remun.</th>
                            <th>#11 HHI</th>
                            <th>Trabajadores</th>
                            <th>Docs</th>
                            <th>Riesgo</th>
                          </tr>
                        </thead>
                        <tbody>
                          {profile.map(p => (
                            <tr key={p.periodo}>
                              <td className="font-medium">{p.periodo}</td>
                              <td className="font-mono">{fmt(p.total_ingresos)}</td>
                              <td className="font-mono">{fmt(p.total_gastos)}</td>
                              <td className={`font-mono ${p.balance >= 0 ? "text-emerald-600" : "text-red-600"}`}>{fmt(p.balance)}</td>
                              <td><span className={`px-1 py-0.5 rounded text-[10px] border ${riskColor(p.ind4_level)}`}>{fmtPct(p.ind4_admin_ratio)}</span></td>
                              <td><span className={`px-1 py-0.5 rounded text-[10px] border ${riskColor(p.ind9_level)}`}>{fmtPct(p.ind9_payroll_ratio)}</span></td>
                              <td><span className={`px-1 py-0.5 rounded text-[10px] border ${riskColor(p.ind11_level)}`}>{p.ind11_hhi?.toFixed(3)}</span></td>
                              <td>{p.trabajadores.toLocaleString()}</td>
                              <td>{p.doc_count.toLocaleString()}</td>
                              <td><span className={`px-1.5 py-0.5 rounded text-[10px] font-bold border ${riskColor(p.risk_level)}`}>{p.risk_score}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Export Button */}
                <div className="flex justify-end mb-2">
                  <a
                    href={`/api/export?type=sostenedor&format=csv&sost_id=${encodeURIComponent(latest.sost_id)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1.5 text-xs border border-[var(--border)] px-3 py-1.5 rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
                  >
                    <Download className="w-3.5 h-3.5" />
                    Exportar CSV
                  </a>
                </div>

                {/* Detail Tabs */}
                <div className="flex flex-wrap gap-1 mb-4 bg-[var(--bg-secondary)] p-1 rounded-lg border border-[var(--border)]">
                  {(["analisis", "benchmark", "simulacion", "acreditacion", "historicos", "proyeccion", "mineduc"] as const).map(tab => (
                    <button
                      key={tab}
                      onClick={() => setActiveDetailTab(tab)}
                      className={`flex-1 min-w-[80px] py-1.5 px-2 text-xs font-medium rounded-md transition-colors ${
                        activeDetailTab === tab
                          ? "bg-white text-[var(--accent)] shadow-sm"
                          : "text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}
                    >
                      {tab === "analisis" && "Análisis IA"}
                      {tab === "benchmark" && "Benchmark"}
                      {tab === "simulacion" && "Simulación"}
                      {tab === "acreditacion" && "#6 Acreditación"}
                      {tab === "historicos" && "#7 Histórico"}
                      {tab === "proyeccion" && "#8 Proyección"}
                      {tab === "mineduc" && "#1·2·12·13 MINEDUC"}
                    </button>
                  ))}
                </div>

                {/* Tab Content */}
                {activeDetailTab === "analisis" && (
                  <div className="glass-card p-4 mb-4">
                    <div className="flex items-center justify-between mb-3">
                      <h3 className="text-sm font-semibold flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-[var(--accent)]" />
                        Analisis IA — Milo Fiscal
                      </h3>
                      {!analyzingAI && (
                        <button onClick={() => runAnalysis()} className="px-3 py-1.5 bg-[var(--accent)] text-white rounded-lg text-xs hover:opacity-80">
                          {analysis ? "Regenerar Analisis" : "Generar Analisis Completo"}
                        </button>
                      )}
                    </div>

                    {analyzingAI && !analysis && (
                      <div className="flex items-center gap-2 text-sm text-[var(--text-muted)] py-4">
                        <Loader2 className="w-4 h-4 animate-spin" />
                        Analizando perfil fiscal con inteligencia artificial...
                      </div>
                    )}

                    {analysis && (
                      <div ref={analysisRef} className="prose prose-sm max-w-none max-h-[600px] overflow-y-auto text-sm"
                        dangerouslySetInnerHTML={{ __html: analysis.replace(/\n/g, "<br>").replace(/## (.*)/g, '<h3 class="text-base font-bold mt-4 mb-2">$1</h3>').replace(/### (.*)/g, '<h4 class="text-sm font-semibold mt-3 mb-1">$1</h4>').replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>') }}
                      />
                    )}

                    <form onSubmit={handleChat} className="mt-4 flex gap-2">
                      <input
                        type="text" value={chatInput} onChange={e => setChatInput(e.target.value)}
                        placeholder="Pregunta algo sobre este sostenedor..."
                        className="flex-1 px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
                        disabled={analyzingAI}
                      />
                      <button type="submit" disabled={analyzingAI || !chatInput.trim()}
                        className="px-4 py-2 bg-[var(--accent)] text-white rounded-lg text-sm disabled:opacity-30"
                      >
                        Preguntar
                      </button>
                    </form>
                  </div>
                )}

                {activeDetailTab === "benchmark" && (
                  <BenchmarkPanel sostId={latest.sost_id} periodo={latest.periodo} />
                )}

                {activeDetailTab === "simulacion" && (
                  <SimulatePanel sostId={latest.sost_id} periodo={latest.periodo} />
                )}

                {activeDetailTab === "acreditacion" && (
                  <AcreditacionPanel sostId={latest.sost_id} periodo={latest.periodo} />
                )}

                {activeDetailTab === "historicos" && (
                  <HistoricosPanel sostId={latest.sost_id} />
                )}

                {activeDetailTab === "proyeccion" && (
                  <ProyeccionPanel sostId={latest.sost_id} />
                )}

                {activeDetailTab === "mineduc" && (
                  <MineducPanel sostId={latest.sost_id} />
                )}
              </>
            ) : (
              <div className="glass-card p-8 text-center text-[var(--text-muted)]">
                Sostenedor no encontrado. Los perfiles se generan desde las vistas materializadas.
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
