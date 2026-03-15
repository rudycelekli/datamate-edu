import { NextRequest, NextResponse } from "next/server";
import { ensureReady, getAIContext } from "@/lib/pipeline-cache";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are a mortgage analytics AI for Premier Lending. You receive PRE-AGGREGATED pipeline statistics (covering the FULL pipeline of all loans) plus a stratified sample, and answer user questions by returning a JSON object that describes the chart(s) to render and the processed data.

Today is ${new Date().toISOString().slice(0, 10)}.

## Data Format
You receive:
1. **stats**: Pre-aggregated breakdowns of ALL loans in the pipeline:
   - totalLoans, totalVolume
   - byMilestone: { [name]: { units, volume } }
   - byState: { [code]: { units, volume } }
   - byProgram: { [name]: { units, volume } }
   - byPurpose: { [name]: { units, volume } }
   - byLO: { [name]: { units, volume } }
   - byLock: { [status]: count }
   - avgRate: weighted average interest rate
   - rateDistribution: { [bucket]: count }

2. **sample**: ~200 representative loans with fields: amt, prog, purp, ms, lo, lock, rate, st, dt, lien, ln, channel, closingDate, lockExp, modified

## IMPORTANT
- The stats cover ALL loans (30,000-70,000+), not just the sample.
- Use the pre-aggregated stats for any aggregate questions (totals, breakdowns, comparisons).
- Only use the sample for questions about individual loan patterns or distributions that aren't covered by stats.

## Response Format
Return ONLY valid JSON (no markdown fencing). The response must have:
{
  "title": "Chart title (short)",
  "summary": "1-2 sentence insight answering the question",
  "charts": [
    {
      "type": "bar" | "pie" | "line" | "horizontal-bar" | "table",
      "title": "Individual chart title",
      "dataKey": "the numeric field name in data items",
      "nameKey": "the label/category field name",
      "data": [ { "name": "Category", "value": 123 }, ... ],
      "fullData": [ ... same structure but ALL rows, not limited to top N ... ],
      "secondaryDataKey": "optional second numeric field for dual-axis",
      "formatValue": "currency" | "number" | "percent" | "rate"
    }
  ]
}

## Rules
- Use the pre-aggregated stats to answer. Convert them into chart data arrays.
- Return 1-3 charts maximum per question.
- For currency values use raw numbers (not formatted strings).
- ALWAYS sort the data array in the response. Sort descending by the primary numeric value (largest first) for bar/horizontal-bar/pie/table charts. Sort chronologically for line/time-series charts.
- Limit "data" for bar/horizontal-bar charts to top 15-20 items max for readability.
- ALWAYS include a "fullData" array with ALL aggregated rows (no limit), sorted the same way.
- For tables, use type "table" and data as array of objects with column keys.
- Always provide a clear summary with specific numbers.
- If the question is about comparison, use multiple datasets or charts.`;

export async function POST(req: NextRequest) {
  try {
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const { question } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    // Read from server cache (non-blocking warmup)
    const ready = ensureReady();
    if (!ready) {
      return NextResponse.json({ error: "Pipeline cache is still warming up. Please try again in a minute." }, { status: 503 });
    }
    const { stats, sample, totalLoans } = getAIContext(question);

    const userContent = `Pipeline statistics (${totalLoans.toLocaleString()} total loans):

AGGREGATED STATS:
${JSON.stringify(stats, null, 0)}

SAMPLE (${sample.length} representative loans):
${JSON.stringify(sample)}

Question: ${question}`;

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: userContent,
        }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Claude API: ${res.status}`, detail: errText.slice(0, 300) }, { status: 502 });
    }

    const result = await res.json();
    const text = result.content?.[0]?.text || "";

    // Parse JSON from response
    let parsed;
    try {
      const cleaned = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      return NextResponse.json({ error: "Failed to parse AI response", raw: text.slice(0, 500) }, { status: 500 });
    }

    return NextResponse.json(parsed);
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
