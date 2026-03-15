/**
 * Shared pipeline store with sessionStorage persistence.
 * Module variables give instant reads; sessionStorage survives hot reloads
 * and hard refreshes within the browser session.
 */

interface PipelineRow {
  loanGuid: string;
  fields: Record<string, string>;
}

interface FilterOptions {
  milestones: string[];
  los: string[];
  states: string[];
  purposes: string[];
  locks: string[];
  programs: string[];
}

interface PipelineCache {
  rows: PipelineRow[];
  total: number;
  totalVolume: number;
  cacheAge: number;
  filterOptions: FilterOptions;
  _warming?: boolean;
  _loadedSoFar?: number;
}

interface CompactRow {
  guid: string;
  amt: number;
  prog: string;
  purp: string;
  ms: string;
  lo: string;
  lock: string;
  rate: number;
  st: string;
  dt: string;
  lien: string;
  ln: string;
  channel: string;
  closingDate: string;
  lockExp: string;
  modified: string;
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

// ── Shared state (module-level for speed, sessionStorage for persistence) ──

let _pipelineCache: PipelineCache | null = null;
let _pipelineParams = "";
let _pipelineFetchTime = 0;

let _intelRows: PipelineRow[] | null = null;
let _intelMeta: { cacheAge: number; total: number } | null = null;
let _intelFetchTime = 0;

let _marketCache: { news: unknown[]; rates: unknown; newsFetchedAt: string; ratesFetchedAt: string } | null = null;
let _marketFetchTime = 0;

let _connectedStatus: boolean | null = null;

const STALE_MS = 300_000; // 5 minutes

// ── Pipeline page cache ──

export function getPipelineCache() {
  // Restore from sessionStorage if module var was lost (hot reload)
  if (!_pipelineCache) {
    const stored = ssGet<{ data: PipelineCache; params: string; fetchTime: number }>("pl_cache");
    if (stored && stored.data && (Date.now() - stored.fetchTime) < STALE_MS) {
      _pipelineCache = stored.data;
      _pipelineParams = stored.params;
      _pipelineFetchTime = stored.fetchTime;
    }
  }
  return { data: _pipelineCache, params: _pipelineParams, fetchTime: _pipelineFetchTime };
}

export function setPipelineCache(data: PipelineCache, params: string) {
  _pipelineCache = data;
  _pipelineParams = params;
  _pipelineFetchTime = Date.now();
  ssSet("pl_cache", { data, params, fetchTime: _pipelineFetchTime });
}

export function isPipelineFresh(params: string): boolean {
  const cache = getPipelineCache(); // triggers restore if needed
  return cache.data !== null && _pipelineParams === params && (Date.now() - _pipelineFetchTime) < STALE_MS;
}

// ── Intelligence page cache ──

export function getIntelCache() {
  if (!_intelRows) {
    const stored = ssGet<{ rows: PipelineRow[]; meta: typeof _intelMeta; fetchTime: number }>("intel_cache");
    if (stored && stored.rows && (Date.now() - stored.fetchTime) < STALE_MS) {
      _intelRows = stored.rows;
      _intelMeta = stored.meta;
      _intelFetchTime = stored.fetchTime;
    }
  }
  return { rows: _intelRows, meta: _intelMeta, fetchTime: _intelFetchTime };
}

export function setIntelCache(rows: PipelineRow[], meta: { cacheAge: number; total: number }) {
  _intelRows = rows;
  _intelMeta = meta;
  _intelFetchTime = Date.now();
  ssSet("intel_cache", { rows, meta, fetchTime: _intelFetchTime });
}

export function isIntelFresh(): boolean {
  getIntelCache(); // triggers restore
  return _intelRows !== null && (Date.now() - _intelFetchTime) < STALE_MS;
}

// ── Market page cache ──

export function getMarketCache() {
  if (!_marketCache) {
    const stored = ssGet<{ data: typeof _marketCache; fetchTime: number }>("mkt_cache");
    if (stored && stored.data && (Date.now() - stored.fetchTime) < STALE_MS) {
      _marketCache = stored.data;
      _marketFetchTime = stored.fetchTime;
    }
  }
  return { data: _marketCache, fetchTime: _marketFetchTime };
}

export function setMarketCache(data: typeof _marketCache) {
  _marketCache = data;
  _marketFetchTime = Date.now();
  ssSet("mkt_cache", { data, fetchTime: _marketFetchTime });
}

export function isMarketFresh(): boolean {
  getMarketCache(); // triggers restore
  return _marketCache !== null && (Date.now() - _marketFetchTime) < STALE_MS;
}

// ── Global warming / pipeline status (visible across all tabs) ──

let _warmingStatus = false;
let _warmingLoadedSoFar = 0;
let _warmingCacheAge = 0;
let _warmingTotal = 0;

export function getWarmingStatus() {
  // Restore from sessionStorage if blank
  if (!_warmingTotal && !_pipelineCache) {
    const stored = ssGet<{ warming: boolean; loadedSoFar: number; cacheAge: number; total: number }>("warming_status");
    if (stored) {
      _warmingStatus = stored.warming;
      _warmingLoadedSoFar = stored.loadedSoFar;
      _warmingCacheAge = stored.cacheAge;
      _warmingTotal = stored.total;
    }
  }
  // Prefer pipeline cache if it has data
  if (_pipelineCache) {
    return {
      warming: !!_pipelineCache._warming,
      loadedSoFar: _pipelineCache._loadedSoFar || _warmingLoadedSoFar,
      cacheAge: _pipelineCache.cacheAge || _warmingCacheAge,
      total: _pipelineCache.total || _warmingTotal,
    };
  }
  return { warming: _warmingStatus, loadedSoFar: _warmingLoadedSoFar, cacheAge: _warmingCacheAge, total: _warmingTotal };
}

export function setWarmingStatus(warming: boolean, loadedSoFar: number, cacheAge?: number, total?: number) {
  _warmingStatus = warming;
  _warmingLoadedSoFar = loadedSoFar;
  if (cacheAge !== undefined) _warmingCacheAge = cacheAge;
  if (total !== undefined) _warmingTotal = total;
  ssSet("warming_status", { warming: _warmingStatus, loadedSoFar: _warmingLoadedSoFar, cacheAge: _warmingCacheAge, total: _warmingTotal });
}

// ── Connection status (shared across all pages) ──

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

// ── Pipeline summary for Milo / Market insights ──

export function getPipelineSummary(): string | null {
  // Use intel cache (full data) if available, else pipeline cache (partial)
  getIntelCache(); // triggers restore
  getPipelineCache(); // triggers restore
  const rows = _intelRows || _pipelineCache?.rows;
  if (!rows || rows.length === 0) return null;

  const total = _intelMeta?.total || _pipelineCache?.total || rows.length;
  const volume = rows.reduce((s, r) => s + (parseFloat(r.fields?.["Loan.LoanAmount"] || "0") || 0), 0);

  const stateCounts: Record<string, { count: number; volume: number }> = {};
  const milestoneCounts: Record<string, number> = {};
  const programCounts: Record<string, number> = {};

  rows.forEach(r => {
    const f = r.fields || {};
    const st = f["Loan.SubjectPropertyState"] || f["Fields.14"] || "";
    const ms = f["Loan.CurrentMilestoneName"] || "";
    const prog = f["Loan.LoanProgram"] || "";
    const amt = parseFloat(f["Loan.LoanAmount"] || "0") || 0;

    if (st) {
      if (!stateCounts[st]) stateCounts[st] = { count: 0, volume: 0 };
      stateCounts[st].count++;
      stateCounts[st].volume += amt;
    }
    if (ms) milestoneCounts[ms] = (milestoneCounts[ms] || 0) + 1;
    if (prog) programCounts[prog] = (programCounts[prog] || 0) + 1;
  });

  const topStates = Object.entries(stateCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 15)
    .map(([st, d]) => `${st}: ${d.count} loans ($${(d.volume / 1e6).toFixed(1)}M, ${((d.count / total) * 100).toFixed(1)}%)`)
    .join("\n");

  const milestones = Object.entries(milestoneCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([ms, cnt]) => `${ms}: ${cnt}`)
    .join(", ");

  const programs = Object.entries(programCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([p, cnt]) => `${p}: ${cnt}`)
    .join(", ");

  return `Current Pipeline Summary (${total} loans, $${(volume / 1e6).toFixed(1)}M total volume):\n\nTop States:\n${topStates}\n\nMilestones: ${milestones}\n\nPrograms: ${programs}`;
}

/** State breakdown for Market page insights */
export function getPipelineStateBreakdown(): Array<{ state: string; count: number; volume: number; pct: number }> | null {
  getIntelCache(); // triggers restore
  getPipelineCache(); // triggers restore
  const rows = _intelRows || _pipelineCache?.rows;
  if (!rows || rows.length === 0) return null;

  const total = rows.length;
  const stateCounts: Record<string, { count: number; volume: number }> = {};

  rows.forEach(r => {
    const f = r.fields || {};
    const st = f["Loan.SubjectPropertyState"] || f["Fields.14"] || "";
    const amt = parseFloat(f["Loan.LoanAmount"] || "0") || 0;
    if (st) {
      if (!stateCounts[st]) stateCounts[st] = { count: 0, volume: 0 };
      stateCounts[st].count++;
      stateCounts[st].volume += amt;
    }
  });

  return Object.entries(stateCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([state, d]) => ({ state, count: d.count, volume: d.volume, pct: (d.count / total) * 100 }));
}

// ── Compact row helper (shared between pipeline and intel) ──

export function compactToPipelineRow(c: CompactRow): PipelineRow {
  return {
    loanGuid: c.guid,
    fields: {
      "Loan.LoanNumber": c.ln,
      "Loan.LoanAmount": String(c.amt),
      "Loan.LoanProgram": c.prog,
      "Loan.LoanPurpose": c.purp,
      "Loan.CurrentMilestoneName": c.ms,
      "Loan.LoanOfficerName": c.lo,
      "Loan.LockStatus": c.lock,
      "Loan.NoteRatePercent": String(c.rate),
      "Loan.SubjectPropertyState": c.st,
      "Fields.14": c.st,
      "Loan.DateCreated": c.dt,
      "Loan.LienPosition": c.lien,
      "Loan.Channel": c.channel,
      "Loan.ClosingDate": c.closingDate,
      "Fields.748": c.closingDate,
      "Loan.LockExpirationDate": c.lockExp,
      "Loan.LastModified": c.modified,
    },
  };
}
