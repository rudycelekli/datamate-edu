/**
 * MINEDUC Datos Abiertos API Client
 * REST API (Junar v2): http://api.datos.mineduc.cl/api/v2/
 * Docs: http://datos.mineduc.cl/developers/
 * Rate limit: 5 req/sec
 *
 * Key datasets:
 * - Matricula por establecimiento (enrollment by school)
 * - Directorio de establecimientos (school directory)
 * - SNED (school performance evaluation)
 * - Dotacion docente (teacher staffing)
 *
 * Join key: RBD (school code) — exists in our desafio schema tables
 */

const API_BASE = "http://api.datos.mineduc.cl/api/v2";
const RATE_LIMIT_MS = 220; // 5 req/sec = 200ms between requests + buffer

// Known datastream GUIDs (discovered from datos.mineduc.cl)
export const DATASTREAMS = {
  // Matricula (enrollment)
  MATRICULA_RESUMEN_ESTABLECIMIENTO: "MATRI-95445", // Summary by school
  MATRICULA_POR_ESTUDIANTE: "MATRI-POR-ESTUDIANTE", // Per student (large)

  // Establecimientos (school directory)
  DIRECTORIO_ESTABLECIMIENTOS: "DIREC-ESTAB", // School directory with RBD, sost_id, location

  // SNED (performance evaluation)
  SNED_BASE: "SNED-BASE", // SNED scores by school

  // Dotacion (teacher staffing)
  DOTACION_DOCENTE: "DOTAC-DOCENTE", // Teacher counts by school
} as const;

// These GUIDs may need updating — use the resource discovery endpoint to find correct ones
// GET /api/v2/resources.json?query=matricula&auth_key=KEY

let lastRequestTime = 0;

/** Rate-limited fetch */
async function rateLimitedFetch(url: string): Promise<Response> {
  const now = Date.now();
  const wait = RATE_LIMIT_MS - (now - lastRequestTime);
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastRequestTime = Date.now();
  return fetch(url);
}

/** Get the API key from environment */
function getApiKey(): string {
  const key = process.env.MINEDUC_API_KEY;
  if (!key) throw new Error("MINEDUC_API_KEY no configurada. Registrarse en http://datos.mineduc.cl/developers/");
  return key;
}

// ── API Methods ──

export interface MinedecResource {
  guid: string;
  title: string;
  description: string;
  category_name: string;
  endpoint: string;
  tags: string[];
  created_at: string;
  link: string;
}

/** Discover available datasets */
export async function discoverResources(query?: string, limit = 50): Promise<MinedecResource[]> {
  const key = getApiKey();
  const params = new URLSearchParams({ auth_key: key, limit: String(limit) });
  if (query) params.set("query", query);

  const res = await rateLimitedFetch(`${API_BASE}/resources.json?${params}`);
  if (!res.ok) throw new Error(`MINEDUC API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.resources || data || [];
}

/** Fetch a datastream as JSON array */
export async function fetchDatastream(guid: string, options?: {
  limit?: number;
  page?: number;
  filters?: Record<string, string>;
}): Promise<Record<string, unknown>[]> {
  const key = getApiKey();
  const params = new URLSearchParams({ auth_key: key });

  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.page) params.set("page", String(options.page));

  // Filters: filter0=column5[>]1900000&where=(filter0)
  if (options?.filters) {
    let filterIdx = 0;
    const filterNames: string[] = [];
    for (const [col, val] of Object.entries(options.filters)) {
      params.set(`filter${filterIdx}`, `${col}[==]${val}`);
      filterNames.push(`filter${filterIdx}`);
      filterIdx++;
    }
    if (filterNames.length > 0) {
      params.set("where", `(${filterNames.join(" and ")})`);
    }
  }

  const url = `${API_BASE}/datastreams/${guid}/data.pjson?${params}`;
  const res = await rateLimitedFetch(url);

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`MINEDUC API ${res.status} for ${guid}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();

  // pjson format returns array of objects with column headers
  if (Array.isArray(data.result)) {
    // First row is headers, rest is data
    const headers = data.result[0] as string[];
    return data.result.slice(1).map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      headers.forEach((h, i) => { obj[h] = row[i]; });
      return obj;
    });
  }

  // ajson format
  if (data.result && Array.isArray(data.result)) {
    return data.result;
  }

  return Array.isArray(data) ? data : [];
}

/** Fetch all pages of a datastream */
export async function fetchAllPages(guid: string, maxPages = 50): Promise<Record<string, unknown>[]> {
  const all: Record<string, unknown>[] = [];
  for (let page = 0; page < maxPages; page++) {
    const rows = await fetchDatastream(guid, { limit: 1000, page });
    if (rows.length === 0) break;
    all.push(...rows);
    if (rows.length < 1000) break;
  }
  return all;
}

// ── Data Transformation ──

export interface MatriculaRecord {
  rbd: string;
  periodo: string;
  nombre_establecimiento: string;
  matricula_total: number;
  matricula_basica: number;
  matricula_media: number;
  matricula_parvularia: number;
  region: string;
  comuna: string;
}

export interface SNEDRecord {
  rbd: string;
  periodo: string;
  puntaje_sned: number;
  clasificacion: string;
}

export interface DotacionRecord {
  rbd: string;
  periodo: string;
  total_docentes: number;
  horas_contrato_total: number;
  docentes_titulares: number;
  docentes_contrata: number;
}

export interface EstablecimientoRecord {
  rbd: string;
  sost_id: string;
  nombre: string;
  region: string;
  comuna: string;
  dependencia: string;
  ruralidad: string; // URBANO/RURAL
  latitud: number;
  longitud: number;
  estado: string;
}

/** Normalize matricula data from MINEDUC API response */
export function normalizeMatricula(raw: Record<string, unknown>[]): MatriculaRecord[] {
  return raw.map(r => ({
    rbd: String(r.RBD || r.rbd || r.COD_ENSE || ""),
    periodo: String(r.AGNO || r.agno || r.AÑO || r.periodo || ""),
    nombre_establecimiento: String(r.NOM_RBD || r.NOMBRE || r.nombre_establecimiento || ""),
    matricula_total: Number(r.MAT_TOTAL || r.TOTAL || r.matricula_total || 0),
    matricula_basica: Number(r.MAT_BASICA || r.BASICA || 0),
    matricula_media: Number(r.MAT_MEDIA || r.MEDIA || 0),
    matricula_parvularia: Number(r.MAT_PARVULARIA || r.PARVULARIA || 0),
    region: String(r.NOM_REG_RBD_A || r.REGION || r.region || ""),
    comuna: String(r.NOM_COM_RBD || r.COMUNA || r.comuna || ""),
  })).filter(r => r.rbd && r.periodo);
}

/** Normalize establecimientos data */
export function normalizeEstablecimientos(raw: Record<string, unknown>[]): EstablecimientoRecord[] {
  return raw.map(r => ({
    rbd: String(r.RBD || r.rbd || ""),
    sost_id: String(r.COD_DEPE2 || r.SOSTENEDOR || r.sost_id || ""),
    nombre: String(r.NOM_RBD || r.NOMBRE || ""),
    region: String(r.NOM_REG_RBD_A || r.REGION || ""),
    comuna: String(r.NOM_COM_RBD || r.COMUNA || ""),
    dependencia: String(r.COD_DEPE || r.DEPENDENCIA || ""),
    ruralidad: String(r.RURAL_RBD || r.RURALIDAD || ""),
    latitud: Number(r.LATITUD || 0),
    longitud: Number(r.LONGITUD || 0),
    estado: String(r.ESTADO_ESTAB || r.ESTADO || ""),
  })).filter(r => r.rbd);
}

/** Normalize SNED data */
export function normalizeSNED(raw: Record<string, unknown>[]): SNEDRecord[] {
  return raw.map(r => ({
    rbd: String(r.RBD || r.rbd || ""),
    periodo: String(r.AGNO || r.AÑO || r.periodo || ""),
    puntaje_sned: Number(r.PUNTAJE || r.PTJE_SNED || r.puntaje || 0),
    clasificacion: String(r.CLASIFICACION || r.GRUPO || ""),
  })).filter(r => r.rbd);
}

/** Normalize dotacion docente data */
export function normalizeDotacion(raw: Record<string, unknown>[]): DotacionRecord[] {
  return raw.map(r => ({
    rbd: String(r.RBD || r.rbd || ""),
    periodo: String(r.AGNO || r.AÑO || r.periodo || ""),
    total_docentes: Number(r.TOTAL_DOCENTES || r.N_DOCENTES || 0),
    horas_contrato_total: Number(r.HRS_CONTRATO || r.HORAS || 0),
    docentes_titulares: Number(r.TITULARES || 0),
    docentes_contrata: Number(r.CONTRATA || 0),
  })).filter(r => r.rbd);
}

// ── High-level sync functions ──

/** Sync matricula data to Supabase */
export async function syncMatricula(db: ReturnType<typeof import("@supabase/supabase-js").createClient>) {
  const raw = await fetchAllPages(DATASTREAMS.MATRICULA_RESUMEN_ESTABLECIMIENTO);
  const records = normalizeMatricula(raw);

  if (records.length === 0) return { synced: 0, error: "No records found" };

  // Upsert in batches
  let synced = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("mineduc_matricula").upsert(batch, { onConflict: "rbd,periodo" });
    if (error) throw new Error(`Matricula sync error: ${error.message}`);
    synced += batch.length;
  }

  return { synced, total: records.length };
}

/** Sync establecimientos directory to Supabase */
export async function syncEstablecimientos(db: ReturnType<typeof import("@supabase/supabase-js").createClient>) {
  const raw = await fetchAllPages(DATASTREAMS.DIRECTORIO_ESTABLECIMIENTOS);
  const records = normalizeEstablecimientos(raw);

  if (records.length === 0) return { synced: 0, error: "No records found" };

  let synced = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("mineduc_establecimientos").upsert(batch, { onConflict: "rbd" });
    if (error) throw new Error(`Establecimientos sync error: ${error.message}`);
    synced += batch.length;
  }

  return { synced, total: records.length };
}

/** Sync SNED scores to Supabase */
export async function syncSNED(db: ReturnType<typeof import("@supabase/supabase-js").createClient>) {
  const raw = await fetchAllPages(DATASTREAMS.SNED_BASE);
  const records = normalizeSNED(raw);

  if (records.length === 0) return { synced: 0, error: "No records found" };

  let synced = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("mineduc_sned").upsert(batch, { onConflict: "rbd,periodo" });
    if (error) throw new Error(`SNED sync error: ${error.message}`);
    synced += batch.length;
  }

  return { synced, total: records.length };
}

/** Sync dotacion docente to Supabase */
export async function syncDotacion(db: ReturnType<typeof import("@supabase/supabase-js").createClient>) {
  const raw = await fetchAllPages(DATASTREAMS.DOTACION_DOCENTE);
  const records = normalizeDotacion(raw);

  if (records.length === 0) return { synced: 0, error: "No records found" };

  let synced = 0;
  for (let i = 0; i < records.length; i += 500) {
    const batch = records.slice(i, i + 500);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).from("mineduc_dotacion").upsert(batch, { onConflict: "rbd,periodo" });
    if (error) throw new Error(`Dotacion sync error: ${error.message}`);
    synced += batch.length;
  }

  return { synced, total: records.length };
}
