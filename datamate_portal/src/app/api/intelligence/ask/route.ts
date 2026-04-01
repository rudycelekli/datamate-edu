import { NextRequest, NextResponse } from "next/server";
import { getAIContext } from "@/lib/desafio-queries";
import { DOMAIN_CONTEXT } from "@/lib/domain-knowledge";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * AI chat for education analytics on Intelligence page.
 * Uses pre-aggregated stats from ALL tables to answer questions about education spending.
 */

const SYSTEM_PROMPT = `Eres un analista de datos educativos experto para la Superintendencia de Educacion de Chile.

Hoy es ${new Date().toISOString().slice(0, 10)}.

${DOMAIN_CONTEXT}

## Tu Tarea
Recibes estadisticas pre-agregadas de gastos educativos de TODAS las tablas (estado_resultado, documentos, remuneraciones) y respondes con configuraciones de graficos.

Retorna SOLO JSON valido (sin markdown):
{
  "title": "Titulo del grafico",
  "summary": "1-2 oraciones de insight con numeros reales. Referencia indicadores SIE cuando sea relevante.",
  "charts": [{
    "type": "bar"|"pie"|"line"|"horizontal-bar"|"table",
    "title": "Titulo",
    "source": "<nombre de fuente>",
    "valueField": "monto"|"count",
    "topN": 10,
    "formatValue": "currency"|"number"|"percent",
    "sortBy": "desc"|"asc"
  }]
}

Fuentes disponibles (estado_resultado):
- byRegion: monto y count por region. Rankings geograficos.
- byDependencia: monto y count por tipo de dependencia (M/CM/SLEP/PS).
- byPeriodo: monto y count por periodo. Series de tiempo.
- byCuenta: monto y count por tipo de cuenta. Distribucion de gastos.
- bySubvencion: monto y count por tipo de subvencion.
- byTipoCuenta: monto y count por tipo de cuenta (Ingreso vs Gasto).

Fuentes adicionales (documentos):
- documentos.byTipoDocumento: monto y count por tipo de documento (BOL, FAC, BHE, etc.).

Datos de remuneraciones disponibles:
- remuneraciones.totalHaber, totalDescuento, totalLiquido, promedioLiquido
- remuneraciones.proporcionRemuneracionesSobreGasto (indicador #9)

Reglas:
- NUNCA incluyas un array "data". El servidor construye los datos.
- sortBy: "desc" para rankings, "asc" para series de tiempo.
- Usa numeros reales del resumen en tu summary.
- Cuando sea relevante, referencia los 13 indicadores SIE por nombre.
- Señala anomalias y riesgos proactivamente.
- Max 2 graficos por respuesta.
- Responde SIEMPRE en español.`;

export async function POST(req: NextRequest) {
  try {
    if (!ANTHROPIC_API_KEY) {
      return NextResponse.json({ error: "ANTHROPIC_API_KEY no configurada" }, { status: 500 });
    }

    const { question, filters } = await req.json();
    if (!question || typeof question !== "string") {
      return NextResponse.json({ error: "Falta la pregunta" }, { status: 400 });
    }

    const { stats, totalRows } = await getAIContext(question, filters);
    if (totalRows === 0) {
      return NextResponse.json({ error: "No hay datos disponibles." }, { status: 503 });
    }

    const statsSummary = JSON.stringify(stats);

    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{
          role: "user",
          content: `${totalRows} registros.\n\nESTADISTICAS:\n${statsSummary}\n\nPregunta: ${question}`,
        }],
      }),
    });

    if (!res.ok) {
      const errText = await res.text();
      return NextResponse.json({ error: `Claude API: ${res.status}`, detail: errText.slice(0, 300) }, { status: 502 });
    }

    const result = await res.json();
    const text = result.content?.[0]?.text || "";

    let blueprint: { title: string; summary: string; charts: Array<{
      type: string; title: string; source: string;
      valueField?: string; topN?: number; formatValue?: string; sortBy?: string;
    }> };

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
      return NextResponse.json({ error: "Error al procesar respuesta AI", raw: text.slice(0, 500) }, { status: 500 });
    }

    // Build chart data from blueprint + stats
    const aiStats = stats as Record<string, Record<string, { count: number; monto: number }>>;
    const charts = (blueprint.charts || []).slice(0, 3).map((bp) => {
      const src = aiStats[bp.source];
      if (!src || typeof src !== "object") {
        return { type: bp.type, title: bp.title, data: [], nameKey: "name", dataKey: "value", formatValue: bp.formatValue || "number" };
      }

      const vf = bp.valueField || "monto";
      const asc = bp.sortBy === "asc";
      const topN = bp.topN || 15;

      const entries = Object.entries(src)
        .map(([name, v]) => ({
          name,
          value: vf === "monto" ? (v.monto || 0) : (v.count || 0),
          count: v.count || 0,
          monto: v.monto || 0,
        }))
        .sort((a, b) => asc ? a.value - b.value : b.value - a.value)
        .slice(0, topN);

      return {
        type: bp.type || "bar",
        title: bp.title || blueprint.title,
        dataKey: "value",
        nameKey: "name",
        data: entries,
        fullData: entries,
        formatValue: bp.formatValue || "number",
      };
    });

    return NextResponse.json({
      title: blueprint.title,
      summary: blueprint.summary,
      charts,
    });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Error" }, { status: 500 });
  }
}
