"use client";

import { useState, useEffect } from "react";
import { Loader2, FileCheck, AlertTriangle, ShieldCheck, ShieldAlert, ChevronDown, ChevronUp } from "lucide-react";

interface AccountRecon {
  cuenta_alias: string;
  desc_cuenta: string;
  declared: number;
  documented: number;
  gap: number;
  coverage_pct: number;
  status: string;
}

interface AcreditacionData {
  sost_id: string;
  periodo: string;
  risk_level: "OK" | "ALERTA" | "CRITICO";
  summary: {
    declared_ingresos: number;
    declared_gastos: number;
    declared_balance: number;
    documented_total: number;
    coverage_ratio: number;
    total_gap: number;
    gap_ratio: number;
    gna_amount: number;
    gna_ratio: number;
    er_rows: number;
    doc_rows: number;
  };
  estado_breakdown: { estado: string; monto: number; is_accepted: boolean }[];
  account_reconciliation: AccountRecon[];
  doc_by_type: { tipo: string; monto: number }[];
}

const fmt = (v: number) =>
  new Intl.NumberFormat("es-CL", { style: "currency", currency: "CLP", minimumFractionDigits: 0, maximumFractionDigits: 0 }).format(v);

const riskColors = {
  OK: "text-emerald-700 bg-emerald-50 border-emerald-200",
  ALERTA: "text-amber-700 bg-amber-50 border-amber-200",
  CRITICO: "text-red-700 bg-red-50 border-red-200",
};

const statusDot = (s: string) => {
  if (s === "OK") return "bg-emerald-500";
  if (s === "ALERTA") return "bg-amber-500";
  return "bg-red-500";
};

export default function AcreditacionPanel({ sostId, periodo }: { sostId: string; periodo: string }) {
  const [data, setData] = useState<AcreditacionData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAllAccounts, setShowAllAccounts] = useState(false);

  useEffect(() => {
    if (!sostId || !periodo) return;
    setLoading(true);
    setError(null);
    fetch(`/api/sostenedor/acreditacion?sost_id=${encodeURIComponent(sostId)}&periodo=${encodeURIComponent(periodo)}`)
      .then(r => r.json())
      .then(d => { if (d.error) throw new Error(d.error); setData(d); })
      .catch(e => setError(e.message))
      .finally(() => setLoading(false));
  }, [sostId, periodo]);

  if (loading) return (
    <div className="glass-card p-6 flex items-center gap-2 text-sm text-[var(--text-muted)]">
      <Loader2 className="w-4 h-4 animate-spin" /> Cargando acreditación de saldos...
    </div>
  );
  if (error) return <div className="glass-card p-4 text-sm text-red-500 bg-red-50 border border-red-200 rounded-xl">{error}</div>;
  if (!data) return null;

  const { summary } = data;
  const visibleAccounts = showAllAccounts ? data.account_reconciliation : data.account_reconciliation.slice(0, 10);

  return (
    <div className="glass-card p-4 mb-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <FileCheck className="w-4 h-4 text-[var(--accent)]" />
          #6 Acreditación de Saldos — {data.periodo}
        </h3>
        <span className={`text-xs px-2 py-0.5 rounded-full border font-semibold ${riskColors[data.risk_level]}`}>
          {data.risk_level}
        </span>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
        <div className="bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-muted)] mb-0.5">Gastos Declarados</div>
          <div className="text-sm font-bold font-mono">{fmt(summary.declared_gastos)}</div>
        </div>
        <div className="bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-muted)] mb-0.5">Documentos Respaldo</div>
          <div className="text-sm font-bold font-mono">{fmt(summary.documented_total)}</div>
        </div>
        <div className={`rounded-lg p-3 border ${summary.coverage_ratio >= 80 ? "bg-emerald-50 border-emerald-200" : summary.coverage_ratio >= 50 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
          <div className="text-[10px] mb-0.5 opacity-70">Cobertura Documental</div>
          <div className="text-xl font-bold">{summary.coverage_ratio}%</div>
          <div className="text-[10px] opacity-60">umbral: ≥80%</div>
        </div>
        <div className={`rounded-lg p-3 border ${summary.gna_ratio <= 5 ? "bg-emerald-50 border-emerald-200" : summary.gna_ratio <= 10 ? "bg-amber-50 border-amber-200" : "bg-red-50 border-red-200"}`}>
          <div className="text-[10px] mb-0.5 opacity-70">GNA (Gasto No Aceptado)</div>
          <div className="text-xl font-bold">{summary.gna_ratio}%</div>
          <div className="text-[10px] opacity-60">{fmt(summary.gna_amount)}</div>
        </div>
      </div>

      {/* Gap bar */}
      {summary.declared_gastos > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-[10px] text-[var(--text-muted)] mb-1">
            <span>Gastos con respaldo documental</span>
            <span>{summary.coverage_ratio}% cubierto</span>
          </div>
          <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden">
            <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${Math.min(summary.coverage_ratio, 100)}%` }} />
          </div>
          <div className="flex justify-between text-[10px] mt-0.5">
            <span className="text-emerald-600">{fmt(summary.documented_total)} documentado</span>
            <span className="text-red-500">{fmt(summary.total_gap)} brecha</span>
          </div>
        </div>
      )}

      {/* Estado breakdown */}
      {data.estado_breakdown.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-semibold mb-2 text-[var(--text-muted)]">Estados de Declaración</h4>
          <div className="flex flex-wrap gap-1.5">
            {data.estado_breakdown.map(e => (
              <span key={e.estado} className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] border ${e.is_accepted ? "bg-emerald-50 border-emerald-200 text-emerald-700" : "bg-red-50 border-red-200 text-red-700"}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${e.is_accepted ? "bg-emerald-500" : "bg-red-500"}`} />
                {e.estado} · {fmt(e.monto)}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Account reconciliation table */}
      {data.account_reconciliation.length > 0 && (
        <div>
          <h4 className="text-xs font-semibold mb-2 text-[var(--text-muted)]">
            Conciliación por Cuenta ({data.account_reconciliation.length} cuentas)
          </h4>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left py-1.5 pr-2 font-semibold text-[var(--text-muted)]">Cuenta</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-[var(--text-muted)]">Declarado</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-[var(--text-muted)]">Documentado</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-[var(--text-muted)]">Brecha</th>
                  <th className="text-right py-1.5 px-2 font-semibold text-[var(--text-muted)]">Cobertura</th>
                  <th className="text-center py-1.5 pl-2 font-semibold text-[var(--text-muted)]">Estado</th>
                </tr>
              </thead>
              <tbody>
                {visibleAccounts.map(acc => (
                  <tr key={acc.cuenta_alias} className="border-b border-[var(--border)] border-opacity-40 hover:bg-[var(--bg-secondary)]">
                    <td className="py-1.5 pr-2">
                      <div className="font-medium">{acc.cuenta_alias}</div>
                      <div className="text-[10px] text-[var(--text-muted)] truncate max-w-[180px]">{acc.desc_cuenta}</div>
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmt(acc.declared)}</td>
                    <td className="py-1.5 px-2 text-right font-mono">{fmt(acc.documented)}</td>
                    <td className={`py-1.5 px-2 text-right font-mono font-semibold ${acc.gap > 0 ? "text-red-600" : "text-emerald-600"}`}>
                      {acc.gap > 0 ? "+" : ""}{fmt(acc.gap)}
                    </td>
                    <td className="py-1.5 px-2 text-right font-mono">{acc.coverage_pct}%</td>
                    <td className="py-1.5 pl-2 text-center">
                      <span className={`inline-block w-2 h-2 rounded-full ${statusDot(acc.status)}`} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {data.account_reconciliation.length > 10 && (
            <button
              onClick={() => setShowAllAccounts(!showAllAccounts)}
              className="mt-2 text-xs text-[var(--accent)] hover:underline flex items-center gap-1"
            >
              {showAllAccounts ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
              {showAllAccounts ? "Mostrar menos" : `Ver todas (${data.account_reconciliation.length} cuentas)`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
