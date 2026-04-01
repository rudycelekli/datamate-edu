/**
 * Desafio schema query layer for Chilean education spending data.
 *
 * Actual column names (verified against live DB):
 *
 * estado_resultado: desc_tipo_cuenta, cuenta_alias, desc_cuenta, cuenta_alias_padre,
 *   desc_cuenta_padre, monto_declarado, periodo, subvencion_alias, sost_id, rbd,
 *   region_rbd, dependencia_rbd, desc_estado
 *
 * documentos: id_registro, periodo, sost_id, rut_sost, nombre_sost, rbd, nombre_rbd,
 *   region_rbd, dependencia_rbd, subvencion_alias, desc_libro, tipo_docs_alias,
 *   cuenta_alias, desc_cuenta, desc_cuenta_padre, cuenta_alias_padre,
 *   numero_documento, nombre_documento, detalle_documento, fecha_documento,
 *   monto_total, monto_declarado, fecha_pago_documento, rut_documento
 *
 * remuneraciones_2020: rut, periodo, sostenedor, rbd, dgv, tip, hc, fei, fun,
 *   mes, anio, habernorend, totalhaber, ..., totaldescuento, liquido,
 *   subvencion_alias, cuenta_alias, monto
 */

import { getDesafioClient } from "./supabase";

// ── Types ──

export interface EstadoResultadoRow {
  sost_id: string;
  periodo: string;
  desc_tipo_cuenta: string;
  cuenta_alias: string;
  desc_cuenta: string;
  cuenta_alias_padre: string;
  desc_cuenta_padre: string;
  monto_declarado: string | number;
  subvencion_alias: string;
  rbd: string;
  region_rbd: string;
  dependencia_rbd: string;
  desc_estado: string;
  [key: string]: unknown;
}

export interface DocumentoRow {
  id_registro: number;
  sost_id: string;
  nombre_sost: string;
  rut_sost: string;
  rbd: string;
  nombre_rbd: string;
  tipo_docs_alias: string;
  monto_total: string | number;
  monto_declarado: string | number;
  fecha_documento: string;
  periodo: string;
  region_rbd: string;
  dependencia_rbd: string;
  subvencion_alias: string;
  desc_cuenta: string;
  nombre_documento: string;
  detalle_documento: string;
  [key: string]: unknown;
}

export interface RemuneracionRow {
  rut: string;
  periodo: string;
  sostenedor: string;
  rbd: string;
  totalhaber: string | number;
  totaldescuento: string | number;
  liquido: string | number;
  monto: string | number;
  subvencion_alias: string;
  cuenta_alias: string;
  [key: string]: unknown;
}

export interface FilterOptions {
  regiones: string[];
  dependencias: string[];
  periodos: string[];
  subvenciones: string[];
  cuentas: string[];
}

export interface SostenedorSummary {
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

export interface DashboardStats {
  totalSostenedores: number;
  totalMonto: number;
  totalEstablecimientos: number;
  totalPeriodos: number;
  lastRefresh: string | null;
}

export interface RiskFlag {
  indicator: string;
  value: number;
  threshold: string;
  level: "CRITICAL" | "ALERT" | "OK";
  detail: string;
}

export interface FlaggedSostenedor {
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

export interface RiskFlagsResult {
  flaggedSostenedores: FlaggedSostenedor[];
  totalFlagged: number;
  criticalCount: number;
  alertCount: number;
  avgRiskScore: number;
}

export interface SostenedorQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortField?: string;
  sortDir?: "asc" | "desc";
  region?: string;
  dependencia?: string;
  periodo?: string;
  subvencion?: string;
}

export interface SostenedorQueryResult {
  rows: SostenedorSummary[];
  total: number;
  totalMonto: number;
  page: number;
  pageSize: number;
  filterOptions: FilterOptions;
}

// ── Helpers ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseQuery = any;

function applyFilters(
  q: SupabaseQuery,
  params: { region?: string; dependencia?: string; periodo?: string; subvencion?: string; search?: string },
): SupabaseQuery {
  if (params.region) q = q.eq("region_rbd", params.region);
  if (params.dependencia) q = q.eq("dependencia_rbd", params.dependencia);
  if (params.periodo) q = q.eq("periodo", params.periodo);
  if (params.subvencion) q = q.eq("subvencion_alias", params.subvencion);
  if (params.search) {
    q = q.ilike("sost_id", `%${params.search}%`);
  }
  return q;
}

/** Paginated fetch helper — fetches up to maxRows to cover the full dataset */
async function fetchPaginated(
  buildQuery: () => SupabaseQuery,
  maxRows = 50000,
): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  let offset = 0;
  const pageSize = 1000;
  while (all.length < maxRows) {
    const { data, error } = await buildQuery().range(offset, offset + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    offset += pageSize;
    if (data.length < pageSize) break;
  }
  return all;
}

// ── Filter options cache ──
let _filterCache: { options: FilterOptions; ts: number } | null = null;
const FILTER_CACHE_TTL = 60_000; // 1 minute

// ── Query Functions ──

/** Lookup sostenedor names and RUTs from documentos table */
async function getSostenedorInfo(sostIds: string[]): Promise<Map<string, { nombre: string; rut: string }>> {
  if (sostIds.length === 0) return new Map();
  const db = getDesafioClient();
  const { data } = await db
    .from("documentos")
    .select("sost_id, nombre_sost, rut_sost")
    .in("sost_id", sostIds)
    .limit(500);
  const infoMap = new Map<string, { nombre: string; rut: string }>();
  if (data) {
    for (const row of data) {
      if (!infoMap.has(row.sost_id)) {
        infoMap.set(row.sost_id, {
          nombre: row.nombre_sost || "",
          rut: row.rut_sost || "",
        });
      }
    }
  }
  return infoMap;
}

/** List sostenedores with aggregated metrics from estado_resultado */
export async function querySostenedores(params: SostenedorQueryParams): Promise<SostenedorQueryResult> {
  const db = getDesafioClient();
  const page = params.page ?? 0;
  const pageSize = params.pageSize ?? 50;

  // Fetch all columns with filters
  const rows = await fetchPaginated(
    () => {
      let q = db.from("estado_resultado").select("sost_id, periodo, region_rbd, dependencia_rbd, desc_tipo_cuenta, monto_declarado, cuenta_alias, desc_cuenta, cuenta_alias_padre, desc_cuenta_padre, subvencion_alias, rbd, desc_estado");
      q = applyFilters(q, params);
      return q;
    },
    50000,
  ) as EstadoResultadoRow[];

  // Aggregate into sostenedor summaries (group by sost_id + periodo)
  const sostenedorMap = new Map<string, SostenedorSummary & { _rbds: Set<string>; _subvenciones: Set<string>; _cuentas: Set<string>; _estados: Map<string, number>; _adminGasto: number }>();
  for (const row of rows) {
    const key = `${row.sost_id}-${row.periodo}`;
    if (!sostenedorMap.has(key)) {
      sostenedorMap.set(key, {
        sost_id: row.sost_id,
        sost_nombre: "",
        rut_sost: "",
        region_rbd: String(row.region_rbd || ""),
        dependencia_rbd: String(row.dependencia_rbd || ""),
        total_ingresos: 0,
        total_gastos: 0,
        balance: 0,
        periodo: String(row.periodo || ""),
        rbd_count: 0,
        subvencion_aliases: "",
        desc_estado: "",
        cuenta_categories: 0,
        admin_ratio: 0,
        _rbds: new Set(),
        _subvenciones: new Set(),
        _cuentas: new Set(),
        _estados: new Map(),
        _adminGasto: 0,
      });
    }
    const s = sostenedorMap.get(key)!;
    const monto = Number(row.monto_declarado) || 0;
    const tipo = String(row.desc_tipo_cuenta || "").toLowerCase();
    if (tipo.includes("ingreso")) {
      s.total_ingresos += monto;
    } else {
      s.total_gastos += monto;
      const cuentaAlias = String(row.cuenta_alias || "");
      const cuentaPadre = String(row.cuenta_alias_padre || "");
      if (cuentaAlias.startsWith("420") || cuentaPadre.startsWith("420")) {
        s._adminGasto += monto;
      }
    }
    if (row.rbd) s._rbds.add(String(row.rbd));
    if (row.subvencion_alias) s._subvenciones.add(String(row.subvencion_alias));
    if (row.desc_cuenta_padre) s._cuentas.add(String(row.desc_cuenta_padre));
    if (row.desc_estado) {
      const estado = String(row.desc_estado);
      s._estados.set(estado, (s._estados.get(estado) || 0) + 1);
    }
  }

  // Finalize aggregated fields
  let allSummaries: SostenedorSummary[] = Array.from(sostenedorMap.values()).map(s => {
    const balance = s.total_ingresos - s.total_gastos;
    const adminRatio = s.total_gastos > 0 ? Number(((s._adminGasto / s.total_gastos) * 100).toFixed(1)) : 0;
    let topEstado = "";
    let topEstadoCount = 0;
    for (const [estado, count] of s._estados) {
      if (count > topEstadoCount) { topEstado = estado; topEstadoCount = count; }
    }
    return {
      sost_id: s.sost_id,
      sost_nombre: s.sost_nombre,
      rut_sost: s.rut_sost,
      region_rbd: s.region_rbd,
      dependencia_rbd: s.dependencia_rbd,
      total_ingresos: s.total_ingresos,
      total_gastos: s.total_gastos,
      balance,
      periodo: s.periodo,
      rbd_count: s._rbds.size,
      subvencion_aliases: [...s._subvenciones].sort().join(", "),
      desc_estado: topEstado,
      cuenta_categories: s._cuentas.size,
      admin_ratio: adminRatio,
    };
  });

  // Sort by sost_id (client-side to avoid ORDER BY timeouts on large tables)
  allSummaries.sort((a, b) => a.sost_id.localeCompare(b.sost_id));

  // Lookup names and RUTs from documentos table
  const uniqueIds = [...new Set(allSummaries.map(s => s.sost_id))];
  const infoMap = await getSostenedorInfo(uniqueIds);
  for (const s of allSummaries) {
    const info = infoMap.get(s.sost_id);
    s.sost_nombre = info?.nombre || "";
    s.rut_sost = info?.rut || "";
  }

  // If search includes non-numeric text, also filter by name
  if (params.search && !/^\d+$/.test(params.search)) {
    const searchLower = params.search.toLowerCase();
    allSummaries = allSummaries.filter(s =>
      s.sost_id.toLowerCase().includes(searchLower) ||
      s.sost_nombre.toLowerCase().includes(searchLower)
    );
  }

  // Paginate
  const total = allSummaries.length;
  const paginated = allSummaries.slice(page * pageSize, (page + 1) * pageSize);
  const totalMonto = allSummaries.reduce((s, r) => s + r.total_ingresos + r.total_gastos, 0);

  return {
    rows: paginated,
    total,
    totalMonto,
    page,
    pageSize,
    filterOptions: await getFilterOptions(),
  };
}

/** Get estado_resultado rows with filters */
export async function getEstadoResultado(params: {
  region?: string;
  dependencia?: string;
  periodo?: string;
  subvencion?: string;
  search?: string;
  limit?: number;
}): Promise<EstadoResultadoRow[]> {
  const db = getDesafioClient();
  let query = db.from("estado_resultado").select("*");
  query = applyFilters(query, params);
  query = query.limit(params.limit || 1000);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as EstadoResultadoRow[];
}

/** Get documentos rows with filters */
export async function getDocumentos(params: {
  sost_id?: string;
  periodo?: string;
  tipo_documento?: string;
  limit?: number;
}): Promise<DocumentoRow[]> {
  const db = getDesafioClient();
  let query = db.from("documentos").select("*");
  if (params.sost_id) query = query.eq("sost_id", params.sost_id);
  if (params.periodo) query = query.eq("periodo", params.periodo);
  if (params.tipo_documento) query = query.eq("tipo_docs_alias", params.tipo_documento);
  query = query.limit(params.limit || 1000);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as DocumentoRow[];
}

/** Get remuneraciones by year */
export async function getRemuneraciones(year: number, params?: {
  sost_id?: string;
  limit?: number;
}): Promise<RemuneracionRow[]> {
  const db = getDesafioClient();
  const table = `remuneraciones_${year}`;
  let query = db.from(table).select("*");
  if (params?.sost_id) query = query.eq("sostenedor", params.sost_id);
  query = query.limit(params?.limit || 1000);

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []) as RemuneracionRow[];
}

/** Dashboard stats - uses light queries to avoid timeouts */
export async function getDashboardStats(): Promise<DashboardStats> {
  const db = getDesafioClient();

  // Fetch all rows to compute accurate unique counts
  const rows = await fetchPaginated(
    () => db.from("estado_resultado").select("sost_id, rbd, periodo, monto_declarado"),
    50000,
  ) as { sost_id: string; rbd: string; periodo: string; monto_declarado: string | number }[];

  const uniqueSost = new Set<string>();
  const uniqueRbd = new Set<string>();
  const uniquePeriodos = new Set<string>();
  let totalMonto = 0;

  for (const r of rows) {
    if (r.sost_id) uniqueSost.add(r.sost_id);
    if (r.rbd) uniqueRbd.add(r.rbd);
    if (r.periodo) uniquePeriodos.add(r.periodo);
    totalMonto += Number(r.monto_declarado) || 0;
  }

  return {
    totalSostenedores: uniqueSost.size,
    totalMonto,
    totalEstablecimientos: uniqueRbd.size,
    totalPeriodos: uniquePeriodos.size,
    lastRefresh: new Date().toISOString(),
  };
}

/** Get filter options from estado_resultado (cached for 1 minute) */
export async function getFilterOptions(): Promise<FilterOptions> {
  if (_filterCache && Date.now() - _filterCache.ts < FILTER_CACHE_TTL) {
    return _filterCache.options;
  }

  const db = getDesafioClient();

  // Fetch all rows to extract distinct values
  const rows = await fetchPaginated(
    () => db.from("estado_resultado").select("region_rbd, dependencia_rbd, periodo, subvencion_alias, desc_cuenta_padre"),
    50000,
  );

  const regiones = new Set<string>();
  const dependencias = new Set<string>();
  const periodos = new Set<string>();
  const subvenciones = new Set<string>();
  const cuentas = new Set<string>();

  for (const r of rows) {
    if (r.region_rbd) regiones.add(String(r.region_rbd));
    if (r.dependencia_rbd) dependencias.add(String(r.dependencia_rbd));
    if (r.periodo) periodos.add(String(r.periodo));
    if (r.subvencion_alias) subvenciones.add(String(r.subvencion_alias));
    if (r.desc_cuenta_padre) cuentas.add(String(r.desc_cuenta_padre));
  }

  const options: FilterOptions = {
    regiones: [...regiones].sort(),
    dependencias: [...dependencias].sort(),
    periodos: [...periodos].sort(),
    subvenciones: [...subvenciones].sort(),
    cuentas: [...cuentas].sort(),
  };

  _filterCache = { options, ts: Date.now() };
  return options;
}

/** Compute per-sostenedor risk flags from financial indicators */
export async function getRiskFlags(params: {
  region?: string;
  dependencia?: string;
  periodo?: string;
  subvencion?: string;
}): Promise<RiskFlagsResult> {
  const db = getDesafioClient();

  // 1. Fetch all estado_resultado rows with filters
  const rows = await fetchPaginated(
    () => {
      let q = db.from("estado_resultado").select(
        "sost_id, periodo, region_rbd, dependencia_rbd, desc_tipo_cuenta, cuenta_alias, cuenta_alias_padre, monto_declarado"
      );
      q = applyFilters(q, params);
      return q;
    },
    50000,
  ) as EstadoResultadoRow[];

  // 2. Group by sost_id
  const sostMap = new Map<string, {
    region: string;
    dependencia: string;
    totalIngresos: number;
    totalGastos: number;
    adminGasto: number;
  }>();

  for (const row of rows) {
    const sid = row.sost_id;
    if (!sostMap.has(sid)) {
      sostMap.set(sid, {
        region: String(row.region_rbd || ""),
        dependencia: String(row.dependencia_rbd || ""),
        totalIngresos: 0,
        totalGastos: 0,
        adminGasto: 0,
      });
    }
    const s = sostMap.get(sid)!;
    const monto = Number(row.monto_declarado) || 0;
    const tipo = String(row.desc_tipo_cuenta || "").toLowerCase();

    if (tipo.includes("ingreso")) {
      s.totalIngresos += monto;
    } else {
      s.totalGastos += monto;
      // Admin gasto: cuenta_alias starting with "420" or cuenta_alias_padre starting with "420"
      const cuentaAlias = String(row.cuenta_alias || "");
      const cuentaPadre = String(row.cuenta_alias_padre || "");
      if (cuentaAlias.startsWith("420") || cuentaPadre.startsWith("420")) {
        s.adminGasto += monto;
      }
    }
  }

  // 3. Attempt to get remuneraciones totals per sostenedor
  const remunBySost = new Map<string, number>();
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 2020; y--) {
    try {
      const remunRows = await fetchPaginated(() => {
        let q = db.from(`remuneraciones_${y}`).select("sostenedor, totalhaber");
        if (params.subvencion) q = q.eq("subvencion_alias", params.subvencion);
        return q;
      }, 50000);
      if (remunRows.length > 0) {
        for (const r of remunRows) {
          const sid = String(r.sostenedor || "");
          if (!sid) continue;
          remunBySost.set(sid, (remunBySost.get(sid) || 0) + (Number(r.totalhaber) || 0));
        }
        break; // Use the most recent year with data
      }
    } catch { /* table may not exist */ }
  }

  // 4. Compute risk scores
  const allFlagged: FlaggedSostenedor[] = [];

  for (const [sostId, data] of sostMap) {
    const flags: RiskFlag[] = [];
    let weightedScore = 0;

    // Indicator #4: Admin Concentration (weight: 40%)
    const adminRatio = data.totalGastos > 0 ? (data.adminGasto / data.totalGastos) * 100 : 0;
    if (adminRatio > 50) {
      flags.push({ indicator: "#4 Concentracion Administrativa", value: adminRatio, threshold: ">50%", level: "CRITICAL", detail: `Gasto admin es ${adminRatio.toFixed(1)}% del total` });
      weightedScore += 40 * 1.0;
    } else if (adminRatio > 35) {
      flags.push({ indicator: "#4 Concentracion Administrativa", value: adminRatio, threshold: ">35%", level: "ALERT", detail: `Gasto admin es ${adminRatio.toFixed(1)}% del total` });
      weightedScore += 40 * 0.6;
    }

    // Indicator #9: Payroll Ratio (weight: 35%)
    const remunTotal = remunBySost.get(sostId) || 0;
    const ingresoDepurado = data.totalIngresos;
    const payrollRatio = ingresoDepurado > 0 ? (remunTotal / ingresoDepurado) * 100 : 0;
    if (payrollRatio > 95) {
      flags.push({ indicator: "#9 Gasto Remuneracional", value: payrollRatio, threshold: ">95%", level: "CRITICAL", detail: `Remuneraciones son ${payrollRatio.toFixed(1)}% del ingreso depurado` });
      weightedScore += 35 * 1.0;
    } else if (payrollRatio > 80) {
      flags.push({ indicator: "#9 Gasto Remuneracional", value: payrollRatio, threshold: ">80%", level: "ALERT", detail: `Remuneraciones son ${payrollRatio.toFixed(1)}% del ingreso depurado` });
      weightedScore += 35 * 0.6;
    }

    // Balance indicator (weight: 25%)
    const balance = data.totalIngresos - data.totalGastos;
    const deficitRatio = data.totalIngresos > 0 ? (balance / data.totalIngresos) * 100 : 0;
    if (deficitRatio < -20) {
      flags.push({ indicator: "Balance Deficitario", value: deficitRatio, threshold: ">20% deficit", level: "CRITICAL", detail: `Deficit de ${Math.abs(deficitRatio).toFixed(1)}% sobre ingresos` });
      weightedScore += 25 * 1.0;
    } else if (balance < 0) {
      flags.push({ indicator: "Balance Deficitario", value: deficitRatio, threshold: "deficit", level: "ALERT", detail: `Deficit de ${Math.abs(deficitRatio).toFixed(1)}% sobre ingresos` });
      weightedScore += 25 * 0.6;
    }

    const riskScore = Math.min(100, Math.round(weightedScore));
    const riskLevel: "CRITICAL" | "ALERT" | "OK" = riskScore > 70 ? "CRITICAL" : riskScore > 40 ? "ALERT" : "OK";

    if (flags.length > 0) {
      allFlagged.push({
        sostId,
        region: data.region,
        dependencia: data.dependencia,
        totalIngresos: data.totalIngresos,
        totalGastos: data.totalGastos,
        balance,
        adminRatio: Number(adminRatio.toFixed(1)),
        payrollRatio: Number(payrollRatio.toFixed(1)),
        riskScore,
        riskLevel,
        flags,
      });
    }
  }

  // Sort by risk score descending
  allFlagged.sort((a, b) => b.riskScore - a.riskScore);

  const criticalCount = allFlagged.filter(s => s.riskLevel === "CRITICAL").length;
  const alertCount = allFlagged.filter(s => s.riskLevel === "ALERT").length;
  const avgRiskScore = allFlagged.length > 0
    ? Math.round(allFlagged.reduce((sum, s) => sum + s.riskScore, 0) / allFlagged.length)
    : 0;

  return {
    flaggedSostenedores: allFlagged,
    totalFlagged: allFlagged.length,
    criticalCount,
    alertCount,
    avgRiskScore,
  };
}

/** Pre-aggregated data context for AI — queries ALL tables for comprehensive analysis */
export async function getAIContext(
  question: string,
  filters?: Record<string, string>,
): Promise<{ stats: Record<string, unknown>; totalRows: number }> {
  const db = getDesafioClient();

  // ── 1. Estado de Resultado (full dataset) ──
  const erRows = await fetchPaginated(() => {
    let q = db.from("estado_resultado").select("sost_id, periodo, region_rbd, dependencia_rbd, desc_tipo_cuenta, desc_cuenta_padre, desc_cuenta, cuenta_alias, subvencion_alias, monto_declarado");
    if (filters?.region) q = q.eq("region_rbd", filters.region);
    if (filters?.dependencia) q = q.eq("dependencia_rbd", filters.dependencia);
    if (filters?.periodo) q = q.eq("periodo", filters.periodo);
    if (filters?.subvencion) q = q.eq("subvencion_alias", filters.subvencion);
    return q;
  }, 50000) as EstadoResultadoRow[];

  // ── 2. Documentos summary ──
  let docRows: DocumentoRow[] = [];
  try {
    docRows = await fetchPaginated(() => {
      let q = db.from("documentos").select("sost_id, periodo, region_rbd, dependencia_rbd, tipo_docs_alias, monto_declarado, monto_total, subvencion_alias, cuenta_alias");
      if (filters?.region) q = q.eq("region_rbd", filters.region);
      if (filters?.dependencia) q = q.eq("dependencia_rbd", filters.dependencia);
      if (filters?.periodo) q = q.eq("periodo", filters.periodo);
      if (filters?.subvencion) q = q.eq("subvencion_alias", filters.subvencion);
      return q;
    }, 50000) as DocumentoRow[];
  } catch { /* table may be empty */ }

  // ── 3. Remuneraciones summary (latest year available) ──
  let remunRows: RemuneracionRow[] = [];
  const currentYear = new Date().getFullYear();
  for (let y = currentYear; y >= 2020; y--) {
    try {
      remunRows = await fetchPaginated(() => {
        let q = db.from(`remuneraciones_${y}`).select("sostenedor, rbd, periodo, totalhaber, totaldescuento, liquido, monto, subvencion_alias, cuenta_alias");
        if (filters?.subvencion) q = q.eq("subvencion_alias", filters.subvencion);
        return q;
      }, 50000) as RemuneracionRow[];
      if (remunRows.length > 0) break;
    } catch { /* table may not exist or be empty */ }
  }

  // ── Aggregate estado_resultado ──
  const byRegion: Record<string, { count: number; monto: number }> = {};
  const byDependencia: Record<string, { count: number; monto: number }> = {};
  const byPeriodo: Record<string, { count: number; monto: number }> = {};
  const byCuenta: Record<string, { count: number; monto: number }> = {};
  const bySubvencion: Record<string, { count: number; monto: number }> = {};
  const byTipoCuenta: Record<string, { count: number; monto: number }> = {};
  let totalMonto = 0;
  let totalIngresos = 0;
  let totalGastos = 0;

  for (const r of erRows) {
    const monto = Number(r.monto_declarado) || 0;
    totalMonto += monto;

    const tipo = String(r.desc_tipo_cuenta || "").toLowerCase();
    if (tipo.includes("ingreso")) totalIngresos += monto;
    else totalGastos += monto;

    const tipoKey = String(r.desc_tipo_cuenta || "Sin tipo");
    if (!byTipoCuenta[tipoKey]) byTipoCuenta[tipoKey] = { count: 0, monto: 0 };
    byTipoCuenta[tipoKey].count++;
    byTipoCuenta[tipoKey].monto += monto;

    const region = String(r.region_rbd || "Sin region");
    if (!byRegion[region]) byRegion[region] = { count: 0, monto: 0 };
    byRegion[region].count++;
    byRegion[region].monto += monto;

    const dep = String(r.dependencia_rbd || "Sin dependencia");
    if (!byDependencia[dep]) byDependencia[dep] = { count: 0, monto: 0 };
    byDependencia[dep].count++;
    byDependencia[dep].monto += monto;

    const periodo = String(r.periodo || "Sin periodo");
    if (!byPeriodo[periodo]) byPeriodo[periodo] = { count: 0, monto: 0 };
    byPeriodo[periodo].count++;
    byPeriodo[periodo].monto += monto;

    const cuenta = String(r.desc_cuenta_padre || r.desc_cuenta || "Sin cuenta");
    if (!byCuenta[cuenta]) byCuenta[cuenta] = { count: 0, monto: 0 };
    byCuenta[cuenta].count++;
    byCuenta[cuenta].monto += monto;

    const subv = String(r.subvencion_alias || "Sin subvencion");
    if (!bySubvencion[subv]) bySubvencion[subv] = { count: 0, monto: 0 };
    bySubvencion[subv].count++;
    bySubvencion[subv].monto += monto;
  }

  // ── Aggregate documentos ──
  const byTipoDocumento: Record<string, { count: number; monto: number }> = {};
  let totalDocMonto = 0;
  for (const d of docRows) {
    const monto = Number(d.monto_declarado) || 0;
    totalDocMonto += monto;
    const tipo = String(d.tipo_docs_alias || "Sin tipo");
    if (!byTipoDocumento[tipo]) byTipoDocumento[tipo] = { count: 0, monto: 0 };
    byTipoDocumento[tipo].count++;
    byTipoDocumento[tipo].monto += monto;
  }

  // ── Aggregate remuneraciones ──
  let totalHaber = 0;
  let totalDescuento = 0;
  let totalLiquido = 0;
  let remunCount = 0;
  for (const r of remunRows) {
    totalHaber += Number(r.totalhaber) || 0;
    totalDescuento += Number(r.totaldescuento) || 0;
    totalLiquido += Number(r.liquido) || 0;
    remunCount++;
  }

  return {
    stats: {
      totalRows: erRows.length,
      totalMonto,
      totalIngresos,
      totalGastos,
      byRegion,
      byDependencia,
      byPeriodo,
      byCuenta,
      bySubvencion,
      byTipoCuenta,
      documentos: {
        totalRows: docRows.length,
        totalMonto: totalDocMonto,
        byTipoDocumento,
      },
      remuneraciones: {
        totalRows: remunCount,
        totalHaber,
        totalDescuento,
        totalLiquido,
        promedioLiquido: remunCount > 0 ? Math.round(totalLiquido / remunCount) : 0,
        proporcionRemuneracionesSobreGasto: totalGastos > 0 ? Number(((totalHaber / totalGastos) * 100).toFixed(1)) : 0,
      },
    },
    totalRows: erRows.length + docRows.length + remunCount,
  };
}
