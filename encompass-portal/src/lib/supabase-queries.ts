/**
 * Supabase query layer — replaces pipeline-cache.ts
 * All functions are async (hit Supabase, not in-memory cache).
 */

import { supabaseAdmin } from "./supabase";
import { dbRowToPipelineRow, dbRowToCompact, type DbRow, type CompactRow } from "./encompass-to-db";

// ── Re-export types that API routes expect ──

export interface PipelineRow {
  loanGuid: string;
  fields: Record<string, string>;
}

export { CompactRow };

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
  byProgramGroup: Record<string, { units: number; volume: number }>;
  byPurpose: Record<string, { units: number; volume: number }>;
  byLO: Record<string, { units: number; volume: number }>;
  byLock: Record<string, number>;
  avgRate: number;
  rateDistribution: Record<string, number>;
  byYear: Record<string, { units: number; volume: number }>;
  byYearState: Record<string, Record<string, { units: number; volume: number }>>;
  byMonthYear: Record<string, { units: number; volume: number }>;
}

// ── Helpers ──

const SORT_FIELD_MAP: Record<string, string> = {
  loanNumber: "loan_number",
  borrower: "borrower_last",
  amount: "loan_amount",
  rate: "note_rate",
  milestone: "milestone",
  lo: "loan_officer",
  modified: "last_modified",
  closingDate: "closing_date",
  appDate: "date_created",
  property: "property_city",
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SupabaseQuery = any;

/** Supabase caps responses at 1000 rows. This paginates to fetch all. */
async function fetchAllRows<T = Record<string, unknown>>(
  buildQuery: () => SupabaseQuery,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const { data, error } = await buildQuery()
      .range(offset, offset + pageSize - 1);

    if (error) throw new Error(error.message);
    const rows = (data || []) as T[];
    all.push(...rows);
    offset += pageSize;
    hasMore = rows.length === pageSize;
  }

  return all;
}

function applyFilters(query: SupabaseQuery, p: PipelineQueryParams): SupabaseQuery {
  if (p.search) {
    const s = p.search.replace(/[%_]/g, "\\$&");
    query = query.or(
      `loan_number.ilike.%${s}%,borrower_last.ilike.%${s}%,borrower_first.ilike.%${s}%,loan_officer.ilike.%${s}%,property_city.ilike.%${s}%,property_state.ilike.%${s}%`,
    );
  }
  if (p.milestone) query = query.eq("milestone", p.milestone);
  if (p.lo) query = query.eq("loan_officer", p.lo);
  if (p.state) query = query.eq("property_state", p.state);
  if (p.purpose) query = query.eq("loan_purpose", p.purpose);
  if (p.lock) query = query.eq("lock_status", p.lock);
  if (p.program) query = query.eq("loan_program", p.program);
  if (p.amountMin !== undefined) query = query.gte("loan_amount", p.amountMin);
  if (p.amountMax !== undefined) query = query.lte("loan_amount", p.amountMax);
  if (p.rateMin !== undefined) query = query.gte("note_rate", p.rateMin);
  if (p.rateMax !== undefined) query = query.lte("note_rate", p.rateMax);
  if (p.dateFrom) query = query.gte("date_created", p.dateFrom);
  if (p.dateTo) query = query.lte("date_created", p.dateTo + "T23:59:59");
  return query;
}

// Cached filter options (refresh every 60s)
let _cachedFilterOptions: FilterOptions | null = null;
let _filterOptionsFetchedAt = 0;
const FILTER_CACHE_MS = 60_000;

// ── Public API ──

/** Server-side query: filter, sort, search, paginate via Supabase. */
export async function queryPipeline(params: PipelineQueryParams): Promise<PipelineQueryResult> {
  const {
    page = 0,
    pageSize = 50,
    sortField = "modified",
    sortDir = "desc",
  } = params;

  const sortCol = SORT_FIELD_MAP[sortField] || "last_modified";
  const from = page * pageSize;
  const to = from + pageSize - 1;

  // Run paginated query + volume query + filter options in parallel
  const [dataResult, volRows, filterOpts] = await Promise.all([
    applyFilters(
      supabaseAdmin.from("pipeline_loans").select("*", { count: "exact" }),
      params,
    )
      .order(sortCol, { ascending: sortDir === "asc" })
      .range(from, to),

    fetchAllRows<{ loan_amount: number }>(() =>
      applyFilters(
        supabaseAdmin.from("pipeline_loans").select("loan_amount"),
        params,
      ),
    ),

    getFilterOptions(),
  ]);

  if (dataResult.error) throw new Error(dataResult.error.message);

  const rows: PipelineRow[] = (dataResult.data || []).map((r: DbRow) =>
    dbRowToPipelineRow(r),
  );
  const total = dataResult.count || 0;
  const totalVolume = volRows.reduce((s, r) => s + (Number(r.loan_amount) || 0), 0);

  // cacheAge: time since last sync
  const status = await getStatus();
  const cacheAge = status.lastRefresh
    ? Date.now() - new Date(status.lastRefresh).getTime()
    : 0;

  return { rows, total, totalVolume, page, pageSize, cacheAge, filterOptions: filterOpts };
}

/** Compact rows for analytics (no PII). Optionally filtered. */
export async function getCompactRows(filters?: {
  state?: string;
  lo?: string;
  milestone?: string;
  program?: string;
  purpose?: string;
  lock?: string;
  dateFrom?: string;
  dateTo?: string;
}): Promise<{ rows: CompactRow[]; total: number; cacheAge: number; filterOptions: FilterOptions }> {
  const cols =
    "loan_guid,loan_amount,loan_program,loan_purpose,milestone,loan_officer,lock_status,note_rate,property_state,date_created,lien_position,loan_number,channel,closing_date,lock_expiration,last_modified";

  function buildQuery() {
    let q = supabaseAdmin.from("pipeline_loans").select(cols);
    if (filters) {
      if (filters.state) q = q.eq("property_state", filters.state);
      if (filters.lo) q = q.eq("loan_officer", filters.lo);
      if (filters.milestone) q = q.eq("milestone", filters.milestone);
      if (filters.program) q = q.eq("loan_program", filters.program);
      if (filters.purpose) q = q.eq("loan_purpose", filters.purpose);
      if (filters.lock) q = q.eq("lock_status", filters.lock);
      if (filters.dateFrom) q = q.gte("date_created", filters.dateFrom);
      if (filters.dateTo) q = q.lte("date_created", filters.dateTo + "T23:59:59");
    }
    return q;
  }

  const [allData, filterOpts, status] = await Promise.all([
    fetchAllRows<DbRow>(buildQuery),
    getFilterOptions(),
    getStatus(),
  ]);

  const compactRows = allData.map((r) => dbRowToCompact(r));

  const cacheAge = status.lastRefresh
    ? Date.now() - new Date(status.lastRefresh).getTime()
    : 0;

  return {
    rows: compactRows,
    total: compactRows.length,
    cacheAge,
    filterOptions: filterOpts,
  };
}

// Cache for AI context (keyed by filter combination, 2-min TTL)
const _aiContextCache: Map<string, { data: { stats: AIContextStats; sample: CompactRow[]; totalLoans: number }; at: number }> = new Map();
const AI_CONTEXT_CACHE_MS = 120_000;

/** Pre-aggregated context for Claude AI. Accepts optional filters. Cached for 2 min. */
export async function getAIContext(
  question: string,
  filters?: {
    state?: string;
    lo?: string;
    milestone?: string;
    program?: string;
    purpose?: string;
    lock?: string;
    dateFrom?: string;
    dateTo?: string;
  },
): Promise<{ stats: AIContextStats; sample: CompactRow[]; totalLoans: number }> {
  // Check cache (keyed by filter combo, not question)
  const cacheKey = JSON.stringify(filters || {});
  const cached = _aiContextCache.get(cacheKey);
  if (cached && Date.now() - cached.at < AI_CONTEXT_CACHE_MS) {
    return cached.data;
  }

  const cols =
    "loan_guid,loan_amount,loan_program,loan_purpose,milestone,loan_officer,lock_status,note_rate,property_state,date_created,lien_position,loan_number,channel,closing_date,lock_expiration,last_modified";

  function buildAIQuery() {
    let q = supabaseAdmin.from("pipeline_loans").select(cols);
    if (filters) {
      if (filters.state) q = q.eq("property_state", filters.state);
      if (filters.lo) q = q.eq("loan_officer", filters.lo);
      if (filters.milestone) q = q.eq("milestone", filters.milestone);
      if (filters.program) q = q.eq("loan_program", filters.program);
      if (filters.purpose) q = q.eq("loan_purpose", filters.purpose);
      if (filters.lock) q = q.eq("lock_status", filters.lock);
      if (filters.dateFrom) q = q.gte("date_created", filters.dateFrom);
      if (filters.dateTo) q = q.lte("date_created", filters.dateTo + "T23:59:59");
    }
    return q;
  }

  const allData = await fetchAllRows<DbRow>(buildAIQuery);
  const rows = allData.map((r) => dbRowToCompact(r));
  const totalLoans = rows.length;
  const totalVolume = rows.reduce((s, r) => s + (Number(r.amt) || 0), 0);

  // Aggregate by dimensions
  const byMilestone: Record<string, { units: number; volume: number }> = {};
  const byState: Record<string, { units: number; volume: number }> = {};
  const byProgram: Record<string, { units: number; volume: number }> = {};
  const byProgramGroup: Record<string, { units: number; volume: number }> = {};
  const byPurpose: Record<string, { units: number; volume: number }> = {};
  const byLO: Record<string, { units: number; volume: number }> = {};
  const byLock: Record<string, number> = {};
  const rateDistribution: Record<string, number> = {};
  const byYear: Record<string, { units: number; volume: number }> = {};
  const byYearState: Record<string, Record<string, { units: number; volume: number }>> = {};
  const byMonthYear: Record<string, { units: number; volume: number }> = {};
  let rateSum = 0,
    rateCount = 0;

  for (const r of rows) {
    const { amt, ms, st, prog, purp, lo, lock, rate, dt } = r;

    // Extract year and month from date_created
    // Handles both US format "M/D/YYYY H:MM:SS AM" and ISO "YYYY-MM-DD"
    let year = "";
    let monthYear = "";
    if (dt) {
      if (dt.includes("/")) {
        // US format: "10/8/2007 5:02:00 PM"
        const parts = dt.split("/");
        if (parts.length >= 3) {
          const m = parts[0].padStart(2, "0");
          const y = parts[2].split(" ")[0]; // "2007" from "2007 5:02:00 PM"
          year = y;
          monthYear = `${y}-${m}`;
        }
      } else {
        // ISO format: "2024-03-15"
        year = dt.slice(0, 4);
        monthYear = dt.slice(0, 7);
      }
    }

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
      // Grouped program category
      const pl = prog.toLowerCase();
      const group = pl.includes("fha") ? "FHA"
        : pl.includes(" va ") || pl.startsWith("va ") ? "VA"
        : pl.includes("usda") ? "USDA"
        : pl.includes("jumbo") ? "Jumbo"
        : (pl.includes("conv") || pl.includes("fannie") || pl.includes("freddie") || pl.includes("fnma") || pl.includes("fhlmc") || pl.includes("du ") || pl.includes("lp ") || pl.includes("homeready") || pl.includes("home one") || pl.includes("home possible") || /^\d+ year fixed$/i.test(prog) || /^fixed rate/i.test(prog) || pl.includes("super conforming") || pl.includes("high balance")) ? "Conventional"
        : "Other";
      if (!byProgramGroup[group]) byProgramGroup[group] = { units: 0, volume: 0 };
      byProgramGroup[group].units++;
      byProgramGroup[group].volume += amt;
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

    // Time-based aggregations
    if (year) {
      if (!byYear[year]) byYear[year] = { units: 0, volume: 0 };
      byYear[year].units++;
      byYear[year].volume += amt;
    }
    if (year && st) {
      if (!byYearState[year]) byYearState[year] = {};
      if (!byYearState[year][st]) byYearState[year][st] = { units: 0, volume: 0 };
      byYearState[year][st].units++;
      byYearState[year][st].volume += amt;
    }
    if (monthYear) {
      if (!byMonthYear[monthYear]) byMonthYear[monthYear] = { units: 0, volume: 0 };
      byMonthYear[monthYear].units++;
      byMonthYear[monthYear].volume += amt;
    }

    if (rate > 0) {
      rateSum += rate;
      rateCount++;
      const bucket =
        rate < 5
          ? "<5%"
          : rate < 5.5
            ? "5-5.5%"
            : rate < 6
              ? "5.5-6%"
              : rate < 6.5
                ? "6-6.5%"
                : rate < 7
                  ? "6.5-7%"
                  : rate < 7.5
                    ? "7-7.5%"
                    : rate < 8
                      ? "7.5-8%"
                      : ">8%";
      rateDistribution[bucket] = (rateDistribution[bucket] || 0) + 1;
    }
  }

  // Stratified sample: pick up to 80 rows spread across milestones
  const sample: CompactRow[] = [];
  const milestoneKeys = Object.keys(byMilestone);
  const perMilestone = Math.max(1, Math.floor(80 / (milestoneKeys.length || 1)));
  const counts: Record<string, number> = {};
  for (const r of rows) {
    const ms = r.ms || "Unknown";
    counts[ms] = (counts[ms] || 0) + 1;
    if (counts[ms] <= perMilestone) sample.push(r);
    if (sample.length >= 80) break;
  }

  const result = {
    stats: {
      totalLoans,
      totalVolume,
      byMilestone,
      byState,
      byProgram,
      byProgramGroup,
      byPurpose,
      byLO,
      byLock,
      avgRate: rateCount > 0 ? rateSum / rateCount : 0,
      rateDistribution,
      byYear,
      byYearState,
      byMonthYear,
    },
    sample,
    totalLoans,
  };

  // Cache for 2 min
  _aiContextCache.set(cacheKey, { data: result, at: Date.now() });
  return result;
}

/** Filter dropdown options (cached for 60s). */
export async function getFilterOptions(): Promise<FilterOptions> {
  if (_cachedFilterOptions && Date.now() - _filterOptionsFetchedAt < FILTER_CACHE_MS) {
    return _cachedFilterOptions;
  }

  const { data, error } = await supabaseAdmin.rpc("get_filter_options");

  if (error || !data) {
    // Fallback: return empty if RPC isn't set up yet
    return { milestones: [], los: [], states: [], purposes: [], locks: [], programs: [] };
  }

  _cachedFilterOptions = data as FilterOptions;
  _filterOptionsFetchedAt = Date.now();
  return _cachedFilterOptions;
}

/** Current sync status. */
export async function getStatus(): Promise<CacheStatus> {
  const { data, error } = await supabaseAdmin
    .from("sync_status")
    .select("*")
    .eq("id", 1)
    .single();

  if (error || !data) {
    return {
      state: "unknown",
      totalRows: 0,
      loadedSoFar: 0,
      lastRefresh: null,
      refreshDurationMs: 0,
      nextRefresh: null,
      errorMessage: error?.message || null,
    };
  }

  const lastRefresh = data.last_sync_at || null;
  return {
    state: data.status || "idle",
    totalRows: data.total_rows || 0,
    loadedSoFar: data.total_rows || 0,
    lastRefresh,
    refreshDurationMs: data.sync_duration_ms || 0,
    nextRefresh: lastRefresh
      ? new Date(new Date(lastRefresh).getTime() + 5 * 60_000).toISOString()
      : null,
    errorMessage: data.error_message || null,
  };
}

/** Trigger a sync via the cron endpoint (used by stats POST). */
export async function triggerSync(baseUrl: string): Promise<void> {
  const cronSecret = process.env.CRON_SECRET;
  await fetch(`${baseUrl}/api/cron/sync-pipeline`, {
    method: "POST",
    headers: cronSecret ? { Authorization: `Bearer ${cronSecret}` } : {},
  });
}
