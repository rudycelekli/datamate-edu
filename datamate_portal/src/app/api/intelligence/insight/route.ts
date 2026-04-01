import { NextRequest, NextResponse } from "next/server";
import { DOMAIN_CONTEXT } from "@/lib/domain-knowledge";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function POST(req: NextRequest) {
  try {
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 500 });
    }

    const { chartName, data, totalRegistros, totalMonto } = await req.json();

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
        system: `Eres un experto analista de gastos educativos para la Superintendencia de Educacion de Chile. Hoy es ${new Date().toISOString().slice(0, 10)}.

${DOMAIN_CONTEXT}

Proporciona insights concisos y accionables con numeros especificos. Usa viñetas. Enfocate en tendencias, anomalias, riesgos y oportunidades. Cuando sea relevante, referencia los 13 indicadores SIE por nombre y numero. NO uses encabezados markdown. Responde SIEMPRE en español.`,
        messages: [{
          role: "user",
          content: `Analiza estos datos de "${chartName}" de gastos educativos de sostenedores.\n\nTotal: ${totalRegistros} registros, $${(totalMonto / 1e6).toFixed(1)}M monto total.\n\nDatos:\n${JSON.stringify(data, null, 2)}\n\nProporciona 3-5 insights clave con numeros especificos y recomendaciones accionables. Referencia indicadores SIE relevantes.`,
        }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Claude API: ${res.status}`, detail: errText.slice(0, 200) }, { status: 502 });
    }

    const result = await res.json();
    const insight = result.content?.[0]?.text || "No se genero insight";

    return NextResponse.json({ insight });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
