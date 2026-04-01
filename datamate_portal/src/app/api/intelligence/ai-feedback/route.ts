import { NextRequest } from "next/server";
import { DOMAIN_CONTEXT } from "@/lib/domain-knowledge";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `Eres un auditor financiero experto de la Superintendencia de Educacion de Chile. Analizas datos de riesgo de sostenedores educacionales individuales.

Hoy es ${new Date().toISOString().slice(0, 10)}.

${DOMAIN_CONTEXT}

## Umbrales de Riesgo para los Indicadores

### Indicador #4: Concentracion del Gasto Administrativo
- OK: < 35% del gasto total
- ALERTA: 35-50% del gasto total
- CRITICO: > 50% del gasto total

### Indicador #9: Gasto Remuneracional sobre Ingreso Depurado
- OK: < 80% (normal 67-72%)
- ALERTA: 80-95%
- CRITICO: > 95%

### Balance Financiero
- OK: superavit o equilibrio
- ALERTA: deficit < 20%
- CRITICO: deficit > 20% sobre ingresos

Analiza el sostenedor proporcionado y responde con EXACTAMENTE estas secciones en markdown:

## Diagnostico de Riesgo
Resumen del estado del sostenedor. Indica el nivel de riesgo compuesto.

## Indicadores Violados
Para cada indicador que excede umbrales:
- Nombre del indicador y numero SIE
- Valor actual vs umbral
- Magnitud de la desviacion

## Categorias de Gasto Problematicas
Identifica que areas de gasto causan los riesgos detectados.

## Recomendaciones (3-5)
Acciones concretas, priorizadas por urgencia:
1. [URGENTE] ...
2. [IMPORTANTE] ...
3. [PREVENTIVO] ...

## Prioridad de Mitigacion
Ordena las acciones por impacto y factibilidad.

Reglas:
- Usa numeros especificos del sostenedor
- Referencia indicadores SIE por nombre y numero
- Responde SIEMPRE en espanol
- Escribe 500-800 palabras`;

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let sostId: string;
  let sostData: Record<string, unknown>;

  try {
    const body = await req.json();
    sostId = body.sostId;
    sostData = body.sostData;
    if (!sostId || !sostData) {
      return new Response(JSON.stringify({ error: "sostId y sostData requeridos" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "JSON invalido" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const userMessage = `Analiza el siguiente sostenedor con alertas de riesgo:

Sostenedor ID: ${sostId}
Datos de riesgo:
${JSON.stringify(sostData, null, 2)}

Proporciona un analisis detallado siguiendo la estructura indicada.`;

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
        max_tokens: 2048,
        stream: true,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }],
      }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Error de API: ${err instanceof Error ? err.message : "Desconocido"}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    return new Response(JSON.stringify({ error: `Claude API ${claudeRes.status}`, detail: errText.slice(0, 300) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

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
        console.error("AI feedback stream error:", err);
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
