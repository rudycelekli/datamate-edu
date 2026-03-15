import { searchPipeline, searchPipelineWithFilters, PIPELINE_FIELDS } from "./encompass";

// ── Types ──

export interface PipelineRow {
  loanGuid: string;
  fields: Record<string, string>;
}

/** Compact row for analytics — NO PII (no names, addresses) */
export interface CompactRow {
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

export interface FilterOptions {
  milestones: string[];
  los: string[];
  states: string[];
  purposes: string[];
  locks: string[];
  programs: string[];
}

export interface PipelineQueryParams {
  page?: number;
  pageSize?: number;
  search?: string;
  sortField?: string;
  sortDir?: "asc" | "desc";
  milestone?: string;
  lo?: string;
  state?: string;
  purpose?: string;
  lock?: string;
  program?: string;
  amountMin?: number;
  amountMax?: number;
  rateMin?: number;
  rateMax?: number;
  dateFrom?: string;
  dateTo?: string;
}

export interface PipelineQueryResult {
  rows: PipelineRow[];
  total: number;
  totalVolume: number;
  page: number;
  pageSize: number;
  cacheAge: number;
  filterOptions: FilterOptions;
}

export interface CacheStatus {
  state: string;
  totalRows: number;
  loadedSoFar: number;
  lastRefresh: string | null;
  refreshDurationMs: number;
  nextRefresh: string | null;
  errorMessage: string | null;
}

interface AIContextStats {
  totalLoans: number;
  totalVolume: number;
  byMilestone: Record<string, { units: number; volume: number }>;
  byState: Record<string, { units: number; volume: number }>;
  byProgram: Record<string, { units: number; volume: number }>;
  byPurpose: Record<string, { units: number; volume: number }>;
  byLO: Record<string, { units: number; volume: number }>;
  byLock: Record<string, number>;
  avgRate: number;
  rateDistribution: Record<string, number>;
}

// ── Helper: read pipeline field ──

const pf = (f: Record<string, string>, canonical: string, fieldId?: string) =>
  f[canonical] || (fieldId ? f[`Fields.${fieldId}`] : "") || "";

// ── Singleton Cache ──

const REFRESH_INTERVAL = 5 * 60 * 1000; // 5 minutes
const BATCH_SIZE = 500;

let fullRows: PipelineRow[] = [];
let compactRows: CompactRow[] = [];
let filterOptions: FilterOptions = { milestones: [], los: [], states: [], purposes: [], locks: [], programs: [] };
let cacheState: string = "cold";
let lastRefreshTime: Date | null = null;
let refreshDurationMs = 0;
let errorMessage: string | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;
let warmupPromise: Promise<void> | null = null;
let warmupLoadedSoFar = 0;

// ── Build compact row from full row ──

function toCompact(row: PipelineRow): CompactRow {
  const f = row.fields || {};
  return {
    guid: row.loanGuid,
    amt: parseFloat(f["Loan.LoanAmount"] || "0") || 0,
    prog: f["Loan.LoanProgram"] || "",
    purp: f["Loan.LoanPurpose"] || "",
    ms: f["Loan.CurrentMilestoneName"] || "",
    lo: f["Loan.LoanOfficerName"] || "",
    lock: f["Loan.LockStatus"] || "",
    rate: parseFloat(pf(f, "Loan.NoteRatePercent", "3") || "0") || 0,
    st: pf(f, "Loan.SubjectPropertyState", "14"),
    dt: f["Loan.DateCreated"] || "",
    lien: f["Loan.LienPosition"] || "",
    ln: f["Loan.LoanNumber"] || "",
    channel: f["Loan.Channel"] || "",
    closingDate: pf(f, "Loan.ClosingDate", "748"),
    lockExp: f["Loan.LockExpirationDate"] || "",
    modified: f["Loan.LastModified"] || "",
  };
}

// ── Build filter options from all rows ──

function buildFilterOptions(rows: PipelineRow[]): FilterOptions {
  const milestones = new Set<string>();
  const los = new Set<string>();
  const states = new Set<string>();
  const purposes = new Set<string>();
  const locks = new Set<string>();
  const programs = new Set<string>();

  for (const r of rows) {
    const f = r.fields || {};
    if (f["Loan.CurrentMilestoneName"]) milestones.add(f["Loan.CurrentMilestoneName"]);
    if (f["Loan.LoanOfficerName"]) los.add(f["Loan.LoanOfficerName"]);
    const st = pf(f, "Loan.SubjectPropertyState", "14");
    if (st) states.add(st);
    if (f["Loan.LoanPurpose"]) purposes.add(f["Loan.LoanPurpose"]);
    if (f["Loan.LockStatus"]) locks.add(f["Loan.LockStatus"]);
    if (f["Loan.LoanProgram"]) programs.add(f["Loan.LoanProgram"]);
  }

  return {
    milestones: [...milestones].sort(),
    los: [...los].sort(),
    states: [...states].sort(),
    purposes: [...purposes].sort(),
    locks: [...locks].sort(),
    programs: [...programs].sort(),
  };
}

// ── Month-by-month exhaustive fetch (avoids API offset recycling) ──

function generateMonthWindows(): Array<{ from: string; to: string; label: string }> {
  const months: Array<{ from: string; to: string; label: string }> = [];
  const now = new Date();
  const endYear = now.getFullYear();
  const endMonth = now.getMonth() + 1;
  let y = 2000, m = 1;
  while (y < endYear || (y === endYear && m <= endMonth)) {
    const nextM = m === 12 ? 1 : m + 1;
    const nextY = m === 12 ? y + 1 : y;
    months.push({
      from: `${y}-${String(m).padStart(2, "0")}-01`,
      to: `${nextY}-${String(nextM).padStart(2, "0")}-01`,
      label: `${y}-${String(m).padStart(2, "0")}`,
    });
    m = nextM;
    y = nextY;
  }
  return months;
}

async function fetchAllLoans(): Promise<PipelineRow[]> {
  const seenGuids = new Set<string>();
  const allRows: PipelineRow[] = [];
  warmupLoadedSoFar = 0;

  const months = generateMonthWindows();
  console.log(`[pipeline-cache] Starting month-by-month fetch (${months.length} months, batch size: ${BATCH_SIZE})...`);

  for (const { from, to, label } of months) {
    let offset = 0;
    let hasMore = true;

    while (hasMore) {
      try {
        const batch = await searchPipelineWithFilters(
          {
            operator: "and",
            terms: [
              { canonicalName: "Loan.DateCreated", value: from, matchType: "greaterThanOrEquals", include: true },
              { canonicalName: "Loan.DateCreated", value: to, matchType: "lessThan", include: true },
            ],
          },
          [{ canonicalName: "Loan.DateCreated", order: "asc" }],
          offset,
          BATCH_SIZE,
        );
        const rows: PipelineRow[] = Array.isArray(batch) ? batch : [];

        let newInBatch = 0;
        for (const row of rows) {
          if (!seenGuids.has(row.loanGuid)) {
            seenGuids.add(row.loanGuid);
            allRows.push(row);
            newInBatch++;
          }
        }

        warmupLoadedSoFar = allRows.length;
        offset += BATCH_SIZE;
        hasMore = rows.length === BATCH_SIZE;

        // If all dupes in a full batch, API is recycling — move on
        if (newInBatch === 0 && rows.length === BATCH_SIZE) {
          hasMore = false;
        }
      } catch (err) {
        console.error(`[pipeline-cache] Error in ${label} offset ${offset}: ${err}`);
        hasMore = false;
      }
    }
  }

  // Also fetch loans with no DateCreated
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    try {
      const batch = await searchPipelineWithFilters(
        { canonicalName: "Loan.DateCreated", value: "", matchType: "isEmpty", include: true },
        [{ canonicalName: "Loan.LoanNumber", order: "asc" }],
        offset,
        BATCH_SIZE,
      );
      const rows: PipelineRow[] = Array.isArray(batch) ? batch : [];

      let newInBatch = 0;
      for (const row of rows) {
        if (!seenGuids.has(row.loanGuid)) {
          seenGuids.add(row.loanGuid);
          allRows.push(row);
          newInBatch++;
        }
      }

      warmupLoadedSoFar = allRows.length;
      offset += BATCH_SIZE;
      hasMore = rows.length === BATCH_SIZE && newInBatch > 0;
    } catch {
      hasMore = false;
    }
  }

  console.log(`[pipeline-cache] Fetch complete: ${allRows.length} unique loans`);
  return allRows;
}

// ── Refresh logic (atomic swap) ──

async function refresh(): Promise<void> {
  const t0 = Date.now();
  try {
    cacheState = cacheState === "cold" ? "warming" : cacheState;
    const newRows = await fetchAllLoans();
    const newCompact = newRows.map(toCompact);
    const newOptions = buildFilterOptions(newRows);

    // Atomic swap
    fullRows = newRows;
    compactRows = newCompact;
    filterOptions = newOptions;
    cacheState = "ready";
    lastRefreshTime = new Date();
    refreshDurationMs = Date.now() - t0;
    errorMessage = null;

    console.log(`[pipeline-cache] Refreshed: ${newRows.length} loans in ${refreshDurationMs}ms`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unknown error";
    console.error(`[pipeline-cache] Refresh failed: ${msg}`);
    errorMessage = msg;
    // Stale-while-revalidate: keep serving old data if we have it
    if (fullRows.length === 0) {
      cacheState = "error";
    }
    // If we already have data, keep state as "ready" so we serve stale
  }
}

// ── Public API ──

/** Kick off warmup if cold, return true only if cache is ready NOW. Never blocks. */
export function ensureReady(): boolean {
  if (cacheState === "ready") return true;

  // Start warmup in background if not already running
  if (!warmupPromise) {
    warmupPromise = refresh().finally(() => {
      warmupPromise = null;
      // Start background refresh timer
      if (!refreshTimer) {
        refreshTimer = setInterval(() => {
          refresh().catch(() => {}); // errors handled inside refresh()
        }, REFRESH_INTERVAL);
      }
    });
  }

  // Don't block — caller should use fallback path
  return false;
}

/** Force an immediate refresh. Returns when done. */
export async function forceRefresh(): Promise<void> {
  await refresh();
}

/** Server-side query: filter, sort, search, paginate. */
export function queryPipeline(params: PipelineQueryParams): PipelineQueryResult {
  const {
    page = 0,
    pageSize = 50,
    search,
    sortField = "modified",
    sortDir = "desc",
    milestone,
    lo,
    state,
    purpose,
    lock,
    program,
    amountMin,
    amountMax,
    rateMin,
    rateMax,
    dateFrom,
    dateTo,
  } = params;

  // Filter
  let filtered = fullRows;

  if (search) {
    const s = search.toLowerCase();
    filtered = filtered.filter((r) => {
      const f = r.fields || {};
      return (
        (f["Loan.LoanNumber"] || "").toLowerCase().includes(s) ||
        (f["Loan.BorrowerLastName"] || "").toLowerCase().includes(s) ||
        (f["Loan.BorrowerFirstName"] || "").toLowerCase().includes(s) ||
        (f["Loan.LoanOfficerName"] || "").toLowerCase().includes(s) ||
        pf(f, "Loan.SubjectPropertyCity", "12").toLowerCase().includes(s) ||
        pf(f, "Loan.SubjectPropertyState", "14").toLowerCase().includes(s)
      );
    });
  }

  if (milestone) filtered = filtered.filter((r) => r.fields?.["Loan.CurrentMilestoneName"] === milestone);
  if (lo) filtered = filtered.filter((r) => r.fields?.["Loan.LoanOfficerName"] === lo);
  if (state) filtered = filtered.filter((r) => pf(r.fields || {}, "Loan.SubjectPropertyState", "14") === state);
  if (purpose) filtered = filtered.filter((r) => r.fields?.["Loan.LoanPurpose"] === purpose);
  if (lock) filtered = filtered.filter((r) => r.fields?.["Loan.LockStatus"] === lock);
  if (program) filtered = filtered.filter((r) => r.fields?.["Loan.LoanProgram"] === program);

  if (amountMin !== undefined || amountMax !== undefined) {
    filtered = filtered.filter((r) => {
      const amt = parseFloat(r.fields?.["Loan.LoanAmount"] || "0") || 0;
      if (amountMin !== undefined && amt < amountMin) return false;
      if (amountMax !== undefined && amt > amountMax) return false;
      return true;
    });
  }

  if (rateMin !== undefined || rateMax !== undefined) {
    filtered = filtered.filter((r) => {
      const rate = parseFloat(pf(r.fields || {}, "Loan.NoteRatePercent", "3") || "0") || 0;
      if (rateMin !== undefined && rate < rateMin) return false;
      if (rateMax !== undefined && rate > rateMax) return false;
      return true;
    });
  }

  if (dateFrom || dateTo) {
    const fromMs = dateFrom ? new Date(dateFrom).getTime() : 0;
    const toMs = dateTo ? new Date(dateTo + "T23:59:59").getTime() : Infinity;
    filtered = filtered.filter((r) => {
      const dtStr = r.fields?.["Loan.DateCreated"] || pf(r.fields || {}, "", "745") || "";
      if (!dtStr) return false;
      const dtMs = new Date(dtStr).getTime();
      return dtMs >= fromMs && dtMs <= toMs;
    });
  }

  // Total volume across all filtered rows
  const totalVolume = filtered.reduce((s, r) => s + (parseFloat(r.fields?.["Loan.LoanAmount"] || "0") || 0), 0);
  const total = filtered.length;

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    const fa = a.fields || {};
    const fb = b.fields || {};
    let va = "", vb = "";

    switch (sortField) {
      case "loanNumber": va = fa["Loan.LoanNumber"] || ""; vb = fb["Loan.LoanNumber"] || ""; break;
      case "borrower":
        va = `${fa["Loan.BorrowerLastName"] || ""} ${fa["Loan.BorrowerFirstName"] || ""}`;
        vb = `${fb["Loan.BorrowerLastName"] || ""} ${fb["Loan.BorrowerFirstName"] || ""}`;
        break;
      case "amount": {
        const aa = parseFloat(fa["Loan.LoanAmount"] || "0") || 0;
        const ab = parseFloat(fb["Loan.LoanAmount"] || "0") || 0;
        return sortDir === "asc" ? aa - ab : ab - aa;
      }
      case "rate": {
        const ra = parseFloat(pf(fa, "Loan.NoteRatePercent", "3") || "0") || 0;
        const rb = parseFloat(pf(fb, "Loan.NoteRatePercent", "3") || "0") || 0;
        return sortDir === "asc" ? ra - rb : rb - ra;
      }
      case "milestone": va = fa["Loan.CurrentMilestoneName"] || ""; vb = fb["Loan.CurrentMilestoneName"] || ""; break;
      case "lo": va = fa["Loan.LoanOfficerName"] || ""; vb = fb["Loan.LoanOfficerName"] || ""; break;
      case "modified": va = fa["Loan.LastModified"] || ""; vb = fb["Loan.LastModified"] || ""; break;
      case "closingDate": va = pf(fa, "Loan.ClosingDate", "748"); vb = pf(fb, "Loan.ClosingDate", "748"); break;
      case "appDate":
        va = pf(fa, "", "745") || fa["Loan.DateCreated"] || "";
        vb = pf(fb, "", "745") || fb["Loan.DateCreated"] || "";
        break;
      case "property":
        va = `${pf(fa, "Loan.SubjectPropertyCity", "12")} ${pf(fa, "Loan.SubjectPropertyState", "14")}`;
        vb = `${pf(fb, "Loan.SubjectPropertyCity", "12")} ${pf(fb, "Loan.SubjectPropertyState", "14")}`;
        break;
      default: va = fa["Loan.LastModified"] || ""; vb = fb["Loan.LastModified"] || "";
    }
    const cmp = va.localeCompare(vb);
    return sortDir === "asc" ? cmp : -cmp;
  });

  // Paginate
  const start = page * pageSize;
  const pageRows = sorted.slice(start, start + pageSize);

  return {
    rows: pageRows,
    total,
    totalVolume,
    page,
    pageSize,
    cacheAge: lastRefreshTime ? Date.now() - lastRefreshTime.getTime() : 0,
    filterOptions,
  };
}

/** Compact rows for analytics (no PII). Optionally filtered. */
export function getCompactRows(filters?: {
  state?: string;
  lo?: string;
  milestone?: string;
  program?: string;
  purpose?: string;
  lock?: string;
  dateFrom?: string;
  dateTo?: string;
}): { rows: CompactRow[]; total: number; cacheAge: number; filterOptions: FilterOptions } {
  let result = compactRows;

  if (filters) {
    if (filters.state) result = result.filter((r) => r.st === filters.state);
    if (filters.lo) result = result.filter((r) => r.lo === filters.lo);
    if (filters.milestone) result = result.filter((r) => r.ms === filters.milestone);
    if (filters.program) result = result.filter((r) => r.prog === filters.program);
    if (filters.purpose) result = result.filter((r) => r.purp === filters.purpose);
    if (filters.lock) result = result.filter((r) => r.lock === filters.lock);
    if (filters.dateFrom || filters.dateTo) {
      const fromMs = filters.dateFrom ? new Date(filters.dateFrom).getTime() : 0;
      const toMs = filters.dateTo ? new Date(filters.dateTo + "T23:59:59").getTime() : Infinity;
      result = result.filter((r) => {
        if (!r.dt) return false;
        const dtMs = new Date(r.dt).getTime();
        return dtMs >= fromMs && dtMs <= toMs;
      });
    }
  }

  return {
    rows: result,
    total: compactRows.length,
    cacheAge: lastRefreshTime ? Date.now() - lastRefreshTime.getTime() : 0,
    filterOptions,
  };
}

/** Pre-aggregated context for Claude AI. Accepts optional filters to scope data. */
export function getAIContext(question: string, filters?: { state?: string; lo?: string; milestone?: string; program?: string; purpose?: string; lock?: string; dateFrom?: string; dateTo?: string }): { stats: AIContextStats; sample: CompactRow[]; totalLoans: number } {
  let rows = compactRows;

  // Apply filters if provided
  if (filters) {
    if (filters.state) rows = rows.filter((r) => r.st === filters.state);
    if (filters.lo) rows = rows.filter((r) => r.lo === filters.lo);
    if (filters.milestone) rows = rows.filter((r) => r.ms === filters.milestone);
    if (filters.program) rows = rows.filter((r) => r.prog === filters.program);
    if (filters.purpose) rows = rows.filter((r) => r.purp === filters.purpose);
    if (filters.lock) rows = rows.filter((r) => r.lock === filters.lock);
    if (filters.dateFrom || filters.dateTo) {
      const fromMs = filters.dateFrom ? new Date(filters.dateFrom).getTime() : 0;
      const toMs = filters.dateTo ? new Date(filters.dateTo + "T23:59:59").getTime() : Infinity;
      rows = rows.filter((r) => {
        if (!r.dt) return false;
        const dtMs = new Date(r.dt).getTime();
        return dtMs >= fromMs && dtMs <= toMs;
      });
    }
  }

  const totalLoans = rows.length;
  const totalVolume = rows.reduce((s, r) => s + r.amt, 0);

  // Aggregate by dimensions
  const byMilestone: Record<string, { units: number; volume: number }> = {};
  const byState: Record<string, { units: number; volume: number }> = {};
  const byProgram: Record<string, { units: number; volume: number }> = {};
  const byPurpose: Record<string, { units: number; volume: number }> = {};
  const byLO: Record<string, { units: number; volume: number }> = {};
  const byLock: Record<string, number> = {};
  const rateDistribution: Record<string, number> = {};
  let rateSum = 0, rateCount = 0;

  for (const r of rows) {
    const { amt, ms, st, prog, purp, lo, lock, rate } = r;

    if (ms) {
      if (!byMilestone[ms]) byMilestone[ms] = { units: 0, volume: 0 };
      byMilestone[ms].units++;
      byMilestone[ms].volume += amt;
    }
    if (st) {
      if (!byState[st]) byState[st] = { units: 0, volume: 0 };
      byState[st].units++;
      byState[st].volume += amt;
    }
    if (prog) {
      if (!byProgram[prog]) byProgram[prog] = { units: 0, volume: 0 };
      byProgram[prog].units++;
      byProgram[prog].volume += amt;
    }
    if (purp) {
      if (!byPurpose[purp]) byPurpose[purp] = { units: 0, volume: 0 };
      byPurpose[purp].units++;
      byPurpose[purp].volume += amt;
    }
    if (lo) {
      if (!byLO[lo]) byLO[lo] = { units: 0, volume: 0 };
      byLO[lo].units++;
      byLO[lo].volume += amt;
    }
    if (lock) byLock[lock] = (byLock[lock] || 0) + 1;
    if (rate > 0) {
      rateSum += rate;
      rateCount++;
      const bucket = rate < 5 ? "<5%" : rate < 5.5 ? "5-5.5%" : rate < 6 ? "5.5-6%" : rate < 6.5 ? "6-6.5%" : rate < 7 ? "6.5-7%" : rate < 7.5 ? "7-7.5%" : rate < 8 ? "7.5-8%" : ">8%";
      rateDistribution[bucket] = (rateDistribution[bucket] || 0) + 1;
    }
  }

  // Stratified sample: pick up to 200 rows spread across milestones
  const sample: CompactRow[] = [];
  const milestoneKeys = Object.keys(byMilestone);
  const perMilestone = Math.max(1, Math.floor(200 / (milestoneKeys.length || 1)));
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const ms = r.ms || "Unknown";
    counts[ms] = (counts[ms] || 0) + 1;
    if (counts[ms] <= perMilestone) sample.push(r);
    if (sample.length >= 200) break;
  }

  return {
    stats: {
      totalLoans,
      totalVolume,
      byMilestone,
      byState,
      byProgram,
      byPurpose,
      byLO,
      byLock,
      avgRate: rateCount > 0 ? rateSum / rateCount : 0,
      rateDistribution,
    },
    sample,
    totalLoans,
  };
}

/** Current cache status. */
export function getStatus(): CacheStatus {
  return {
    state: cacheState,
    totalRows: fullRows.length,
    loadedSoFar: warmupLoadedSoFar,
    lastRefresh: lastRefreshTime ? lastRefreshTime.toISOString() : null,
    refreshDurationMs,
    nextRefresh: lastRefreshTime ? new Date(lastRefreshTime.getTime() + REFRESH_INTERVAL).toISOString() : null,
    errorMessage,
  };
}
