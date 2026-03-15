import { NextRequest, NextResponse } from "next/server";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function POST(req: NextRequest) {
  try {
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY not configured" }, { status: 500 });
    }

    const { chartName, data, totalUnits, totalVolume } = await req.json();

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 800,
        system: `You are a mortgage lending analytics expert analyzing pipeline data for Premier Lending. Today is ${new Date().toISOString().slice(0, 10)}. Give concise, actionable insights with specific numbers. Use bullet points. Focus on trends, outliers, risks, and opportunities. Do NOT use markdown headers.`,
        messages: [{
          role: "user",
          content: `Analyze this "${chartName}" data from our mortgage pipeline.\n\nTotal pipeline: ${totalUnits} loans, $${(totalVolume / 1e6).toFixed(1)}M volume.\n\nData:\n${JSON.stringify(data, null, 2)}\n\nProvide 3-5 key insights with specific numbers and actionable recommendations.`,
        }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Claude API: ${res.status}`, detail: errText.slice(0, 200) }, { status: 502 });
    }

    const result = await res.json();
    const insight = result.content?.[0]?.text || "No insight generated";

    return NextResponse.json({ insight });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Failed" }, { status: 500 });
  }
}
