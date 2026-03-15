/**
 * Shared module-level pipeline store.
 * Module variables persist across client-side navigation in Next.js App Router,
 * so all pages share the same cached data instead of each maintaining their own.
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

// ── Shared state ──
let _pipelineCache: PipelineCache | null = null;
let _pipelineParams = "";
let _pipelineFetchTime = 0;

let _intelRows: PipelineRow[] | null = null;
let _intelMeta: { cacheAge: number; total: number } | null = null;
let _intelFetchTime = 0;

let _marketCache: { news: unknown[]; rates: unknown; newsFetchedAt: string; ratesFetchedAt: string } | null = null;
let _marketFetchTime = 0;

let _connectedStatus: boolean | null = null;

const STALE_MS = 60_000; // 60 seconds

// ── Pipeline page cache ──

export function getPipelineCache() {
  return { data: _pipelineCache, params: _pipelineParams, fetchTime: _pipelineFetchTime };
}

export function setPipelineCache(data: PipelineCache, params: string) {
  _pipelineCache = data;
  _pipelineParams = params;
  _pipelineFetchTime = Date.now();
}

export function isPipelineFresh(params: string): boolean {
  return _pipelineCache !== null && _pipelineParams === params && (Date.now() - _pipelineFetchTime) < STALE_MS;
}

// ── Intelligence page cache ──

export function getIntelCache() {
  return { rows: _intelRows, meta: _intelMeta, fetchTime: _intelFetchTime };
}

export function setIntelCache(rows: PipelineRow[], meta: { cacheAge: number; total: number }) {
  _intelRows = rows;
  _intelMeta = meta;
  _intelFetchTime = Date.now();
}

export function isIntelFresh(): boolean {
  return _intelRows !== null && (Date.now() - _intelFetchTime) < STALE_MS;
}

// ── Market page cache ──

export function getMarketCache() {
  return { data: _marketCache, fetchTime: _marketFetchTime };
}

export function setMarketCache(data: typeof _marketCache) {
  _marketCache = data;
  _marketFetchTime = Date.now();
}

export function isMarketFresh(): boolean {
  return _marketCache !== null && (Date.now() - _marketFetchTime) < STALE_MS;
}

// ── Connection status (shared across all pages) ──

export function getConnectedStatus(): boolean | null {
  return _connectedStatus;
}

export function setConnectedStatus(status: boolean) {
  _connectedStatus = status;
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
