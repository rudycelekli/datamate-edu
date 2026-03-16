import { NextRequest } from "next/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `You are a senior mortgage pipeline strategist and data analyst at a lending company. You analyze loan pipeline data to uncover trends, risks, and opportunities that would take human analysts weeks or months to discover.

Today is ${new Date().toISOString().slice(0, 10)}.

You will receive the complete pipeline statistics as JSON. Produce a comprehensive strategic analysis with EXACTLY these 5 sections, using markdown formatting:

## 1. Pipeline Health by Milestone Stage

Analyze the pipeline flow across all milestone stages. Group them into:
- **Early Pipeline** (leads, pre-qualification, application)
- **Active Processing** (processing, submitted, underwriting)
- **Approval & Closing** (approved, clear to close, docs, funding)
- **Post-Close** (purchased, shipped, completed)

For each group, assess volume, conversion health, and bottlenecks. Use specific numbers from the data.

## 2. Trend Discovery & Pattern Analysis

Identify non-obvious patterns across these dimensions:
- **Momentum**: Are monthly trends accelerating or decelerating? Calculate month-over-month changes.
- **Program Shifts**: Is the mix between Conventional/FHA/VA/USDA changing? What does it signal?
- **Geographic Concentration**: Is volume too concentrated in a few states? Diversification risk?
- **Rate Clusters**: Where are loans clustering in the rate distribution? What does this mean for lock strategy?
- **LO Concentration**: Is production concentrated in a few officers? Retention risk?
- **Lock Health**: What percentage is locked vs unlocked vs expired? Pipeline risk assessment.

Use specific numbers and percentages. Calculate ratios the raw data doesn't show directly.

## 3. Risk Alerts & Red Flags

Categorize findings as:
- **CRITICAL** — Requires immediate action (use ⚠️)
- **WARNING** — Monitor closely this week (use ⚡)
- **ADVISORY** — Strategic consideration (use 📋)

Each alert must cite specific data points. Examples: lock expiration rates, LO concentration above 30%, geographic over-reliance, pipeline stage bottlenecks, rate exposure.

## 4. Strategic Recommendations

Provide 5-7 numbered, specific, actionable recommendations. Each must include:
- What to do
- Why (backed by data from the analysis)
- Expected impact (qualitative estimate)

## 5. Deep Dive

DEEP_DIVE_INSTRUCTION

---

Format rules:
- Use **bold** for key numbers, thresholds, and important terms
- Use markdown tables where comparisons help (e.g., program mix, stage flow)
- Use bullet points and numbered lists for clarity
- Keep each section substantive — this is an executive briefing, not a summary
- Do NOT use generic advice — every statement must reference specific data points from the provided stats
- Write 2000-3000 words total`;

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let stats: Record<string, unknown>;
  let focus: { milestone?: string; state?: string; lo?: string; topic?: string } = {};
  let filters: Record<string, string> = {};

  try {
    const body = await req.json();
    stats = body.stats;
    focus = body.focus || {};
    filters = body.filters || {};
    if (!stats) {
      return new Response(JSON.stringify({ error: "stats required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Build focus instructions for Section 5 deep dive
  let deepDiveInstruction: string;
  if (focus.topic) {
    deepDiveInstruction = `The user wants a deep dive on this specific topic: "${focus.topic}". Analyze it thoroughly using the pipeline data, providing unique insights and actionable findings.`;
  } else {
    deepDiveInstruction = `Pick ONE surprising or counter-intuitive finding from the data that most analysts would miss. Dive deep into it — explain what it means, why it matters, and what action to take. Make it genuinely insightful, not obvious.`;
  }

  // Build focus weighting instructions
  const focusInstructions: string[] = [];
  if (focus.milestone) focusInstructions.push(`Pay special attention to the "${focus.milestone}" milestone stage — weight your analysis toward loans in this stage.`);
  if (focus.state) focusInstructions.push(`Focus especially on the state "${focus.state}" — highlight its performance, trends, and how it compares to other states.`);
  if (focus.lo) focusInstructions.push(`Focus especially on loan officer "${focus.lo}" — analyze their performance, pipeline health, and compare to peers.`);

  // Build filter context
  const activeFilters: string[] = [];
  if (filters.state) activeFilters.push(`State: ${filters.state}`);
  if (filters.lo) activeFilters.push(`LO: ${filters.lo}`);
  if (filters.milestone) activeFilters.push(`Milestone: ${filters.milestone}`);
  if (filters.program) activeFilters.push(`Program: ${filters.program}`);
  if (filters.purpose) activeFilters.push(`Purpose: ${filters.purpose}`);
  if (filters.lock) activeFilters.push(`Lock: ${filters.lock}`);
  if (filters.dateFrom) activeFilters.push(`From: ${filters.dateFrom}`);
  if (filters.dateTo) activeFilters.push(`To: ${filters.dateTo}`);

  const systemPrompt = SYSTEM_PROMPT.replace("DEEP_DIVE_INSTRUCTION", deepDiveInstruction)
    + (focusInstructions.length > 0 ? `\n\n## Focus Instructions\n${focusInstructions.join("\n")}` : "")
    + (activeFilters.length > 0 ? `\n\n## Active Filters\nThe user is viewing a FILTERED subset of the pipeline: ${activeFilters.join(", ")}. Note this in your analysis — your findings apply to this filtered view, not the entire pipeline.` : "");

  const userMessage = `Here is the complete pipeline data to analyze:\n\n${JSON.stringify(stats, null, 2)}`;

  let claudeRes: Response;
  try {
    claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 4096,
        stream: true,
        system: systemPrompt,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `API call failed: ${err instanceof Error ? err.message : "Unknown"}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    console.error("Deep analysis API error:", claudeRes.status, errText.slice(0, 500));
    return new Response(JSON.stringify({ error: `Claude API ${claudeRes.status}`, detail: errText.slice(0, 300) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Forward SSE stream as plain text (same pattern as Milo chat)
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = claudeRes.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const data = line.slice(6).trim();
            if (data === "[DONE]") continue;
            try {
              const parsed = JSON.parse(data);
              if (parsed.type === "content_block_delta" && parsed.delta?.type === "text_delta") {
                controller.enqueue(encoder.encode(parsed.delta.text));
              }
            } catch {
              // skip malformed lines
            }
          }
        }
      } catch (err) {
        console.error("Deep analysis stream error:", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
