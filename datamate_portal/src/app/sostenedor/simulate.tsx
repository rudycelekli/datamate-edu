"use client";

import { useState } from "react";
import {
  Loader2, Play, TrendingUp, TrendingDown, Minus,
  RefreshCw, Sliders, AlertTriangle, ShieldCheck, ShieldAlert,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  Simulation Panel — Scenario analysis for a sostenedor             */
/* ------------------------------------------------------------------ */

interface SimulationDeltas {
  [key: string]: { before: number; after: number; delta: number; pctChange: number };
}

interface SimulationResult {
  original: Record<string, unknown>;
  simulated: Record<string, unknown>;
  deltas: SimulationDeltas;
  adjustments: Record<string, number>;
  ai_narrative: string | null;
}

const fmt = (val: number) =>
  new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);

const fmtPct = (val: number) =>
  `${val >= 0 ? "+" : ""}${val.toFixed(1)}%`;

const deltaColor = (pct: number, higherIsBetter: boolean) => {
  const good = higherIsBetter ? pct > 2 : pct < -2;
  const bad = higherIsBetter ? pct < -2 : pct > 2;
  if (good) return "text-emerald-600";
  if (bad) return "text-red-600";
  return "text-amber-600";
};

const riskBadge = (level: string) => {
  switch (level) {
    case "CRITICO": return "bg-red-100 text-red-700 border border-red-200";
    case "ALERTA": return "bg-amber-100 text-amber-700 border border-amber-200";
    default: return "bg-emerald-100 text-emerald-700 border border-emerald-200";
  }
};

const riskIcon = (level: string) => {
  switch (level) {
    case "CRITICO": return <ShieldAlert className="w-4 h-4 text-red-500" />;
    case "ALERTA": return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    default: return <ShieldCheck className="w-4 h-4 text-emerald-500" />;
  }
};

const KEY_INDICATORS = [
  { key: "total_gastos", label: "Gasto Total", isCurrency: true, higherIsBetter: false },
  { key: "balance", label: "Saldo (Balance)", isCurrency: true, higherIsBetter: true },
  { key: "gasto_admin", label: "Gasto Admin", isCurrency: true, higherIsBetter: false },
  { key: "gasto_pedagogico", label: "Gasto Pedagógico", isCurrency: true, higherIsBetter: true },
  { key: "gasto_innovacion", label: "Gasto Innovación", isCurrency: true, higherIsBetter: true },
  { key: "ind4_admin_ratio", label: "#4 Admin (%)", isCurrency: false, higherIsBetter: false },
  { key: "ind9_payroll_ratio", label: "#9 Remunerac. (%)", isCurrency: false, higherIsBetter: false },
  { key: "ind10_innovacion_ratio", label: "#10 Innovación (%)", isCurrency: false, higherIsBetter: true },
  { key: "ind11_hhi", label: "#11 HHI", isCurrency: false, higherIsBetter: false },
  { key: "risk_score", label: "Puntaje Riesgo", isCurrency: false, higherIsBetter: false },
  { key: "tasa_ejecucion", label: "Tasa Ejecución (%)", isCurrency: false, higherIsBetter: false },
];

export default function SimulatePanel({
  sostId,
  periodo,
}: {
  sostId: string;
  periodo: string;
}) {
  const [adjustments, setAdjustments] = useState({
    gasto_admin_pct: 0,
    gasto_pedagogico_pct: 0,
    gasto_innovacion_pct: 0,
    total_gastos_pct: 0,
    trabajadores_pct: 0,
  });
  const [result, setResult] = useState<SimulationResult | null>(null);
  const [aiNarrative, setAiNarrative] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasChanges = Object.values(adjustments).some(v => v !== 0);

  const runSimulation = async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    setAiNarrative("");

    try {
      const res = await fetch("/api/sostenedor/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sost_id: sostId, periodo, adjustments }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || "Error en simulación");
      }

      // Check if streaming (text/plain) or JSON
      const contentType = res.headers.get("content-type") || "";

      if (contentType.includes("text/plain")) {
        // Streaming response: first line is JSON data, then narrative text
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let simData: SimulationResult | null = null;
        let narrativeStarted = false;
        let narrativeText = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          if (!narrativeStarted && buffer.includes("---STREAM_START---")) {
            const parts = buffer.split("---STREAM_START---");
            try {
              simData = JSON.parse(parts[0].trim());
              setResult(simData);
            } catch { /* skip */ }
            narrativeText = parts[1] || "";
            narrativeStarted = true;
            setAiNarrative(narrativeText);
          } else if (narrativeStarted) {
            narrativeText = buffer.split("---STREAM_START---")[1] || "";
            setAiNarrative(narrativeText);
          }
        }
      } else {
        // JSON response (no AI key set)
        const data = await res.json();
        setResult(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error desconocido");
    }
    setLoading(false);
  };

  const resetAdjustments = () => {
    setAdjustments({
      gasto_admin_pct: 0,
      gasto_pedagogico_pct: 0,
      gasto_innovacion_pct: 0,
      total_gastos_pct: 0,
      trabajadores_pct: 0,
    });
    setResult(null);
    setAiNarrative("");
    setError(null);
  };

  const AdjSlider = ({
    label,
    field,
    hint,
  }: {
    label: string;
    field: keyof typeof adjustments;
    hint: string;
  }) => {
    const val = adjustments[field];
    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-medium">{label}</label>
          <span
            className={`text-xs font-mono font-bold ${
              val > 0 ? "text-emerald-600" : val < 0 ? "text-red-600" : "text-[var(--text-muted)]"
            }`}
          >
            {val > 0 ? "+" : ""}{val}%
          </span>
        </div>
        <input
          type="range"
          min="-50"
          max="50"
          step="1"
          value={val}
          onChange={e =>
            setAdjustments(prev => ({ ...prev, [field]: Number(e.target.value) }))
          }
          className="w-full accent-[var(--accent)]"
        />
        <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{hint}</div>
      </div>
    );
  };

  return (
    <div className="glass-card p-4 mb-4">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Sliders className="w-4 h-4 text-[var(--accent)]" />
          Simulación de Escenarios
        </h3>
        <div className="flex items-center gap-2">
          {hasChanges && (
            <button
              onClick={resetAdjustments}
              className="flex items-center gap-1 text-xs text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)] px-2 py-1 rounded-lg"
            >
              <RefreshCw className="w-3 h-3" />
              Reiniciar
            </button>
          )}
          <button
            onClick={runSimulation}
            disabled={loading || !hasChanges}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-[var(--accent)] text-white rounded-lg text-xs hover:opacity-80 disabled:opacity-30 transition-opacity"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Play className="w-3.5 h-3.5" />
            )}
            Ejecutar Simulación
          </button>
        </div>
      </div>

      {/* Sliders */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
        <AdjSlider
          label="Gasto Administrativo"
          field="gasto_admin_pct"
          hint="Ajuste sobre gasto administrativo (420*)"
        />
        <AdjSlider
          label="Gasto Pedagógico"
          field="gasto_pedagogico_pct"
          hint="Ajuste sobre gasto pedagógico (410*)"
        />
        <AdjSlider
          label="Gasto en Innovación"
          field="gasto_innovacion_pct"
          hint="Ajuste sobre cuentas 410500, 410600, 410700"
        />
        <AdjSlider
          label="Gasto Total (proporcional)"
          field="total_gastos_pct"
          hint="Escala todos los gastos proporcionalmente"
        />
        <AdjSlider
          label="Dotación Docente"
          field="trabajadores_pct"
          hint="Ajuste sobre número de trabajadores"
        />
      </div>

      {!hasChanges && !result && (
        <p className="text-xs text-center text-[var(--text-muted)] py-4">
          Mueve los deslizadores para ajustar escenarios y ver el impacto en los indicadores.
        </p>
      )}

      {error && (
        <div className="text-sm text-red-500 bg-red-50 border border-red-200 rounded-lg p-3 mb-4">
          {error}
        </div>
      )}

      {/* Results */}
      {result && (
        <>
          {/* Risk Change */}
          <div className="flex items-center gap-3 bg-[var(--bg-secondary)] rounded-lg p-3 mb-4 border border-[var(--border)]">
            <div className="flex items-center gap-2">
              {riskIcon(result.original.risk_level as string)}
              <span className={`text-xs px-2 py-0.5 rounded font-semibold ${riskBadge(result.original.risk_level as string)}`}>
                {result.original.risk_level as string} ({result.original.risk_score as number})
              </span>
            </div>
            <span className="text-[var(--text-muted)] text-sm">→</span>
            <div className="flex items-center gap-2">
              {riskIcon(result.simulated.risk_level as string)}
              <span className={`text-xs px-2 py-0.5 rounded font-semibold ${riskBadge(result.simulated.risk_level as string)}`}>
                {result.simulated.risk_level as string} ({result.simulated.risk_score as number})
              </span>
            </div>
            {result.deltas.risk_score && result.deltas.risk_score.delta !== 0 && (
              <span className={`text-xs ml-auto font-medium ${result.deltas.risk_score.delta < 0 ? "text-emerald-600" : "text-red-600"}`}>
                {result.deltas.risk_score.delta < 0 ? "▼" : "▲"} {Math.abs(result.deltas.risk_score.delta).toFixed(0)} pts
              </span>
            )}
          </div>

          {/* Indicator Delta Table */}
          <div className="overflow-x-auto mb-4">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-2 pr-3 font-semibold text-[var(--text-muted)]">Indicador</th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">Original</th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">Simulado</th>
                  <th className="text-right py-2 px-2 font-semibold text-[var(--text-muted)]">Δ Cambio</th>
                  <th className="text-center py-2 pl-2 font-semibold text-[var(--text-muted)]">Tendencia</th>
                </tr>
              </thead>
              <tbody>
                {KEY_INDICATORS.map(ind => {
                  const d = result.deltas[ind.key];
                  if (!d) return null;
                  const changed = Math.abs(d.delta) > 0;
                  return (
                    <tr
                      key={ind.key}
                      className={`border-b border-[var(--border)] border-opacity-50 ${changed ? "" : "opacity-50"}`}
                    >
                      <td className="py-2 pr-3 font-medium">{ind.label}</td>
                      <td className="py-2 px-2 text-right font-mono text-[var(--text-muted)]">
                        {ind.isCurrency ? fmt(d.before) : d.before.toLocaleString("es-CL", { maximumFractionDigits: 3 })}
                      </td>
                      <td className="py-2 px-2 text-right font-mono font-semibold">
                        {ind.isCurrency ? fmt(d.after) : d.after.toLocaleString("es-CL", { maximumFractionDigits: 3 })}
                      </td>
                      <td className={`py-2 px-2 text-right font-mono font-semibold ${deltaColor(d.pctChange, ind.higherIsBetter)}`}>
                        {d.delta !== 0 ? (
                          ind.isCurrency
                            ? `${d.delta >= 0 ? "+" : ""}${fmt(d.delta)}`
                            : fmtPct(d.pctChange)
                        ) : (
                          <span className="text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                      <td className="py-2 pl-2 text-center">
                        {d.delta === 0 ? (
                          <Minus className="w-3.5 h-3.5 text-gray-300 mx-auto" />
                        ) : d.pctChange > 0 && ind.higherIsBetter ? (
                          <TrendingUp className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                        ) : d.pctChange > 0 && !ind.higherIsBetter ? (
                          <TrendingUp className="w-3.5 h-3.5 text-red-500 mx-auto" />
                        ) : d.pctChange < 0 && ind.higherIsBetter ? (
                          <TrendingDown className="w-3.5 h-3.5 text-red-500 mx-auto" />
                        ) : (
                          <TrendingDown className="w-3.5 h-3.5 text-emerald-500 mx-auto" />
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* AI Narrative */}
          {aiNarrative && (
            <div className="bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg p-4">
              <h4 className="text-xs font-semibold text-[var(--accent)] mb-2">Análisis IA del Escenario</h4>
              <div
                className="text-xs text-[var(--text)] prose prose-xs max-w-none leading-relaxed"
                dangerouslySetInnerHTML={{
                  __html: aiNarrative
                    .replace(/\n/g, "<br>")
                    .replace(/### (.*?)(<br>|$)/g, '<h4 class="text-sm font-semibold mt-3 mb-1">$1</h4>')
                    .replace(/## (.*?)(<br>|$)/g, '<h3 class="text-sm font-bold mt-4 mb-2">$1</h3>')
                    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>"),
                }}
              />
            </div>
          )}

          {loading && !aiNarrative && (
            <div className="flex items-center gap-2 text-xs text-[var(--text-muted)] mt-3">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Generando análisis del escenario con IA...
            </div>
          )}
        </>
      )}
    </div>
  );
}
