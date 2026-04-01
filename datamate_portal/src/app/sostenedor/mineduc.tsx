"use client";

import { useState, useEffect } from "react";
import { Loader2, Users, BookOpen, Award, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, Info } from "lucide-react";

interface PeriodoRow {
  periodo: string;
  mineduc_agno: string | null;
  risk_score: number | null;
  risk_level: string | null;
  mat_total: number | null;
  n_establecimientos: number | null;
  n_docentes: number | null;
  gasto_pedagogico: number | null;
  total_gastos: number;
  ind1_costo_por_alumno: number | null;
  ind2_eficiencia_ped_pct: number | null;
  ind2_costo_ped_por_alumno: number | null;
  ind13_alumnos_por_docente: number | null;
  ind13_horas_por_alumno: number | null;
}

interface SNEDRow {
  periodo_sned: string;
  indice_sned_promedio: number;
  n_seleccionados: number;
  pct_seleccionados: number;
  n_establecimientos: number;
  risk_score_fiscal: number | null;
  risk_level_fiscal: string | null;
  sned_riesgo_flag: string | null;
}

interface MineducData {
  sost_id: string;
  nombre: string;
  has_mineduc_data: boolean;
  summary: {
    periodo: string;
    ind1_costo_por_alumno: number | null;
    ind1_benchmark: number;
    ind1_flag: string | null;
    ind2_pct_pedagogico: number | null;
    ind2_benchmark: number;
    ind2_flag: string | null;
    ind13_alumnos_por_docente: number | null;
    ind13_benchmark: number;
    ind13_flag: string | null;
    ind12_sned_index: number | null;
    ind12_sned_flag: string | null;
    mat_total: number | null;
    n_establecimientos: number | null;
    n_docentes: number | null;
  } | null;
  by_periodo: PeriodoRow[];
  sned: SNEDRow[];
  data_coverage: {
    fiscal_periods: number;
    mineduc_mat_periods: number;
    mineduc_doc_periods: number;
    sned_periods: number;
  };
}

const fmt = (v: number | null) => {
  if (v === null || v === undefined) return "—";
  return new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);
};
const fmtN = (v: number | null) => v === null ? "—" : new Intl.NumberFormat("es-CL").format(v);
const fmtPct = (v: number | null) => v === null ? "—" : `${v}%`;

function FlagBadge({ flag }: { flag: string | null }) {
  if (!flag) return null;
  const styles: Record<string, string> = {
    CRITICO: "text-red-700 bg-red-50 border-red-200",
    ALERTA: "text-amber-700 bg-amber-50 border-amber-200",
    ALERTA_CRITICA: "text-red-700 bg-red-50 border-red-200",
    OK: "text-emerald-700 bg-emerald-50 border-emerald-200",
    NORMAL: "text-blue-700 bg-blue-50 border-blue-200",
  };
  const labels: Record<string, string> = { CRITICO: "CRÍTICO", ALERTA: "ALERTA", ALERTA_CRITICA: "ALERTA CRÍTICA", OK: "OK", NORMAL: "NORMAL" };
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border font-semibold ${styles[flag] || "text-gray-600 bg-gray-50 border-gray-200"}`}>
      {labels[flag] || flag}
    </span>
  );
}

function TrendIcon({ values }: { values: (number | null)[] }) {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length < 2) return <Minus className="w-3.5 h-3.5 text-gray-400" />;
  const delta = valid[valid.length - 1] - valid[0];
  const pct = Math.abs(delta / (valid[0] || 1)) * 100;
  if (pct < 5) return <Minus className="w-3.5 h-3.5 text-gray-400" />;
  return delta > 0
    ? <TrendingUp className="w-3.5 h-3.5 text-emerald-500" />
    : <TrendingDown className="w-3.5 h-3.5 text-red-500" />;
}

export default function MineducPanel({ sostId }: { sostId: string }) {
  const [data, setData] = useState<MineducData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!sostId) return;
    setLoading(true);
    fetch(`/api/sostenedor/mineduc?sost_id=${encodeURIComponent(sostId)}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sostId]);

  if (loading) return (
    <div className="glass-card p-6 flex items-center gap-2 text-sm text-[var(--text-muted)]">
      <Loader2 className="w-4 h-4 animate-spin" /> Cargando indicadores MINEDUC...
    </div>
  );
  if (error) return <div className="glass-card p-4 text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl">{error}</div>;
  if (!data) return null;

  if (!data.has_mineduc_data) {
    return (
      <div className="glass-card p-4 flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl">
        <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-semibold text-amber-800">Sin datos MINEDUC disponibles</p>
          <p className="text-xs text-amber-700 mt-0.5">No se encontró matrícula ni dotación docente para este sostenedor en los datos de 2023–2024. Puede tratarse de un sostenedor municipal o de un tipo no incluido en las bases públicas.</p>
        </div>
      </div>
    );
  }

  const s = data.summary!;
  const rows = data.by_periodo;

  return (
    <div className="space-y-4">
      {/* Coverage note */}
      <div className="flex items-center gap-2 text-[10px] text-[var(--text-muted)] bg-[var(--bg-secondary)] rounded-lg px-3 py-1.5 border border-[var(--border)]">
        <CheckCircle className="w-3 h-3 text-emerald-500" />
        Datos MINEDUC (ref. {rows[0]?.mineduc_agno || "más reciente"}): {s.n_establecimientos} establecimientos · {fmtN(s.mat_total)} estudiantes · {fmtN(s.n_docentes)} docentes
        {rows[0]?.mineduc_agno && rows[0].mineduc_agno !== rows[0].periodo && (
          <span className="text-amber-600 ml-1">· MINEDUC {rows[0].mineduc_agno} usado como referencia para período fiscal {rows[0].periodo}</span>
        )}
      </div>

      {/* KPI cards: 4 indicators */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {/* #1 Costo por alumno */}
        <div className="glass-card p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Users className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span className="text-[10px] text-[var(--text-muted)] font-medium">#1 Costo/Alumno</span>
          </div>
          <div className="text-sm font-bold font-mono">{fmt(s.ind1_costo_por_alumno)}</div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Benchmark: {fmt(s.ind1_benchmark)}</div>
          <div className="mt-1"><FlagBadge flag={s.ind1_flag} /></div>
        </div>

        {/* #2 Eficiencia pedagógica */}
        <div className="glass-card p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <BookOpen className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span className="text-[10px] text-[var(--text-muted)] font-medium">#2 Gasto Pedagógico</span>
          </div>
          <div className="text-sm font-bold font-mono">{fmtPct(s.ind2_pct_pedagogico)}</div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Benchmark: {s.ind2_benchmark}%</div>
          <div className="mt-1"><FlagBadge flag={s.ind2_flag} /></div>
        </div>

        {/* #13 Alumnos/docente */}
        <div className="glass-card p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <TrendingUp className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span className="text-[10px] text-[var(--text-muted)] font-medium">#13 Alumnos/Docente</span>
          </div>
          <div className="text-sm font-bold font-mono">
            {s.ind13_alumnos_por_docente !== null ? `${s.ind13_alumnos_por_docente}` : "—"}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Benchmark: {s.ind13_benchmark}</div>
          <div className="mt-1"><FlagBadge flag={s.ind13_flag} /></div>
        </div>

        {/* #12 SNED */}
        <div className="glass-card p-3">
          <div className="flex items-center gap-1.5 mb-1">
            <Award className="w-3.5 h-3.5 text-[var(--accent)]" />
            <span className="text-[10px] text-[var(--text-muted)] font-medium">#12 Índice SNED</span>
          </div>
          <div className="text-sm font-bold font-mono">
            {s.ind12_sned_index !== null ? s.ind12_sned_index.toFixed(1) : "—"}
          </div>
          <div className="text-[10px] text-[var(--text-muted)] mt-0.5">Sobre 100 pts</div>
          <div className="mt-1"><FlagBadge flag={s.ind12_sned_flag} /></div>
        </div>
      </div>

      {/* Per-period table */}
      {rows.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-xs font-semibold text-[var(--text)] mb-3 flex items-center gap-2">
            <TrendingUp className="w-3.5 h-3.5 text-[var(--accent)]" />
            Evolución de Indicadores por Período
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-2 pr-3 font-semibold text-[var(--text-muted)]">Período</th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">Matrícula</th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">Docentes</th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">#1 Costo/Alum.</th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">#2 %Pedagóg.</th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">#13 Al/Doc</th>
                  <th className="text-right py-2 pl-2 font-semibold text-[var(--text-muted)]">Riesgo</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.periodo} className="border-b border-[var(--border)] border-opacity-40 hover:bg-[var(--bg-secondary)]">
                    <td className="py-1.5 pr-3 font-medium">{r.periodo}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmtN(r.mat_total)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmtN(r.n_docentes)}</td>
                    <td className={`py-1.5 px-2 text-right font-mono ${r.ind1_costo_por_alumno && r.ind1_costo_por_alumno > 3_750_000 ? "text-red-600" : r.ind1_costo_por_alumno && r.ind1_costo_por_alumno > 3_000_000 ? "text-amber-600" : ""}`}>
                      {fmt(r.ind1_costo_por_alumno)}
                    </td>
                    <td className={`py-1.5 px-2 text-right font-mono ${(r.ind2_eficiencia_ped_pct ?? 100) < 40 ? "text-red-600" : (r.ind2_eficiencia_ped_pct ?? 100) < 65 ? "text-amber-600" : "text-emerald-600"}`}>
                      {fmtPct(r.ind2_eficiencia_ped_pct)}
                    </td>
                    <td className={`py-1.5 px-2 text-right font-mono ${(r.ind13_alumnos_por_docente ?? 0) > 37.5 ? "text-red-600" : (r.ind13_alumnos_por_docente ?? 0) > 25 ? "text-amber-600" : ""}`}>
                      {r.ind13_alumnos_por_docente !== null ? r.ind13_alumnos_por_docente : "—"}
                    </td>
                    <td className="py-1.5 pl-2 text-right">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${
                        r.risk_level === "CRITICO" ? "bg-red-100 text-red-700"
                        : r.risk_level === "ALERTA" ? "bg-amber-100 text-amber-700"
                        : "bg-emerald-100 text-emerald-700"
                      }`}>{r.risk_level || "—"}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-[var(--border)]">
                  <td className="py-1.5 pr-3 text-[10px] text-[var(--text-muted)] font-semibold">Tendencia</td>
                  <td className="py-1.5 px-2 text-right"><TrendIcon values={rows.map(r => r.mat_total)} /></td>
                  <td className="py-1.5 px-2 text-right"><TrendIcon values={rows.map(r => r.n_docentes)} /></td>
                  <td className="py-1.5 px-2 text-right"><TrendIcon values={rows.map(r => r.ind1_costo_por_alumno)} /></td>
                  <td className="py-1.5 px-2 text-right"><TrendIcon values={rows.map(r => r.ind2_eficiencia_ped_pct)} /></td>
                  <td className="py-1.5 px-2 text-right"><TrendIcon values={rows.map(r => r.ind13_alumnos_por_docente)} /></td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* SNED section */}
      {data.sned.length > 0 && (
        <div className="glass-card p-4">
          <h4 className="text-xs font-semibold text-[var(--text)] mb-3 flex items-center gap-2">
            <Award className="w-3.5 h-3.5 text-[var(--accent)]" />
            #12 SNED — Desempeño Educativo vs Riesgo Financiero
          </h4>
          <div className="space-y-2">
            {data.sned.map(s => (
              <div key={s.periodo_sned} className="flex items-center gap-3 p-2.5 rounded-lg bg-[var(--bg-secondary)] border border-[var(--border)]">
                <div className="text-xs font-semibold w-24 shrink-0">{s.periodo_sned}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-[var(--text-muted)]">Índice SNED:</span>
                    <span className="text-xs font-mono font-semibold">{s.indice_sned_promedio.toFixed(1)}</span>
                    <span className="text-[10px] text-[var(--text-muted)]">·</span>
                    <span className="text-xs text-[var(--text-muted)]">Seleccionados:</span>
                    <span className="text-xs font-mono">{s.n_seleccionados}/{s.n_establecimientos} ({s.pct_seleccionados}%)</span>
                    {s.risk_score_fiscal !== null && (
                      <>
                        <span className="text-[10px] text-[var(--text-muted)]">·</span>
                        <span className="text-xs text-[var(--text-muted)]">Riesgo fiscal:</span>
                        <span className={`text-xs font-mono font-semibold ${(s.risk_score_fiscal || 0) > 60 ? "text-red-600" : "text-emerald-600"}`}>{s.risk_score_fiscal}</span>
                      </>
                    )}
                  </div>
                </div>
                {s.sned_riesgo_flag === "ALERTA_CRITICA" && (
                  <AlertTriangle className="w-4 h-4 text-red-500 shrink-0" />
                )}
                <FlagBadge flag={s.sned_riesgo_flag} />
              </div>
            ))}
          </div>
          <p className="text-[10px] text-[var(--text-muted)] mt-2">
            ALERTA CRÍTICA: establecimientos con buen desempeño SNED (índice &gt;60) pero alto riesgo fiscal (&gt;60 puntos). Indica sostenedores pedagógicamente exitosos pero financieramente vulnerables.
          </p>
        </div>
      )}
    </div>
  );
}
