import { NextRequest, NextResponse } from "next/server";
import { searchPipelineWithFilters } from "@/lib/encompass";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are a filter builder for the Encompass Loan Pipeline API. Given a natural language query about mortgage loans, you produce a JSON filter object.

Today's date is ${new Date().toISOString().slice(0, 10)}.

## Available Filter Fields (canonicalName values)

### Loan Info
- Loan.LoanNumber — loan number (string, e.g. "2501234")
- Loan.LoanAmount — loan amount in dollars (numeric, e.g. "500000")
- Loan.LoanProgram — loan program (string, e.g. "Conventional", "FHA", "VA", "USDA")
- Loan.LoanPurpose — purpose (string: "Purchase", "NoCash-Out Refinance", "Cash-Out Refinance")
- Loan.LienPosition — lien position (string: "FirstLien", "SecondLien")
- Loan.Channel — channel (string, e.g. "Retail", "Wholesale", "Correspondent")
- Loan.NoteRatePercent — interest rate as percent (numeric, e.g. "6.875")

### Status
- Loan.CurrentMilestoneName — current milestone (string, e.g. "Started", "Processing", "Submittal", "Approval", "Docs Out", "Funding", "Purchased", "Reconciled", "Shipping", "Adverse Action", "Pre-Approval Review")
- Loan.LoanFolder — folder name (string, e.g. "My Pipeline", "Completed Loans")
- Loan.LockStatus — lock status (string: "Locked", "Not Locked", "Lock Expired")

### Property (IMPORTANT: use Field ID format for property filters)
- Fields.14 — property state, 2-letter code (e.g. "NC", "TX", "CA")
- Fields.12 — property city name
- Fields.15 — property zip code
- Fields.13 — property county

### Team
- Loan.LoanOfficerName — loan officer full name
- Loan.LoanProcessorName — loan processor full name

### Dates (format: "MM/DD/YYYY")
- Loan.DateCreated — application / creation date
- Loan.LastModified — last modified date
- Fields.748 — closing / COE date
- Loan.LockExpirationDate — rate lock expiration date
- Fields.745 — application date (alternative)

## Match Types
- "exact" — exact match
- "contains" — substring match (for text fields)
- "greaterThan", "greaterThanOrEquals" — for dates and numbers
- "lessThan", "lessThanOrEquals" — for dates and numbers
- "notEquals" — not equal
- "isEmpty" — field is empty
- "isNotEmpty" — field has a value

## Filter Structure

A single condition:
{ "canonicalName": "Fields.14", "value": "NC", "matchType": "exact", "include": true }

Multiple conditions combined:
{ "operator": "and", "terms": [ ...conditions ] }

Or conditions:
{ "operator": "or", "terms": [ ...conditions ] }

## Sort Order (optional)
[{ "canonicalName": "Loan.LastModified", "order": "desc" }]

## Rules
- ALWAYS set "include": true for positive matches, false for exclusions
- For date ranges use TWO conditions (greaterThanOrEquals + lessThanOrEquals)
- For amount ranges use TWO conditions
- State should be 2-letter uppercase code (NC, TX, CA, FL, etc.)
- For "after date X" use greaterThanOrEquals; for "before date X" use lessThanOrEquals
- When user says "this month" or "this week", calculate the actual date range
- When user says "closing soon" or "expiring soon", use the next 7 days
- Default sort by LastModified desc unless user specifies otherwise

## Response Format
Return ONLY valid JSON with this structure (no markdown, no explanation):
{
  "filter": <filter object>,
  "sortOrder": [{ "canonicalName": "...", "order": "asc|desc" }],
  "description": "<brief human-readable description of what the filter does>"
}`;

export async function POST(req: NextRequest) {
  try {
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json(
        { error: "ANTHROPIC_API_KEY not configured" },
        { status: 500 },
      );
    }

    const { query } = await req.json();
    if (!query || typeof query !== "string") {
      return NextResponse.json(
        { error: "Missing query" },
        { status: 400 },
      );
    }

    // Call Claude to build the filter
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: query }],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      return NextResponse.json(
        { error: `Claude API error: ${claudeRes.status} - ${errText.slice(0, 300)}` },
        { status: 502 },
      );
    }

    const claudeData = await claudeRes.json();
    const responseText =
      claudeData.content?.[0]?.text || "";

    // Parse the JSON from Claude's response
    let parsed: { filter: unknown; sortOrder?: unknown[]; description?: string };
    try {
      // Strip any markdown fencing if present
      const jsonStr = responseText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(jsonStr);
    } catch {
      return NextResponse.json(
        { error: "Failed to parse AI response", raw: responseText },
        { status: 500 },
      );
    }

    // Query Encompass with the AI-built filter
    const rows = await searchPipelineWithFilters(
      parsed.filter,
      parsed.sortOrder,
      0,
      200,
    );

    return NextResponse.json({
      rows: Array.isArray(rows) ? rows : [],
      description: parsed.description || "AI-filtered results",
      filterUsed: parsed.filter,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "AI search failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
