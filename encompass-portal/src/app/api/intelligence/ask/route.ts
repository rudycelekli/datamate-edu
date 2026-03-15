import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are a mortgage analytics AI for Premier Lending. You receive the full pipeline dataset and answer user questions by returning a JSON object that describes the chart(s) to render and the processed data.

Today is ${new Date().toISOString().slice(0, 10)}.

## Available Encompass Fields in the Data
Each loan row has a "fields" object with these keys (may be empty):
- Loan.LoanNumber - loan number
- Loan.LoanAmount - dollar amount (string)
- Loan.LoanProgram - e.g. "Conventional", "FHA", "VA"
- Loan.LoanPurpose - "Purchase", "NoCash-Out Refinance", "Cash-Out Refinance"
- Loan.CurrentMilestoneName - pipeline stage
- Loan.LoanOfficerName - LO name
- Loan.LockStatus - "Locked", "Not Locked", "Lock Expired"
- Loan.NoteRatePercent - interest rate
- Loan.SubjectPropertyState or Fields.14 - state code (2-letter)
- Loan.DateCreated - creation date
- Loan.LastModified - last modified
- Loan.LienPosition - "FirstLien", "SecondLien"
- Loan.BorrowerName - borrower name
- Loan.Channel - channel

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
- Analyze the RAW pipeline data provided. Do the aggregation yourself.
- Return 1-3 charts maximum per question.
- For currency values use raw numbers (not formatted strings).
- Group/aggregate data appropriately (by state, LO, program, milestone, etc.).
- ALWAYS sort the data array in the response. Sort descending by the primary numeric value (largest first) for bar/horizontal-bar/pie/table charts. Sort chronologically for line/time-series charts. Never return unsorted data.
- Limit "data" for bar/horizontal-bar charts to top 15-20 items max for readability.
- ALWAYS include a "fullData" array with ALL aggregated rows (no limit), sorted the same way. This is used for the underlying data table and CSV export. If no truncation is needed (e.g. pie with 5 slices), fullData can equal data.
- For tables, use type "table" and data as array of objects with column keys.
- Always provide a clear summary with specific numbers.
- If the question is about comparison, use multiple datasets or charts.`;

export async function POST(req: NextRequest) {
  try {
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const { question, pipelineData } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Missing question" }, { status: 400 });
    }

    // Build a compact summary of the pipeline data to fit in context
    const rows = Array.isArray(pipelineData) ? pipelineData : [];
    const compactRows = rows.slice(0, 500).map((r: { fields?: Record<string, string> }) => {
      const f = r.fields || {};
      return {
        amt: f["Loan.LoanAmount"] || "",
        prog: f["Loan.LoanProgram"] || "",
        purp: f["Loan.LoanPurpose"] || "",
        ms: f["Loan.CurrentMilestoneName"] || "",
        lo: f["Loan.LoanOfficerName"] || "",
        lock: f["Loan.LockStatus"] || "",
        rate: f["Loan.NoteRatePercent"] || "",
        st: f["Loan.SubjectPropertyState"] || f["Fields.14"] || "",
        dt: f["Loan.DateCreated"] || "",
        lien: f["Loan.LienPosition"] || "",
        ln: f["Loan.LoanNumber"] || "",
      };
    });

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
          content: `Pipeline data (${rows.length} loans):\n${JSON.stringify(compactRows)}\n\nQuestion: ${question}`,
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
