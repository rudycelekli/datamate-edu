"use client";

import { useState, useEffect, useCallback } from "react";
import {
  AlertTriangle, Shield, ShieldAlert, ShieldCheck,
  Bell, RefreshCw, Filter, Download, Loader2, Search,
  TrendingUp, TrendingDown, DollarSign, Users, FileText,
  Info, X,
} from "lucide-react";
import AppHeader from "@/components/AppHeader";

interface Alert {
  sost_id: string;
  nombre: string;
  tipo: string;
  nivel: "CRITICO" | "ALERTA" | "INFO";
  descripcion: string;
  valor: number | string;
  umbral: string;
  periodo: string;
}

interface AlertSummary {
  alertas: Alert[];
  resumen: {
    total: number;
    mostrados: number;
    por_tipo: Record<string, number>;
    por_nivel: Record<string, number>;
    sostenedores_afectados: number;
  };
  generado_en: string;
}

const TIPO_LABELS: Record<string, string> = {
  GASTO_NO_ACEPTADO_RIESGO: "Gasto No Aceptado",
  DEFICIT_CRITICO: "Déficit Crítico",
  CONCENTRACION_INGRESOS: "Concentración Ingresos",
  BAJA_INNOVACION: "Baja Innovación",
  DESAJUSTE_DOCS: "Desajuste Documental",
  SOBRECARGA_REMUNERACIONES: "Sobrecarga Remuneraciones",
  VARIACION_ANOMALA: "Variación Anómala",
};

const TIPO_ICONS: Record<string, React.ReactNode> = {
  GASTO_NO_ACEPTADO_RIESGO: <DollarSign className="w-3.5 h-3.5" />,
  DEFICIT_CRITICO: <TrendingDown className="w-3.5 h-3.5" />,
  CONCENTRACION_INGRESOS: <TrendingUp className="w-3.5 h-3.5" />,
  BAJA_INNOVACION: <FileText className="w-3.5 h-3.5" />,
  DESAJUSTE_DOCS: <FileText className="w-3.5 h-3.5" />,
  SOBRECARGA_REMUNERACIONES: <Users className="w-3.5 h-3.5" />,
  VARIACION_ANOMALA: <TrendingDown className="w-3.5 h-3.5" />,
};

const nivelColor = (nivel: string) => {
  switch (nivel) {
    case "CRITICO": return "text-red-700 bg-red-50 border-red-200";
    case "ALERTA": return "text-amber-700 bg-amber-50 border-amber-200";
    default: return "text-blue-700 bg-blue-50 border-blue-200";
  }
};

const nivelBadge = (nivel: string) => {
  switch (nivel) {
    case "CRITICO": return "bg-red-100 text-red-700 border border-red-200";
    case "ALERTA": return "bg-amber-100 text-amber-700 border border-amber-200";
    default: return "bg-blue-100 text-blue-700 border border-blue-200";
  }
};

const nivelIcon = (nivel: string) => {
  switch (nivel) {
    case "CRITICO": return <ShieldAlert className="w-4 h-4 text-red-500" />;
    case "ALERTA": return <AlertTriangle className="w-4 h-4 text-amber-500" />;
    default: return <Info className="w-4 h-4 text-blue-500" />;
  }
};

export default function AlertasPage() {
  const [data, setData] = useState<AlertSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [filterNivel, setFilterNivel] = useState("");
  const [filterTipo, setFilterTipo] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);

  const fetchAlerts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ limit: "2000" });
      if (filterNivel) params.set("nivel", filterNivel);
      if (filterTipo) params.set("tipo", filterTipo);
      const res = await fetch(`/api/alerts?${params}`);
      const json = await res.json();
      if (json.error) throw new Error(json.error);
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al cargar alertas");
    }
    setLoading(false);
  }, [filterNivel, filterTipo]);

  useEffect(() => {
    fetchAlerts();
  }, [fetchAlerts]);

  const filtered = data?.alertas.filter(a =>
    !searchInput ||
    a.nombre.toLowerCase().includes(searchInput.toLowerCase()) ||
    a.sost_id.includes(searchInput)
  ) || [];

  const handleExport = () => {
    const params = new URLSearchParams({ format: "csv", type: "alerts" });
    window.open(`/api/export?${params}`, "_blank");
  };

  return (
    <div className="min-h-screen">
      <AppHeader activeTab="alertas" />
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4">

        {/* Page Title */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold flex items-center gap-2">
              <Bell className="w-5 h-5 text-[var(--accent)]" />
              Alertas Automáticas
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              Detección automática de riesgos fiscales en sostenedores educacionales
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handleExport}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs border border-[var(--border)] rounded-lg hover:bg-[var(--bg-secondary)] transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              Exportar CSV
            </button>
            <button
              onClick={fetchAlerts}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-[var(--accent)] text-white rounded-lg hover:opacity-80 transition-opacity disabled:opacity-50"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
              Actualizar
            </button>
          </div>
        </div>

        {/* Summary Cards */}
        {data && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
            <div className="glass-card p-4 text-center">
              <div className="text-2xl font-bold text-[var(--text)]">{data.resumen.total.toLocaleString("es-CL")}</div>
              <div className="text-xs text-[var(--text-muted)]">Total Alertas</div>
            </div>
            <div className="glass-card p-4 text-center border-l-4 border-red-400">
              <div className="text-2xl font-bold text-red-600">{(data.resumen.por_nivel.CRITICO || 0).toLocaleString("es-CL")}</div>
              <div className="text-xs text-red-500">Críticas</div>
            </div>
            <div className="glass-card p-4 text-center border-l-4 border-amber-400">
              <div className="text-2xl font-bold text-amber-600">{(data.resumen.por_nivel.ALERTA || 0).toLocaleString("es-CL")}</div>
              <div className="text-xs text-amber-500">En Alerta</div>
            </div>
            <div className="glass-card p-4 text-center border-l-4 border-blue-400">
              <div className="text-2xl font-bold text-blue-600">{data.resumen.sostenedores_afectados.toLocaleString("es-CL")}</div>
              <div className="text-xs text-blue-500">Sostenedores Afectados</div>
            </div>
          </div>
        )}

        {/* Alert Type Summary */}
        {data && Object.keys(data.resumen.por_tipo).length > 0 && (
          <div className="glass-card p-4 mb-4">
            <h2 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Filter className="w-4 h-4 text-[var(--accent)]" />
              Alertas por Tipo
            </h2>
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.resumen.por_tipo)
                .sort(([, a], [, b]) => b - a)
                .map(([tipo, count]) => (
                  <button
                    key={tipo}
                    onClick={() => setFilterTipo(filterTipo === tipo ? "" : tipo)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs border transition-colors ${
                      filterTipo === tipo
                        ? "bg-[var(--accent)] text-white border-[var(--accent)]"
                        : "border-[var(--border)] hover:bg-[var(--bg-secondary)]"
                    }`}
                  >
                    {TIPO_ICONS[tipo]}
                    {TIPO_LABELS[tipo] || tipo}
                    <span className="font-bold ml-0.5">{count}</span>
                  </button>
                ))}
            </div>
          </div>
        )}

        {/* Filters */}
        <div className="flex flex-wrap gap-2 mb-4">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)]" />
            <input
              type="text"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              placeholder="Buscar sostenedor por nombre o ID..."
              className="w-full pl-10 pr-4 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <select
            value={filterNivel}
            onChange={e => setFilterNivel(e.target.value)}
            className="px-3 py-2 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--accent)]"
          >
            <option value="">Todos los niveles</option>
            <option value="CRITICO">Solo Críticos</option>
            <option value="ALERTA">Solo Alertas</option>
            <option value="INFO">Solo Informativos</option>
          </select>
          {(filterNivel || filterTipo || searchInput) && (
            <button
              onClick={() => { setFilterNivel(""); setFilterTipo(""); setSearchInput(""); }}
              className="flex items-center gap-1 px-3 py-2 text-sm border border-[var(--border)] rounded-lg hover:bg-[var(--bg-secondary)]"
            >
              <X className="w-3.5 h-3.5" />
              Limpiar
            </button>
          )}
        </div>

        {/* Content */}
        {loading && !data ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
          </div>
        ) : error ? (
          <div className="glass-card p-6 text-center text-red-500 text-sm">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="glass-card p-8 text-center text-[var(--text-muted)]">
            <ShieldCheck className="w-12 h-12 mx-auto mb-3 text-emerald-400" />
            <div className="text-base font-medium">Sin alertas</div>
            <div className="text-sm mt-1">No se encontraron alertas con los filtros seleccionados.</div>
          </div>
        ) : (
          <>
            <div className="text-xs text-[var(--text-muted)] mb-2">
              Mostrando {filtered.length} de {data?.resumen.total || 0} alertas
              {data?.generado_en && (
                <span className="ml-2">— Generado {new Date(data.generado_en).toLocaleString("es-CL")}</span>
              )}
            </div>
            <div className="space-y-2">
              {filtered.map((alert, idx) => {
                const key = `${alert.sost_id}-${alert.tipo}-${alert.periodo}-${idx}`;
                const isExpanded = expandedAlert === key;
                return (
                  <div
                    key={key}
                    className={`glass-card border-l-4 ${
                      alert.nivel === "CRITICO"
                        ? "border-l-red-500"
                        : alert.nivel === "ALERTA"
                          ? "border-l-amber-500"
                          : "border-l-blue-500"
                    } transition-all cursor-pointer`}
                    onClick={() => setExpandedAlert(isExpanded ? null : key)}
                  >
                    <div className="p-3 flex items-center gap-3">
                      {nivelIcon(alert.nivel)}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate max-w-[300px]">
                            {alert.nombre || alert.sost_id}
                          </span>
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold ${nivelBadge(alert.nivel)}`}>
                            {alert.nivel}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] border border-[var(--border)] text-[var(--text-muted)]">
                            {TIPO_LABELS[alert.tipo] || alert.tipo}
                          </span>
                          <span className="text-[10px] text-[var(--text-muted)]">{alert.periodo}</span>
                        </div>
                        <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">
                          {alert.descripcion}
                        </p>
                      </div>
                      <div className="text-xs text-[var(--text-muted)] shrink-0 hidden sm:block">
                        ID: {alert.sost_id}
                      </div>
                    </div>
                    {isExpanded && (
                      <div className={`px-4 pb-3 pt-1 border-t border-[var(--border)] ${nivelColor(alert.nivel)} rounded-b-xl`}>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                          <div>
                            <div className="text-[10px] font-semibold uppercase opacity-60 mb-0.5">Descripción</div>
                            <div>{alert.descripcion}</div>
                          </div>
                          <div>
                            <div className="text-[10px] font-semibold uppercase opacity-60 mb-0.5">Valor Detectado</div>
                            <div className="font-mono font-semibold">
                              {typeof alert.valor === "number"
                                ? alert.valor.toLocaleString("es-CL", { maximumFractionDigits: 3 })
                                : alert.valor}
                            </div>
                          </div>
                          <div>
                            <div className="text-[10px] font-semibold uppercase opacity-60 mb-0.5">Umbral</div>
                            <div>{alert.umbral}</div>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
