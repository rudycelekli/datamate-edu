import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase";
import { dbRowToPipelineRow, type DbRow } from "@/lib/encompass-to-db";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const TABLE_SCHEMA = `Table: pipeline_loans (PostgreSQL) — Mortgage pipeline data

Columns (ALL available):
  loan_guid TEXT PRIMARY KEY
  loan_number TEXT (e.g. '503432825')
  borrower_first TEXT, borrower_last TEXT (borrower name)
  co_borrower_first TEXT, co_borrower_last TEXT
  loan_amount NUMERIC (dollar amount, e.g. 450000)
  note_rate NUMERIC (interest rate %, e.g. 6.875)
  date_created TEXT (ISO datetime — loan origination date)
  application_date TEXT (ISO datetime)
  closing_date TEXT (ISO datetime — loan closing/funding date)
  last_modified TEXT (ISO datetime)
  milestone TEXT (pipeline stage: 'Started','Setup','Processing','Submittal','Submission Review','Approval','Conditional Approval','Docs Out','Docs Back','Funding','Purchased','Completion','Shipping','Reconciled','Packaging','Qualification','Registered','Lender Submission','Lender Approval','Lender Funding','Lender Payout','UW Review','Trailing Docs','Ready for Docs','Ready for Purchase')
  loan_officer TEXT (full name, e.g. 'John Smith')
  loan_processor TEXT (full name)
  property_state TEXT (2-letter code: 'CA','TX','AZ','NC','FL', etc.)
  property_city TEXT
  property_zip TEXT
  property_address TEXT
  loan_program TEXT (many variations — use ILIKE for matching, e.g. '%fha%', '%va %', '%conv%')
  loan_purpose TEXT ('Purchase','NoCash-Out Refinance','Cash-Out Refinance','ConstructionToPermanent','Other')
  lien_position TEXT ('FirstLien','SecondLien')
  lock_status TEXT ('Locked','NotLocked','Expired')
  lock_expiration TEXT (ISO datetime)
  loan_folder TEXT ('My Pipeline','Prospects','Completed','Cancelled - Not Audited', etc.)
  channel TEXT
  loan_status TEXT`;

function buildPrompt(totalCount: number, activeFilters: string) {
  return `You are a SQL generator for a mortgage loan pipeline. Convert natural language queries into PostgreSQL SELECT statements.

Today is ${new Date().toISOString().slice(0, 10)}.

${TABLE_SCHEMA}

Total rows: ~${totalCount.toLocaleString()}

## CRITICAL RULES:
1. ALWAYS return SELECT * FROM pipeline_loans WHERE ... — we need ALL columns to display individual loans in a table. NEVER use GROUP BY or aggregate functions.
2. Do NOT add a LIMIT clause — the user wants to see ALL matching loans. Only add LIMIT if the user explicitly asks for a specific count (e.g. "show me 10 loans").
3. For name searches, use ILIKE with % wildcards (e.g. loan_officer ILIKE '%faris%').
4. For "completed" loans, check: loan_folder ILIKE '%completed%' OR loan_folder ILIKE '%closed%' OR milestone IN ('Purchased','Reconciled','Shipping','Completion','Funding').
5. For date filtering, dates are ISO format (e.g. '2025-01-01'). Use substring or casting as needed.
6. Default ORDER BY last_modified DESC unless the user specifies otherwise.
7. NEVER use functions that don't exist in PostgreSQL. Use standard SQL only.
8. For "closing this month" or date ranges, use: closing_date >= '2025-03-01' AND closing_date < '2025-04-01' style comparisons.
9. For "locked" loans: lock_status = 'Locked'.
10. Program types: use ILIKE patterns — '%fha%' for FHA, loan_program ILIKE '%va %' OR loan_program ILIKE 'va %' for VA, '%conv%' for Conventional, '%jumbo%' for Jumbo.
11. For "top producers" or "top LOs", return loans by the highest-volume officers: ORDER BY loan_amount DESC (show their largest loans first). Do NOT aggregate.
12. For "largest loans" or "biggest deals", just ORDER BY loan_amount DESC.

${activeFilters ? `## ACTIVE PIPELINE FILTERS (incorporate these as additional WHERE conditions):
${activeFilters}` : ""}

## Response Format
Return ONLY valid JSON (no markdown, no explanation):
{
  "sql": "SELECT * FROM pipeline_loans WHERE ... ORDER BY ... LIMIT 500",
  "description": "Brief human-readable description of what this query finds"
}`;
}

let _cachedCount = 0;
let _cachedCountAt = 0;

async function getTotalCount(): Promise<number> {
  if (_cachedCount > 0 && Date.now() - _cachedCountAt < 300_000) return _cachedCount;
  const { count } = await supabaseAdmin
    .from("pipeline_loans")
    .select("loan_guid", { count: "exact", head: true });
  _cachedCount = count || 0;
  _cachedCountAt = Date.now();
  return _cachedCount;
}

export async function POST(req: NextRequest) {
  try {
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const body = await req.json();
    const { query, filters } = body;
    if (!query || typeof query !== "string") {
      return NextResponse.json({ error: "Missing query" }, { status: 400 });
    }

    // Build active filter description for the LLM
    let activeFilters = "";
    if (filters) {
      const parts: string[] = [];
      if (filters.milestone) parts.push(`milestone = '${filters.milestone}'`);
      if (filters.lo) parts.push(`loan_officer = '${filters.lo}'`);
      if (filters.state) parts.push(`property_state = '${filters.state}'`);
      if (filters.purpose) parts.push(`loan_purpose = '${filters.purpose}'`);
      if (filters.lock) parts.push(`lock_status = '${filters.lock}'`);
      if (filters.program) parts.push(`loan_program = '${filters.program}'`);
      if (filters.amountMin) parts.push(`loan_amount >= ${filters.amountMin}`);
      if (filters.amountMax) parts.push(`loan_amount <= ${filters.amountMax}`);
      if (filters.rateMin) parts.push(`note_rate >= ${filters.rateMin}`);
      if (filters.rateMax) parts.push(`note_rate <= ${filters.rateMax}`);
      if (filters.dateFrom) parts.push(`date_created >= '${filters.dateFrom}'`);
      if (filters.dateTo) parts.push(`date_created <= '${filters.dateTo}T23:59:59'`);
      if (parts.length > 0) activeFilters = parts.join("\n");
    }

    const totalCount = await getTotalCount();

    // Call Haiku to generate SQL
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 512,
        system: buildPrompt(totalCount, activeFilters),
        messages: [{ role: "user", content: query }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return NextResponse.json(
        { error: `AI error: ${claudeRes.status} - ${errText.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const claudeData = await claudeRes.json();
    const responseText = claudeData.content?.[0]?.text || "";

    // Parse JSON response
    let parsed: { sql: string; description?: string };
    try {
      const jsonStr = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response", raw: responseText },
        { status: 500 },
      );
    }

    // Validate: must be a SELECT query
    const sql = (parsed.sql || "").trim();
    if (!sql.toUpperCase().startsWith("SELECT")) {
      return NextResponse.json(
        { error: "AI generated a non-SELECT query", raw: sql },
        { status: 400 },
      );
    }

    // Execute via RPC
    const { data, error } = await supabaseAdmin.rpc("execute_readonly_query", {
      query_text: sql,
    });

    if (error) {
      // If RPC fails, try direct Supabase query as fallback
      console.error("RPC failed:", error.message, "SQL:", sql);
      return NextResponse.json(
        { error: `Query failed: ${error.message}`, sql },
        { status: 500 },
      );
    }

    // Convert DB rows to PipelineRow format for the frontend
    const dbRows = (data || []) as DbRow[];
    const pipelineRows = dbRows.map((r) => dbRowToPipelineRow(r));

    return NextResponse.json({
      rows: pipelineRows,
      description: parsed.description || "AI-filtered results",
      total: pipelineRows.length,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "AI search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
