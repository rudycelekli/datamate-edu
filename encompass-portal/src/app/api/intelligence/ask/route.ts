import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { getAIContext } from "@/lib/supabase-queries";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Two-tier AI query approach:
 * FAST PATH: Text-to-SQL → generate SQL → execute on Supabase → return (needs RPC function)
 * FALLBACK: Pre-aggregated stats → Haiku → chart response (works without RPC)
 */

// ── Fast Path: Text-to-SQL ──

const TABLE_SCHEMA = `Table: pipeline_loans (PostgreSQL) — Mortgage pipeline data

Columns (ALL available):
  loan_guid TEXT PRIMARY KEY (unique identifier, never display)
  loan_number TEXT (e.g. '503432825')
  loan_amount NUMERIC (dollar amount, e.g. 450000)
  note_rate NUMERIC (interest rate %, e.g. 6.875)
  date_created TEXT (ISO datetime, e.g. '2024-03-15T10:30:00' — loan origination date)
  application_date TEXT (ISO datetime — when borrower applied)
  closing_date TEXT (ISO datetime — loan closing/funding date, empty if not yet closed)
  last_modified TEXT (ISO datetime — last update timestamp)
  milestone TEXT (pipeline stage: 'Started','Setup','Processing','Submittal','Submission Review','Approval','Conditional Approval','Docs Out','Docs Back','Funding','Purchased','Completion','Shipping','Reconciled','Packaging','Qualification','Registered','Lender Submission','Lender Approval','Lender Funding','Lender Payout','UW Review','Trailing Docs','Ready for Docs','Ready for Purchase')
  loan_officer TEXT (full name, e.g. 'John Smith')
  loan_processor TEXT (full name of processor)
  property_state TEXT (2-letter code: 'CA','TX','AZ','NC','FL','WA','MN','SC','TN','KY','AL','OH','OR','MD','GA','CO','WI','ID','MI','NE', etc.)
  property_city TEXT (city name)
  property_zip TEXT (ZIP code)
  property_address TEXT (street address — PII, avoid selecting)
  loan_program TEXT (670+ variations — group with CASE: '%fha%'→FHA, '%va%'→VA, '%conv%'|'%fannie%'|'%freddie%'→Conventional, '%jumbo%'→Jumbo, '%usda%'→USDA, else Other)
  loan_purpose TEXT ('Purchase','NoCash-Out Refinance','Cash-Out Refinance','ConstructionToPermanent','ConstructionOnly','Other')
  lien_position TEXT ('FirstLien','SecondLien')
  lock_status TEXT ('Locked','NotLocked','Expired')
  lock_expiration TEXT (ISO datetime — when the rate lock expires)
  loan_folder TEXT (pipeline folder: 'My Pipeline','Prospects','TBD Purchases','Cancelled - Not Audited','TPO Pending','Completed')
  channel TEXT (origination channel)
  loan_status TEXT
  borrower_first TEXT (PII — NEVER select or expose)
  borrower_last TEXT (PII — NEVER select or expose)
  co_borrower_first TEXT (PII — NEVER select or expose)
  co_borrower_last TEXT (PII — NEVER select or expose)`;

let _cachedSample: string | null = null;
let _cachedSampleAt = 0;
let _cachedCount = 0;

async function getSampleAndCount(): Promise<{ sampleText: string; totalCount: number }> {
  if (_cachedSample && Date.now() - _cachedSampleAt < 300_000) {
    return { sampleText: _cachedSample, totalCount: _cachedCount };
  }
  const [sampleRes, countRes] = await Promise.all([
    supabaseAdmin.from("pipeline_loans")
      .select("loan_number,loan_amount,note_rate,date_created,application_date,closing_date,last_modified,milestone,loan_officer,loan_processor,property_state,property_city,property_zip,loan_program,loan_purpose,lien_position,lock_status,lock_expiration,loan_folder,channel")
      .limit(5),
    supabaseAdmin.from("pipeline_loans").select("loan_guid", { count: "exact", head: true }),
  ]);
  const rows = sampleRes.data || [];
  const count = countRes.count || 0;
  const sampleText = rows.length > 0
    ? `\n\nSample rows (5 of ${count.toLocaleString()}):\n${JSON.stringify(rows)}`
    : "";
  _cachedSample = sampleText;
  _cachedCount = count;
  _cachedSampleAt = Date.now();
  return { sampleText, totalCount: count };
}

function buildSqlPrompt(sampleText: string, totalCount: number) {
  return `You are a SQL generator for mortgage analytics. Generate a SQL query + chart config from a user question.

Today is ${new Date().toISOString().slice(0, 10)}.

${TABLE_SCHEMA}

Total rows: ~${totalCount.toLocaleString()}${sampleText}

Return ONLY valid JSON (no markdown):
{
  "sql": "SELECT ... FROM pipeline_loans ...",
  "chartConfig": {
    "type": "bar"|"pie"|"line"|"horizontal-bar"|"table"|"stacked-bar"|"grouped-bar"|"multi-line",
    "title": "Chart title",
    "dataKey": "numeric column alias",
    "nameKey": "label column alias",
    "seriesKeys": ["optional","for","multi-series"],
    "formatValue": "currency"|"number"|"percent"|"rate",
    "pivotBy": "optional column for multi-series pivot",
    "topN": 5
  }
}

SQL Rules:
- PostgreSQL only. Alias columns clearly (AS name, AS value, AS volume, AS units).
- SUM(loan_amount) AS volume, COUNT(*) AS units for aggregations.
- AVG(loan_amount) AS avg_amount, AVG(note_rate) AS avg_rate for averages.
- ORDER BY DESC for rankings, ASC for time series. LIMIT 30 max for bar charts.
- Year: EXTRACT(YEAR FROM date_created::date)::int AS year
- Month: TO_CHAR(date_created::date, 'YYYY-MM') AS month
- Quarter: 'Q' || EXTRACT(QUARTER FROM date_created::date)::int || ' ' || EXTRACT(YEAR FROM date_created::date)::int AS quarter
- Days to close: DATE_PART('day', closing_date::timestamp - date_created::timestamp)::int (only WHERE closing_date != '')
- Lock expiration analysis: DATE_PART('day', lock_expiration::timestamp - NOW()) for days until expiry
- Program grouping: CASE WHEN LOWER(loan_program) LIKE '%fha%' THEN 'FHA' WHEN LOWER(loan_program) LIKE '%va%' THEN 'VA' WHEN LOWER(loan_program) LIKE '%usda%' THEN 'USDA' WHEN LOWER(loan_program) LIKE '%jumbo%' THEN 'Jumbo' WHEN LOWER(loan_program) LIKE '%conv%' OR LOWER(loan_program) LIKE '%fannie%' OR LOWER(loan_program) LIKE '%freddie%' THEN 'Conventional' ELSE 'Other' END
- For empty date fields, always add WHERE column != '' before casting to date/timestamp.
- NEVER use DELETE/UPDATE/INSERT/DROP/ALTER/CREATE/TRUNCATE.
- NEVER select borrower_first, borrower_last, co_borrower_first, co_borrower_last, property_address (PII).
- For two-dimensional breakdowns (e.g. "by year color coded by state"), return flat rows with both dimensions + value. Set pivotBy in chartConfig. The server pivots automatically.
- Do NOT include a "summary" field — the server generates it from the actual query results.

Chart types: horizontal-bar for rankings, pie for distributions (<8 categories), line for time series, stacked-bar/multi-line for two-dimensional.

Example queries:
- "Which LOs have the most volume?" → SELECT loan_officer AS name, SUM(loan_amount) AS value, COUNT(*) AS units FROM pipeline_loans WHERE loan_officer != '' GROUP BY loan_officer ORDER BY value DESC LIMIT 15
- "Average rate by program type" → Use program grouping CASE, AVG(note_rate), WHERE note_rate > 0
- "Pipeline by folder" → GROUP BY loan_folder
- "Loans closing this month" → WHERE closing_date != '' AND closing_date >= '2026-03-01' AND closing_date < '2026-04-01'
- "Expiring locks" → WHERE lock_status = 'Locked' AND lock_expiration != '' AND lock_expiration::date <= CURRENT_DATE + INTERVAL '7 days'
- "Average days to close" → AVG(DATE_PART('day', closing_date::timestamp - date_created::timestamp)) WHERE closing_date != ''
- "Year over year % change of volume in NC" → Use a subquery with LAG:
  SELECT year AS name, volume, ROUND(((volume - prev) / NULLIF(prev, 0)) * 100, 1) AS value FROM (SELECT EXTRACT(YEAR FROM date_created::date)::int AS year, SUM(loan_amount) AS volume, LAG(SUM(loan_amount)) OVER (ORDER BY EXTRACT(YEAR FROM date_created::date)::int) AS prev FROM pipeline_loans WHERE property_state = 'NC' AND date_created != '' GROUP BY year) sub WHERE prev IS NOT NULL ORDER BY year
  chartConfig: { type: "bar", nameKey: "name", dataKey: "value", formatValue: "percent" } — NOT pivotBy, NOT byYearState
- IMPORTANT: When user asks about a SINGLE state/LO/dimension (e.g. "volume in NC by year"), filter with WHERE, do NOT pivot by that dimension. Only use pivotBy when they want to compare ACROSS dimensions (e.g. "by year color-coded by state").`;
}

function validateSQL(sql: string): boolean {
  const upper = sql.toUpperCase().trim();
  const forbidden = ["DELETE", "UPDATE", "INSERT", "DROP", "ALTER", "CREATE", "TRUNCATE", "GRANT", "REVOKE", "EXEC", "COPY"];
  for (const word of forbidden) {
    if (new RegExp(`\\b${word}\\b`, "i").test(upper)) return false;
  }
  return upper.startsWith("SELECT");
}

/** Build a human-readable summary from actual query results */
function buildSummaryFromResults(
  title: string,
  rows: Record<string, unknown>[],
  config: { nameKey: string; dataKey: string; formatValue?: string; pivotBy?: string },
): string {
  if (!rows.length) return `No data found for: ${title}`;

  const fmt = (v: unknown, type?: string): string => {
    const n = Number(v);
    if (isNaN(n)) return String(v);
    if (type === "currency") {
      if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
      if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      if (n >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
      return `$${n.toFixed(0)}`;
    }
    if (type === "percent") return `${n.toFixed(1)}%`;
    if (type === "rate") return `${n.toFixed(3)}%`;
    return n.toLocaleString();
  };

  const nameKey = config.nameKey || "name";
  const dataKey = config.dataKey || "value";
  const fv = config.formatValue;

  // Single aggregate row (e.g. "total count", "average rate")
  if (rows.length === 1) {
    const row = rows[0];
    const parts: string[] = [];
    for (const [k, v] of Object.entries(row)) {
      if (v === null || v === undefined) continue;
      const n = Number(v);
      const label = k.replace(/_/g, " ");
      if (!isNaN(n)) {
        const formatted = k.toLowerCase().includes("volume") || k.toLowerCase().includes("amount")
          ? fmt(n, "currency") : k.toLowerCase().includes("rate") ? fmt(n, "rate") : fmt(n, fv);
        parts.push(`${label}: ${formatted}`);
      } else {
        parts.push(`${label}: ${v}`);
      }
    }
    return parts.join(", ") + ".";
  }

  // Pivoted / stacked chart — mention the series
  if (config.pivotBy) {
    const totalRows = rows.length;
    return `${title} — ${totalRows} data points across multiple categories.`;
  }

  // Ranking or distribution — highlight top entries
  const top = rows.slice(0, 3);
  const total = rows.reduce((s, r) => s + (Number(r[dataKey]) || 0), 0);
  const totalUnits = rows.reduce((s, r) => s + (Number(r["units"]) || 0), 0);
  const parts: string[] = [];

  for (let i = 0; i < top.length; i++) {
    const r = top[i];
    const name = String(r[nameKey] || "");
    const val = Number(r[dataKey] || 0);
    const units = Number(r["units"] || 0);
    let entry = `${name} (${fmt(val, fv)}`;
    if (units && dataKey !== "units") entry += `, ${units.toLocaleString()} loans`;
    entry += ")";
    parts.push(entry);
  }

  let summary = parts.join(", ") + ".";
  if (total > 0 && rows.length > 3) {
    summary += ` Total across ${rows.length} entries: ${fmt(total, fv)}`;
    if (totalUnits && dataKey !== "units") summary += ` (${totalUnits.toLocaleString()} loans)`;
    summary += ".";
  }

  return summary;
}

function pivotResults(
  rows: Record<string, unknown>[],
  nameKey: string,
  pivotBy: string,
  dataKey: string,
  topN?: number,
): { data: Record<string, unknown>[]; seriesKeys: string[] } {
  const seriesTotals: Record<string, number> = {};
  for (const row of rows) {
    const s = String(row[pivotBy] || "");
    seriesTotals[s] = (seriesTotals[s] || 0) + Number(row[dataKey] || 0);
  }
  const seriesKeys = Object.entries(seriesTotals)
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN || 10)
    .map(([k]) => k);

  const grouped: Record<string, Record<string, unknown>> = {};
  for (const row of rows) {
    const name = String(row[nameKey] || "");
    const series = String(row[pivotBy] || "");
    if (!seriesKeys.includes(series)) continue;
    if (!grouped[name]) grouped[name] = { [nameKey]: name };
    grouped[name][series] = Number(row[dataKey] || 0);
  }

  const data = Object.values(grouped).sort((a, b) =>
    String(a[nameKey]).localeCompare(String(b[nameKey]))
  );
  return { data, seriesKeys };
}

// ── Fallback: Blueprint approach (LLM picks chart config, server builds data) ──

const FALLBACK_PROMPT = `You are a mortgage pipeline analytics AI. You receive pre-aggregated stats and return a chart BLUEPRINT — the server builds the actual data arrays.

This is a mortgage pipeline with data about loans including: amounts, rates, milestones (pipeline stages), loan officers, processors, property locations (state/city), programs (FHA/VA/Conventional/Jumbo/USDA), purposes (Purchase/Refi), lock status, lien position, dates (created/closing/application), and folders.

Today is ${new Date().toISOString().slice(0, 10)}.

Return ONLY valid JSON (NO markdown fences):
{
  "title": "Chart title",
  "summary": "1-2 sentence insight referencing real numbers from the stats",
  "charts": [{
    "type": "bar"|"pie"|"line"|"horizontal-bar"|"stacked-bar"|"multi-line",
    "title": "Chart title",
    "source": "<source name>",
    "valueField": "volume"|"units",
    "topN": 10,
    "formatValue": "currency"|"number"|"percent"|"rate",
    "sortBy": "desc"|"asc"
  }]
}

Available data sources (the server has these pre-aggregated):
- byState: volume & count by 2-letter state code. Rankings, geographic analysis.
- byLO: volume & count by loan officer name. LO performance, rankings.
- byMilestone: volume & count by pipeline stage. Pipeline health, bottlenecks.
- byProgram: volume & count by raw program name (670+ variations like "DU 30 Year Fixed", "FHA 30 Year Fixed"). Detailed product mix.
- byProgramGroup: volume & count by grouped category (FHA, VA, Conventional, Jumbo, USDA, Other). Use for "FHA vs VA vs Conventional" or high-level product mix.
- byPurpose: volume & count by purpose (Purchase, Cash-Out Refinance, NoCash-Out Refinance, etc). Purpose mix.
- byLock: count by lock status (Locked/NotLocked/Expired). Lock analysis.
- byYear: volume & count by year. Annual trends.
- byMonthYear: volume & count by YYYY-MM. Monthly time series trends.
- byYearState: year×state matrix (volume & count). Two-dimensional: "by year color coded by state".
- rateDistribution: count by rate bucket (<5%, 5-5.5%, 5.5-6%, 6-6.5%, 6.5-7%, 7-7.5%, 7.5-8%, >8%). Rate analysis.

Rules:
- NEVER include a "data" array. The server builds data from the source.
- sortBy: "desc" for rankings (biggest first), "asc" for time series (chronological).
- topN: max items. For time series (byYear/byMonthYear) this means "most recent N". Use 12 for monthly, 5-10 for yearly. For rankings: 5-15. For pie: omit (show all, <8 slices).
- For time+category (e.g. "volume by year by state"), use source="byYearState" with type="stacked-bar" or "multi-line".
- Use real numbers from the stats in your summary. Be specific (e.g. "$5.6B across 9,763 loans").
- Max 2 charts per response.
- If the question asks about something not in the available sources (e.g. "average days to close", "processor performance", "city-level data"), still pick the closest source and note the limitation in the summary.`;

// ── Check if RPC exists (cached) ──
let _rpcExists: boolean | null = null;

async function checkRpcExists(): Promise<boolean> {
  if (_rpcExists !== null) return _rpcExists;
  try {
    const { error } = await supabaseAdmin.rpc("execute_readonly_query", {
      query_text: "SELECT 1 AS test FROM pipeline_loans LIMIT 1",
    });
    _rpcExists = !error;
  } catch {
    _rpcExists = false;
  }
  return _rpcExists;
}

// ── Main handler ──

export async function POST(req: NextRequest) {
  try {
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const { question, filters } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    // Build filter context
    const filterParts: string[] = [];
    if (filters) {
      if (filters.state) filterParts.push(`state=${filters.state}`);
      if (filters.lo) filterParts.push(`lo=${filters.lo}`);
      if (filters.milestone) filterParts.push(`milestone=${filters.milestone}`);
      if (filters.program) filterParts.push(`program=${filters.program}`);
      if (filters.purpose) filterParts.push(`purpose=${filters.purpose}`);
      if (filters.lock) filterParts.push(`lock=${filters.lock}`);
      if (filters.dateFrom) filterParts.push(`dateFrom=${filters.dateFrom}`);
      if (filters.dateTo) filterParts.push(`dateTo=${filters.dateTo}`);
    }
    const filterNote = filterParts.length > 0 ? `\nActive filters: ${filterParts.join(", ")}` : "";

    // Try fast path (text-to-SQL) if RPC exists
    const rpcAvailable = await checkRpcExists();

    if (rpcAvailable) {
      return await fastPath(question, filterNote, filters);
    } else {
      return await fallbackPath(question, filters);
    }
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}

// ── Fast path: Text-to-SQL ──
async function fastPath(question: string, filterNote: string, filters?: Record<string, string>) {
  const { sampleText, totalCount } = await getSampleAndCount();
  if (totalCount === 0) {
    return NextResponse.json({ error: "No pipeline data available." }, { status: 503 });
  }

  // Step 1: Generate SQL with Claude Haiku (tiny payload)
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: buildSqlPrompt(sampleText, totalCount),
      messages: [{ role: "user", content: `${question}${filterNote}` }],
    }),
  });

  if (!res.ok) {
    // Fallback to pre-aggregated approach on API error
    return fallbackPath(question, filters);
  }

  const result = await res.json();
  const text = result.content?.[0]?.text || "";

  let aiResponse: {
    sql: string;
    chartConfig: {
      type: string;
      title: string;
      dataKey: string;
      nameKey: string;
      seriesKeys?: string[];
      formatValue?: string;
      pivotBy?: string;
      topN?: number;
    };
    summary?: string;
  };

  try {
    const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    aiResponse = JSON.parse(cleaned);
  } catch {
    return fallbackPath(question, filters);
  }

  if (!aiResponse.sql || !validateSQL(aiResponse.sql)) {
    return fallbackPath(question, filters);
  }

  // Step 2: Execute SQL on Supabase
  const { data: sqlData, error: sqlError } = await supabaseAdmin.rpc("execute_readonly_query", {
    query_text: aiResponse.sql,
  });

  if (sqlError) {
    _rpcExists = false; // Mark as unavailable
    return fallbackPath(question, filters);
  }

  const rows = (sqlData || []) as Record<string, unknown>[];
  const config = aiResponse.chartConfig;

  // Handle pivot for multi-series charts
  let chartData: Record<string, unknown>[] = rows;
  let seriesKeys = config.seriesKeys;

  if (config.pivotBy && rows.length > 0) {
    const pivoted = pivotResults(rows, config.nameKey, config.pivotBy, config.dataKey, config.topN);
    chartData = pivoted.data;
    seriesKeys = pivoted.seriesKeys;
  }

  // Build real summary from actual query results (not LLM placeholders)
  const summary = buildSummaryFromResults(config.title, chartData, {
    nameKey: config.nameKey || "name",
    dataKey: config.pivotBy ? "" : (config.dataKey || "value"),
    formatValue: config.formatValue,
    pivotBy: config.pivotBy,
  });

  return NextResponse.json({
    title: config.title,
    summary,
    charts: [{
      type: config.type || "bar",
      title: config.title,
      dataKey: config.pivotBy ? undefined : (config.dataKey || "value"),
      nameKey: config.nameKey || "name",
      data: chartData.slice(0, 30),
      fullData: chartData,
      seriesKeys,
      formatValue: config.formatValue || "number",
    }],
  });
}

// ── Server-side chart data builder ──

interface ChartBlueprint {
  type: string;
  title: string;
  source: string;
  valueField?: string;
  topN?: number;
  formatValue?: string;
  sortBy?: string;
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

function buildChartFromBlueprint(
  bp: ChartBlueprint,
  stats: AIContextStats,
): { data: Record<string, unknown>[]; fullData: Record<string, unknown>[]; seriesKeys?: string[]; nameKey: string; dataKey?: string } {
  const vf = bp.valueField || "volume";
  const topN = bp.topN || 15;
  const asc = bp.sortBy === "asc";

  // byYearState → pivoted stacked/multi-line chart
  if (bp.source === "byYearState") {
    // Get top N states by total value across all years
    const stateTotals: Record<string, number> = {};
    for (const states of Object.values(stats.byYearState)) {
      for (const [state, v] of Object.entries(states)) {
        stateTotals[state] = (stateTotals[state] || 0) + (vf === "volume" ? v.volume : v.units);
      }
    }
    const topStates = Object.entries(stateTotals)
      .sort((a, b) => b[1] - a[1])
      .slice(0, topN)
      .map(([k]) => k);

    const data = Object.entries(stats.byYearState)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([year, states]) => {
        const row: Record<string, unknown> = { name: year };
        for (const state of topStates) {
          const v = states[state];
          row[state] = v ? (vf === "volume" ? v.volume : v.units) : 0;
        }
        return row;
      });

    return { data, fullData: data, seriesKeys: topStates, nameKey: "name" };
  }

  // Count-only maps: byLock, rateDistribution
  if (bp.source === "byLock" || bp.source === "rateDistribution") {
    const src = bp.source === "byLock" ? stats.byLock : stats.rateDistribution;
    let entries: { name: string; value: number }[];
    if (bp.source === "rateDistribution") {
      // Sort rate buckets in natural order: <5%, 5-5.5%, ..., >8%
      const rateOrder = ["<5%", "5-5.5%", "5.5-6%", "6-6.5%", "6.5-7%", "7-7.5%", "7.5-8%", ">8%"];
      entries = rateOrder
        .filter((k) => src[k] !== undefined)
        .map((name) => ({ name, value: src[name] }));
    } else {
      entries = Object.entries(src)
        .sort((a, b) => asc ? a[1] - b[1] : b[1] - a[1])
        .slice(0, topN)
        .map(([name, value]) => ({ name, value }));
    }
    return { data: entries, fullData: entries, nameKey: "name", dataKey: "value" };
  }

  // Standard units+volume maps
  const sourceMap: Record<string, Record<string, { units: number; volume: number }> | undefined> = {
    byState: stats.byState,
    byLO: stats.byLO,
    byMilestone: stats.byMilestone,
    byProgram: stats.byProgram,
    byProgramGroup: stats.byProgramGroup,
    byPurpose: stats.byPurpose,
    byYear: stats.byYear,
    byMonthYear: stats.byMonthYear,
  };

  const src = sourceMap[bp.source];
  if (!src) {
    return { data: [], fullData: [], nameKey: "name", dataKey: "value" };
  }

  const isTimeSeries = bp.source === "byYear" || bp.source === "byMonthYear";
  const allEntries = Object.entries(src)
    .sort((a, b) => {
      if (isTimeSeries) return a[0].localeCompare(b[0]); // always chronological
      return asc ? a[1][vf === "volume" ? "volume" : "units"] - b[1][vf === "volume" ? "volume" : "units"]
                 : b[1][vf === "volume" ? "volume" : "units"] - a[1][vf === "volume" ? "volume" : "units"];
    });

  // For time series: topN means "last N entries" (most recent)
  const topEntries = isTimeSeries
    ? (topN && topN < allEntries.length ? allEntries.slice(-topN) : allEntries)
    : allEntries.slice(0, topN);
  const data = topEntries.map(([name, v]) => ({
    name,
    value: vf === "volume" ? v.volume : v.units,
    units: v.units,
    volume: v.volume,
  }));
  const fullData = allEntries.map(([name, v]) => ({
    name,
    value: vf === "volume" ? v.volume : v.units,
    units: v.units,
    volume: v.volume,
  }));

  return { data, fullData, nameKey: "name", dataKey: "value" };
}

// ── Fallback path: Blueprint approach ──
async function fallbackPath(question: string, filters?: Record<string, string>) {
  const { stats, totalLoans } = await getAIContext(question, filters);
  if (totalLoans === 0) {
    return NextResponse.json({ error: "No pipeline data available." }, { status: 503 });
  }

  // Build filter context
  const activeFilters: string[] = [];
  if (filters) {
    if (filters.state) activeFilters.push(`State: ${filters.state}`);
    if (filters.lo) activeFilters.push(`LO: ${filters.lo}`);
    if (filters.milestone) activeFilters.push(`Milestone: ${filters.milestone}`);
    if (filters.program) activeFilters.push(`Program: ${filters.program}`);
    if (filters.purpose) activeFilters.push(`Purpose: ${filters.purpose}`);
    if (filters.lock) activeFilters.push(`Lock: ${filters.lock}`);
    if (filters.dateFrom) activeFilters.push(`From: ${filters.dateFrom}`);
    if (filters.dateTo) activeFilters.push(`To: ${filters.dateTo}`);
  }
  const filterContext = activeFilters.length > 0
    ? `\nACTIVE FILTERS: ${activeFilters.join(", ")}`
    : "";

  // Build a compact stats summary for the LLM
  const avgLoanSize = stats.totalLoans > 0 ? Math.round(stats.totalVolume / stats.totalLoans) : 0;
  const statsSummary = {
    totalLoans: stats.totalLoans,
    totalVolume: stats.totalVolume,
    avgLoanSize,
    avgRate: Math.round(stats.avgRate * 1000) / 1000,
    topStates: Object.entries(stats.byState).sort((a, b) => b[1].volume - a[1].volume).slice(0, 15)
      .map(([k, v]) => `${k}: $${(v.volume / 1e6).toFixed(0)}M (${v.units})`),
    topLOs: Object.entries(stats.byLO).sort((a, b) => b[1].volume - a[1].volume).slice(0, 15)
      .map(([k, v]) => `${k}: $${(v.volume / 1e6).toFixed(0)}M (${v.units})`),
    milestones: Object.entries(stats.byMilestone).sort((a, b) => b[1].units - a[1].units)
      .map(([k, v]) => `${k}: ${v.units} ($${(v.volume / 1e6).toFixed(0)}M)`),
    programGroups: Object.entries(stats.byProgramGroup).sort((a, b) => b[1].volume - a[1].volume)
      .map(([k, v]) => `${k}: ${v.units} ($${(v.volume / 1e6).toFixed(0)}M)`),
    topPrograms: Object.entries(stats.byProgram).sort((a, b) => b[1].volume - a[1].volume).slice(0, 10)
      .map(([k, v]) => `${k}: ${v.units} ($${(v.volume / 1e6).toFixed(0)}M)`),
    purposes: Object.entries(stats.byPurpose).sort((a, b) => b[1].volume - a[1].volume)
      .map(([k, v]) => `${k}: ${v.units} ($${(v.volume / 1e6).toFixed(0)}M)`),
    locks: stats.byLock,
    rates: stats.rateDistribution,
    byYear: Object.entries(stats.byYear).sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}: ${v.units} loans ($${(v.volume / 1e6).toFixed(0)}M)`),
    recentMonths: Object.entries(stats.byMonthYear).sort(([a], [b]) => b.localeCompare(a)).slice(0, 6)
      .map(([k, v]) => `${k}: ${v.units} loans ($${(v.volume / 1e6).toFixed(0)}M)`),
    yearStateYears: Object.keys(stats.byYearState).sort(),
    yearStateTopStates: Object.entries(
      Object.values(stats.byYearState).reduce((acc, states) => {
        for (const [s, v] of Object.entries(states)) acc[s] = (acc[s] || 0) + v.volume;
        return acc;
      }, {} as Record<string, number>)
    ).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k]) => k),
  };

  const userContent = `${totalLoans.toLocaleString()} loans${filterContext}

STATS SUMMARY:
${JSON.stringify(statsSummary)}

Question: ${question}`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY!,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: FALLBACK_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    return NextResponse.json({ error: `Claude API: ${res.status}`, detail: errText.slice(0, 300) }, { status: 502 });
  }

  const result = await res.json();
  const text = result.content?.[0]?.text || "";

  let blueprint: { title: string; summary: string; charts: ChartBlueprint[] };
  try {
    let cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    if (!cleaned.startsWith("{")) {
      const idx = cleaned.indexOf("{");
      if (idx >= 0) cleaned = cleaned.slice(idx);
    }
    if (!cleaned.endsWith("}")) {
      const last = cleaned.lastIndexOf("}");
      if (last > 0) cleaned = cleaned.slice(0, last + 1);
    }
    blueprint = JSON.parse(cleaned);
  } catch {
    return NextResponse.json({ error: "Failed to parse AI response", raw: text.slice(0, 500) }, { status: 500 });
  }

  // Build actual chart data from the blueprint + stats
  const charts = (blueprint.charts || []).slice(0, 3).map((bp) => {
    const built = buildChartFromBlueprint(bp, stats);
    return {
      type: bp.type || "bar",
      title: bp.title || blueprint.title,
      dataKey: built.dataKey || (built.seriesKeys ? undefined : "value"),
      nameKey: built.nameKey,
      data: built.data,
      fullData: built.fullData,
      seriesKeys: built.seriesKeys,
      formatValue: bp.formatValue || "number",
    };
  });

  return NextResponse.json({
    title: blueprint.title,
    summary: blueprint.summary,
    charts,
  });
}
