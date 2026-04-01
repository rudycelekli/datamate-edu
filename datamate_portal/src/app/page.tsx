"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Loader2,
  AlertCircle,
  FileText,
  DollarSign,
  ChevronUp,
  ChevronDown,
  Building2,
  CalendarDays,
  Columns3,
  Save,
  Trash2,
  Check,
  X,
  Eye,
  EyeOff,
} from "lucide-react";
import {
  getSostenedorCache,
  setSostenedorCache,
  isSostenedorFresh,
} from "@/lib/education-store";
import AppHeader from "@/components/AppHeader";

interface SostenedorRow {
  sost_id: string;
  sost_nombre: string;
  rut_sost: string;
  region_rbd: string;
  dependencia_rbd: string;
  total_ingresos: number;
  total_gastos: number;
  balance: number;
  periodo: string;
  rbd_count: number;
  subvencion_aliases: string;
  desc_estado: string;
  cuenta_categories: number;
  admin_ratio: number;
}

interface FilterOptions {
  regiones: string[];
  dependencias: string[];
  periodos: string[];
  subvenciones: string[];
  cuentas: string[];
}

interface SostenedorResponse {
  rows: SostenedorRow[];
  total: number;
  totalMonto: number;
  page: number;
  pageSize: number;
  filterOptions: FilterOptions;
}

interface ColumnDef {
  key: string;
  label: string;
  sortKey: SortKey | null;
  defaultVisible: boolean;
  render: (row: SostenedorRow) => React.ReactNode;
  className?: string;
}

interface SavedView {
  name: string;
  columns: string[];
  createdAt: number;
}

type SortDir = "asc" | "desc";
type SortKey = "sost_id" | "nombre" | "rut" | "region" | "dependencia" | "ingresos" | "gastos" | "balance" | "periodo" | "rbd_count" | "subvencion" | "estado" | "cuentas" | "admin_ratio";

const formatCurrency = (val: number) => {
  if (!val) return "--";
  return new Intl.NumberFormat("es-CL", {
    style: "currency",
    currency: "CLP",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(val);
};

const getDependenciaColor = (dep: string) => {
  switch (dep) {
    case "M": return "bg-blue-50 text-blue-700 border border-blue-200";
    case "CM": return "bg-purple-50 text-purple-700 border border-purple-200";
    case "SLEP": return "bg-emerald-50 text-emerald-700 border border-emerald-200";
    case "PS": return "bg-amber-50 text-amber-700 border border-amber-200";
    default: return "bg-gray-100 text-gray-600 border border-gray-200";
  }
};

const getDependenciaLabel = (dep: string) => {
  switch (dep) {
    case "M": return "Municipal";
    case "CM": return "Corp. Municipal";
    case "SLEP": return "SLEP";
    case "PS": return "Part. Subv.";
    default: return dep || "--";
  }
};

const getRiskColor = (ratio: number) => {
  if (ratio > 50) return "text-red-600 font-semibold";
  if (ratio > 35) return "text-amber-600 font-medium";
  return "text-gray-600";
};

const getBalanceColor = (balance: number) => {
  if (balance < 0) return "text-red-600";
  if (balance > 0) return "text-emerald-600";
  return "text-gray-500";
};

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  if (!active) return <ChevronUp className="w-3 h-3 text-transparent" />;
  return dir === "asc" ? (
    <ChevronUp className="w-3 h-3 text-[var(--accent)]" />
  ) : (
    <ChevronDown className="w-3 h-3 text-[var(--accent)]" />
  );
}

// ── Saved Views helpers ──

function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem("datamate_saved_views");
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function persistSavedViews(views: SavedView[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem("datamate_saved_views", JSON.stringify(views));
}

function loadActiveColumns(): string[] | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem("datamate_active_columns");
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

function persistActiveColumns(cols: string[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem("datamate_active_columns", JSON.stringify(cols));
}

// ── Column definitions ──

const ALL_COLUMNS: ColumnDef[] = [
  {
    key: "sost_id",
    label: "ID Sostenedor",
    sortKey: "sost_id",
    defaultVisible: true,
    render: (row) => <span className="font-mono text-[var(--accent)] font-medium">{row.sost_id || "--"}</span>,
  },
  {
    key: "sost_nombre",
    label: "Nombre",
    sortKey: "nombre",
    defaultVisible: true,
    render: (row) => <div className="font-medium text-sm">{row.sost_nombre || <span className="text-[var(--text-muted)] italic">Sin nombre</span>}</div>,
  },
  {
    key: "rut_sost",
    label: "RUT",
    sortKey: "rut",
    defaultVisible: false,
    render: (row) => <span className="font-mono text-sm">{row.rut_sost || "--"}</span>,
  },
  {
    key: "region_rbd",
    label: "Region",
    sortKey: "region",
    defaultVisible: true,
    render: (row) => <span className="text-sm">{row.region_rbd || "--"}</span>,
  },
  {
    key: "dependencia_rbd",
    label: "Dependencia",
    sortKey: "dependencia",
    defaultVisible: true,
    render: (row) => (
      <span className={`status-badge ${getDependenciaColor(row.dependencia_rbd)}`}>
        {getDependenciaLabel(row.dependencia_rbd)}
      </span>
    ),
  },
  {
    key: "total_ingresos",
    label: "Total Ingresos",
    sortKey: "ingresos",
    defaultVisible: true,
    render: (row) => <span className="font-mono">{formatCurrency(row.total_ingresos)}</span>,
  },
  {
    key: "total_gastos",
    label: "Total Gastos",
    sortKey: "gastos",
    defaultVisible: true,
    render: (row) => <span className="font-mono">{formatCurrency(row.total_gastos)}</span>,
  },
  {
    key: "balance",
    label: "Balance",
    sortKey: "balance",
    defaultVisible: false,
    render: (row) => <span className={`font-mono ${getBalanceColor(row.balance)}`}>{formatCurrency(row.balance)}</span>,
  },
  {
    key: "periodo",
    label: "Periodo",
    sortKey: "periodo",
    defaultVisible: true,
    render: (row) => <span className="text-xs text-[var(--text-muted)]">{row.periodo || "--"}</span>,
  },
  {
    key: "rbd_count",
    label: "Establec.",
    sortKey: "rbd_count",
    defaultVisible: false,
    render: (row) => <span className="text-sm text-center">{row.rbd_count || 0}</span>,
  },
  {
    key: "subvencion_aliases",
    label: "Subvenciones",
    sortKey: "subvencion",
    defaultVisible: false,
    render: (row) => <span className="text-xs max-w-[200px] truncate block" title={row.subvencion_aliases}>{row.subvencion_aliases || "--"}</span>,
  },
  {
    key: "desc_estado",
    label: "Estado",
    sortKey: "estado",
    defaultVisible: false,
    render: (row) => <span className="text-xs">{row.desc_estado || "--"}</span>,
  },
  {
    key: "cuenta_categories",
    label: "Categorias Cuenta",
    sortKey: "cuentas",
    defaultVisible: false,
    render: (row) => <span className="text-sm text-center">{row.cuenta_categories || 0}</span>,
  },
  {
    key: "admin_ratio",
    label: "% Admin",
    sortKey: "admin_ratio",
    defaultVisible: false,
    render: (row) => <span className={`text-sm ${getRiskColor(row.admin_ratio)}`}>{row.admin_ratio > 0 ? `${row.admin_ratio}%` : "--"}</span>,
  },
];

const DEFAULT_VISIBLE = ALL_COLUMNS.filter(c => c.defaultVisible).map(c => c.key);

export default function SostenedoresPage() {
  const [rows, setRows] = useState<SostenedorRow[]>(() => getSostenedorCache().data?.rows || []);
  const [total, setTotal] = useState(() => getSostenedorCache().data?.total || 0);
  const [totalMonto, setTotalMonto] = useState(() => getSostenedorCache().data?.totalMonto || 0);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(
    () => getSostenedorCache().data?.filterOptions || { regiones: [], dependencias: [], periodos: [], subvenciones: [], cuentas: [] },
  );
  const [loading, setLoading] = useState(() => !getSostenedorCache().data);
  const [error, setError] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const pageSize = 50;

  // Filters
  const [regionFilter, setRegionFilter] = useState("");
  const [dependenciaFilter, setDependenciaFilter] = useState("");
  const [periodoFilter, setPeriodoFilter] = useState("");
  const [subvencionFilter, setSubvencionFilter] = useState("");

  // Sort
  const [sortKey, setSortKey] = useState<SortKey>("nombre");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Column visibility
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => loadActiveColumns() || DEFAULT_VISIBLE);
  const [showColumnPicker, setShowColumnPicker] = useState(false);
  const columnPickerRef = useRef<HTMLDivElement>(null);

  // Saved views
  const [savedViews, setSavedViews] = useState<SavedView[]>(() => loadSavedViews());
  const [showSaveInput, setShowSaveInput] = useState(false);
  const [newViewName, setNewViewName] = useState("");

  // Close column picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (columnPickerRef.current && !columnPickerRef.current.contains(e.target as Node)) {
        setShowColumnPicker(false);
      }
    };
    if (showColumnPicker) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showColumnPicker]);

  // Persist column visibility
  useEffect(() => {
    persistActiveColumns(visibleColumns);
  }, [visibleColumns]);

  const toggleColumn = (key: string) => {
    setVisibleColumns(prev => {
      if (prev.includes(key)) {
        if (prev.length <= 1) return prev; // keep at least 1
        return prev.filter(k => k !== key);
      }
      return [...prev, key];
    });
  };

  const saveCurrentView = () => {
    if (!newViewName.trim()) return;
    const newView: SavedView = { name: newViewName.trim(), columns: [...visibleColumns], createdAt: Date.now() };
    const updated = [...savedViews.filter(v => v.name !== newView.name), newView];
    setSavedViews(updated);
    persistSavedViews(updated);
    setNewViewName("");
    setShowSaveInput(false);
  };

  const loadView = (view: SavedView) => {
    setVisibleColumns(view.columns);
    setShowColumnPicker(false);
  };

  const deleteView = (name: string) => {
    const updated = savedViews.filter(v => v.name !== name);
    setSavedViews(updated);
    persistSavedViews(updated);
  };

  const resetColumns = () => {
    setVisibleColumns(DEFAULT_VISIBLE);
  };

  const selectAllColumns = () => {
    setVisibleColumns(ALL_COLUMNS.map(c => c.key));
  };

  const activeColumns = ALL_COLUMNS.filter(c => visibleColumns.includes(c.key));

  const fetchData = useCallback(async (force = false) => {
    const params = new URLSearchParams({
      page: String(page),
      pageSize: String(pageSize),
      sortField: sortKey,
      sortDir: sortDir,
    });
    if (search) params.set("search", search);
    if (regionFilter) params.set("region", regionFilter);
    if (dependenciaFilter) params.set("dependencia", dependenciaFilter);
    if (periodoFilter) params.set("periodo", periodoFilter);
    if (subvencionFilter) params.set("subvencion", subvencionFilter);

    if (!force && isSostenedorFresh(params.toString())) return;

    const hasData = rows.length > 0;
    if (!hasData) setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/pipeline?${params}`);
      if (!res.ok) throw new Error(await res.text());
      const data: SostenedorResponse = await res.json();

      setRows(data.rows || []);
      setTotal(data.total || 0);
      setTotalMonto(data.totalMonto || 0);
      if (data.filterOptions) setFilterOptions(data.filterOptions);

      setSostenedorCache(data, params.toString());
    } catch (err: unknown) {
      if (!hasData) setError(err instanceof Error ? err.message : "Error al cargar datos");
    } finally {
      setLoading(false);
    }
  }, [page, search, sortKey, sortDir, regionFilter, dependenciaFilter, periodoFilter, subvencionFilter, rows.length]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(0);
    setSearch(searchInput);
  };

  const toggleSort = (key: SortKey) => {
    setPage(0);
    if (sortKey === key) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "ingresos" || key === "gastos" || key === "balance" || key === "admin_ratio" || key === "rbd_count" ? "desc" : "asc"); }
  };

  const handleFilterChange = (setter: (v: string) => void) => (e: React.ChangeEvent<HTMLSelectElement>) => {
    setPage(0);
    setter(e.target.value);
  };

  const activeFilterCount = [regionFilter, dependenciaFilter, periodoFilter, subvencionFilter].filter(Boolean).length;
  const totalPages = Math.ceil(total / pageSize);

  const selectClass = "px-2.5 py-1.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--accent)] min-w-0";

  return (
    <div className="min-h-screen">
      <AppHeader activeTab="sostenedores" />

      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-4 sm:py-6">
        {/* Search + Column Picker */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 sm:gap-3 mb-3">
          <form onSubmit={handleSearch} className="flex-1 relative">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Buscar por ID o nombre de sostenedor..."
              className="w-full pl-4 pr-20 py-2.5 bg-[var(--bg-secondary)] border border-[var(--border)] rounded-lg text-sm placeholder:text-[var(--text-muted)] focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              type="submit"
              className="absolute right-2 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-[var(--accent)] text-white rounded-md text-xs font-medium hover:bg-[var(--accent-dark)]"
            >
              Buscar
            </button>
          </form>

          {/* Column picker toggle */}
          <div className="relative" ref={columnPickerRef}>
            <button
              onClick={() => setShowColumnPicker(!showColumnPicker)}
              className={`flex items-center justify-center gap-2 px-4 py-2.5 border rounded-lg text-sm hover:bg-[var(--bg-secondary)] ${
                showColumnPicker ? "bg-[var(--accent)] text-white border-[var(--accent)]" : "bg-white border-[var(--border)]"
              }`}
              title="Configurar columnas"
            >
              <Columns3 className="w-4 h-4" />
              <span className="hidden sm:inline">Columnas</span>
              <span className="text-xs opacity-70">{visibleColumns.length}/{ALL_COLUMNS.length}</span>
            </button>

            {/* Column picker dropdown */}
            {showColumnPicker && (
              <div className="absolute right-0 top-full mt-2 w-80 bg-white border border-[var(--border)] rounded-xl shadow-xl z-50 overflow-hidden">
                <div className="p-3 border-b border-[var(--border)] bg-[var(--bg-secondary)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-semibold">Columnas visibles</span>
                    <div className="flex gap-1">
                      <button onClick={selectAllColumns} className="text-[10px] px-2 py-0.5 bg-[var(--accent)] text-white rounded hover:opacity-80">Todas</button>
                      <button onClick={resetColumns} className="text-[10px] px-2 py-0.5 bg-gray-200 text-gray-700 rounded hover:bg-gray-300">Default</button>
                    </div>
                  </div>
                </div>

                <div className="max-h-64 overflow-y-auto p-2">
                  {ALL_COLUMNS.map(col => (
                    <button
                      key={col.key}
                      onClick={() => toggleColumn(col.key)}
                      className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-left text-sm hover:bg-[var(--bg-secondary)] transition-colors ${
                        visibleColumns.includes(col.key) ? "text-[var(--text-primary)]" : "text-[var(--text-muted)]"
                      }`}
                    >
                      {visibleColumns.includes(col.key)
                        ? <Eye className="w-3.5 h-3.5 text-[var(--accent)] shrink-0" />
                        : <EyeOff className="w-3.5 h-3.5 shrink-0" />
                      }
                      <span className="flex-1">{col.label}</span>
                      {visibleColumns.includes(col.key) && <Check className="w-3 h-3 text-[var(--accent)]" />}
                    </button>
                  ))}
                </div>

                {/* Saved Views section */}
                <div className="border-t border-[var(--border)] p-3 bg-[var(--bg-secondary)]">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Vistas guardadas</span>
                    <button
                      onClick={() => setShowSaveInput(!showSaveInput)}
                      className="text-[10px] px-2 py-0.5 bg-[var(--accent)] text-white rounded hover:opacity-80 flex items-center gap-1"
                    >
                      <Save className="w-3 h-3" /> Guardar vista
                    </button>
                  </div>

                  {showSaveInput && (
                    <div className="flex gap-1 mb-2">
                      <input
                        type="text"
                        value={newViewName}
                        onChange={e => setNewViewName(e.target.value)}
                        onKeyDown={e => e.key === "Enter" && saveCurrentView()}
                        placeholder="Nombre de la vista..."
                        className="flex-1 px-2 py-1 text-xs border border-[var(--border)] rounded-lg focus:outline-none focus:border-[var(--accent)]"
                        autoFocus
                      />
                      <button onClick={saveCurrentView} className="p-1 text-emerald-600 hover:bg-emerald-50 rounded">
                        <Check className="w-4 h-4" />
                      </button>
                      <button onClick={() => { setShowSaveInput(false); setNewViewName(""); }} className="p-1 text-red-500 hover:bg-red-50 rounded">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  )}

                  {savedViews.length === 0 ? (
                    <p className="text-xs text-[var(--text-muted)] italic">No hay vistas guardadas</p>
                  ) : (
                    <div className="space-y-1 max-h-32 overflow-y-auto">
                      {savedViews.map(view => (
                        <div key={view.name} className="flex items-center gap-1 group">
                          <button
                            onClick={() => loadView(view)}
                            className="flex-1 text-left text-xs px-2 py-1 rounded hover:bg-white transition-colors truncate"
                            title={`${view.columns.length} columnas`}
                          >
                            {view.name}
                            <span className="text-[var(--text-muted)] ml-1">({view.columns.length})</span>
                          </button>
                          <button
                            onClick={() => deleteView(view.name)}
                            className="p-0.5 text-red-400 opacity-0 group-hover:opacity-100 hover:text-red-600 transition-opacity"
                            title="Eliminar vista"
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <button
            onClick={() => fetchData(true)}
            disabled={loading}
            className="flex items-center justify-center gap-2 px-4 py-2.5 bg-white border border-[var(--border)] rounded-lg text-sm hover:bg-[var(--bg-secondary)] disabled:opacity-50"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
            <span>Actualizar</span>
          </button>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2 sm:gap-4 mb-4">
          <div className="glass-card p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
            <FileText className="w-4 sm:w-5 h-4 sm:h-5 text-[var(--accent)] shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs text-[var(--text-muted)]">Total Registros</div>
              <div className="text-base sm:text-lg font-semibold truncate">{total.toLocaleString()}</div>
            </div>
          </div>
          <div className="glass-card p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
            <DollarSign className="w-4 sm:w-5 h-4 sm:h-5 text-emerald-600 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs text-[var(--text-muted)]">Monto Total</div>
              <div className="text-base sm:text-lg font-semibold truncate">{formatCurrency(totalMonto)}</div>
            </div>
          </div>
          <div className="glass-card p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
            <Building2 className="w-4 sm:w-5 h-4 sm:h-5 text-[var(--accent)] shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs text-[var(--text-muted)]">Mostrando</div>
              <div className="text-base sm:text-lg font-semibold truncate">
                {rows.length > 0 ? `${page * pageSize + 1}-${Math.min((page + 1) * pageSize, total)}` : "0"}
              </div>
            </div>
          </div>
          <div className="glass-card p-3 sm:p-4 flex items-center gap-2 sm:gap-3">
            <CalendarDays className="w-4 sm:w-5 h-4 sm:h-5 text-emerald-600 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] sm:text-xs text-[var(--text-muted)]">Pagina</div>
              <div className="text-base sm:text-lg font-semibold truncate">{`${page + 1} de ${totalPages || 1}`}</div>
            </div>
          </div>
        </div>

        {/* Filters */}
        <div className="glass-card p-3 mb-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Region</label>
              <select value={regionFilter} onChange={handleFilterChange(setRegionFilter)} className={`${selectClass} w-full`}>
                <option value="">Todas</option>
                {filterOptions.regiones.map((r) => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Dependencia</label>
              <select value={dependenciaFilter} onChange={handleFilterChange(setDependenciaFilter)} className={`${selectClass} w-full`}>
                <option value="">Todas</option>
                {filterOptions.dependencias.map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Periodo</label>
              <select value={periodoFilter} onChange={handleFilterChange(setPeriodoFilter)} className={`${selectClass} w-full`}>
                <option value="">Todos</option>
                {filterOptions.periodos.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-[var(--text-muted)] mb-0.5 block">Subvencion</label>
              <select value={subvencionFilter} onChange={handleFilterChange(setSubvencionFilter)} className={`${selectClass} w-full`}>
                <option value="">Todas</option>
                {filterOptions.subvenciones.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          </div>
          {activeFilterCount > 0 && (
            <div className="mt-2 pt-2 border-t border-[var(--border)]">
              <button
                onClick={() => { setRegionFilter(""); setDependenciaFilter(""); setPeriodoFilter(""); setSubvencionFilter(""); setPage(0); }}
                className="text-xs text-[var(--accent)] hover:underline"
              >
                Limpiar filtros ({activeFilterCount})
              </button>
            </div>
          )}
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg flex items-center gap-3 text-sm text-red-700">
            <AlertCircle className="w-5 h-5 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Loading */}
        {loading && rows.length === 0 && (
          <div className="glass-card p-12 flex flex-col items-center justify-center gap-3">
            <Loader2 className="w-8 h-8 animate-spin text-[var(--accent)]" />
            <p className="text-sm text-[var(--text-muted)]">Cargando datos...</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && rows.length === 0 && (
          <div className="glass-card p-12 flex flex-col items-center justify-center gap-3">
            <Building2 className="w-12 h-12 text-[var(--text-muted)]" />
            <p className="text-sm text-[var(--text-muted)]">No hay datos de sostenedores disponibles</p>
            <p className="text-xs text-[var(--text-muted)]">Las tablas del esquema desafio estan vacias. Carga datos para comenzar el analisis.</p>
          </div>
        )}

        {/* Table */}
        {(!loading || rows.length > 0) && rows.length > 0 && (
          <div className="glass-card overflow-hidden">
            <div className="overflow-x-auto max-h-[calc(100vh-300px)] sm:max-h-[calc(100vh-420px)]">
              <table className="data-table">
                <thead>
                  <tr>
                    {activeColumns.map(col => (
                      <th
                        key={col.key}
                        className={col.sortKey ? "cursor-pointer select-none" : ""}
                        onClick={() => col.sortKey && toggleSort(col.sortKey)}
                      >
                        <div className="flex items-center gap-1">
                          {col.label}
                          {col.sortKey && <SortIcon active={sortKey === col.sortKey} dir={sortDir} />}
                        </div>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, idx) => (
                    <tr key={`${row.sost_id}-${row.periodo}-${idx}`}>
                      {activeColumns.map(col => (
                        <td key={col.key} className={col.className}>{col.render(row)}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Pagination */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2 mt-4">
          <p className="text-xs text-[var(--text-muted)]">
            {rows.length > 0
              ? `Mostrando ${page * pageSize + 1}-${Math.min((page + 1) * pageSize, total)} de ${total.toLocaleString()} registros`
              : "Sin registros"}
          </p>
          <div className="flex gap-2 w-full sm:w-auto">
            <button onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={page === 0} className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-3 py-1.5 bg-white border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--bg-secondary)] disabled:opacity-30">
              <ChevronLeft className="w-3 h-3" /> Anterior
            </button>
            <button onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1} className="flex-1 sm:flex-none flex items-center justify-center gap-1 px-3 py-1.5 bg-white border border-[var(--border)] rounded-lg text-xs hover:bg-[var(--bg-secondary)] disabled:opacity-30">
              Siguiente <ChevronRight className="w-3 h-3" />
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
