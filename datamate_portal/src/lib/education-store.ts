/**
 * Client-side sessionStorage cache for education data.
 * Module variables give instant reads; sessionStorage survives hot reloads.
 */

export interface SostenedorRow {
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

export interface FilterOptions {
  regiones: string[];
  dependencias: string[];
  periodos: string[];
  subvenciones: string[];
  cuentas: string[];
}

interface SostenedorCache {
  rows: SostenedorRow[];
  total: number;
  totalMonto: number;
  filterOptions: FilterOptions;
}

// ── sessionStorage helpers (safe for SSR) ──

function ssGet<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch { return null; }
}

function ssSet(key: string, value: unknown) {
  if (typeof window === "undefined") return;
  try { sessionStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

// ── Shared state ──

let _sostenedorCache: SostenedorCache | null = null;
let _sostenedorParams = "";
let _sostenedorFetchTime = 0;

let _connectedStatus: boolean | null = null;

const STALE_MS = 300_000; // 5 minutes

// ── Sostenedores cache ──

export function getSostenedorCache() {
  if (!_sostenedorCache) {
    const stored = ssGet<{ data: SostenedorCache; params: string; fetchTime: number }>("sost_cache");
    if (stored && stored.data) {
      _sostenedorCache = stored.data;
      _sostenedorParams = stored.params;
      _sostenedorFetchTime = stored.fetchTime;
    }
  }
  return { data: _sostenedorCache, params: _sostenedorParams, fetchTime: _sostenedorFetchTime };
}

export function setSostenedorCache(data: SostenedorCache, params: string) {
  _sostenedorCache = data;
  _sostenedorParams = params;
  _sostenedorFetchTime = Date.now();
  ssSet("sost_cache", { data, params, fetchTime: _sostenedorFetchTime });
}

export function isSostenedorFresh(params: string): boolean {
  const cache = getSostenedorCache();
  if (!cache.data) return false;
  return _sostenedorParams === params && (Date.now() - _sostenedorFetchTime) < STALE_MS;
}

// ── Connection status ──

export function getConnectedStatus(): boolean | null {
  if (_connectedStatus === null) {
    const stored = ssGet<boolean>("conn_status");
    if (stored !== null) _connectedStatus = stored;
  }
  return _connectedStatus;
}

export function setConnectedStatus(status: boolean) {
  _connectedStatus = status;
  ssSet("conn_status", status);
}

// ── Education data summary for EduBot ──

export function getEducationSummary(): string | null {
  getSostenedorCache();
  const rows = _sostenedorCache?.rows;
  if (!rows || rows.length === 0) return null;

  const total = _sostenedorCache?.total || rows.length;
  const totalMonto = rows.reduce((s, r) => s + r.total_ingresos, 0);

  const regionCounts: Record<string, { count: number; monto: number }> = {};
  const depCounts: Record<string, number> = {};

  rows.forEach(r => {
    const reg = r.region_rbd || "";
    const dep = r.dependencia_rbd || "";

    if (reg) {
      if (!regionCounts[reg]) regionCounts[reg] = { count: 0, monto: 0 };
      regionCounts[reg].count++;
      regionCounts[reg].monto += r.total_ingresos;
    }
    if (dep) depCounts[dep] = (depCounts[dep] || 0) + 1;
  });

  const topRegiones = Object.entries(regionCounts)
    .sort((a, b) => b[1].monto - a[1].monto)
    .slice(0, 10)
    .map(([reg, d]) => `${reg}: ${d.count} registros ($${(d.monto / 1e6).toFixed(1)}M)`)
    .join("\n");

  const dependencias = Object.entries(depCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([d, cnt]) => `${d}: ${cnt}`)
    .join(", ");

  return `Resumen de Datos Educativos (${total} registros, $${(totalMonto / 1e6).toFixed(1)}M monto total):\n\nTop Regiones:\n${topRegiones}\n\nDependencias: ${dependencias}`;
}
