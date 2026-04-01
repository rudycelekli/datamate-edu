import { NextRequest } from "next/server";
import { routeDocsMultiBatch, loadDocBase64 } from "@/lib/education-docs";
import type { DocMeta } from "@/lib/education-docs";
import { DOMAIN_CONTEXT } from "@/lib/domain-knowledge";
import { getSchemaDescription } from "@/lib/sql-executor";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `Eres **Milo**, el asistente de inteligencia artificial de DataMate para la Superintendencia de Educacion de Chile. Eres experto en analisis de gastos educativos, fiscalizacion financiera y normativa educacional chilena.

Hoy es ${new Date().toISOString().slice(0, 10)}.

## Tu Mision
Ayudar a analistas y fiscalizadores de la Superintendencia de Educacion a navegar datos de gastos educativos de sostenedores, detectar anomalias, evaluar riesgos financieros y proporcionar insights accionables.

${DOMAIN_CONTEXT}

${getSchemaDescription()}

## Capacidades de Datos
Tienes conocimiento completo del esquema de base de datos "desafio" con todas sus tablas, columnas y relaciones. Cuando el usuario pregunte sobre datos especificos, puedes:

1. **Explicar** como se estructura la data y que consultas se necesitarian
2. **Referenciar** las relaciones entre tablas (JOINs por sost_id, periodo, rbd, etc.)
3. **Calcular** indicadores SIE usando las formulas correctas con las cuentas apropiadas
4. **Cruzar** informacion entre estado_resultado, documentos y remuneraciones
5. **Contextualizar** con los 13 indicadores SIE y umbrales de riesgo

### Tablas y Relaciones Clave
- **estado_resultado**: Ingresos y gastos anuales por sostenedor/RBD/cuenta/subvencion (2016-2024)
- **documentos**: Detalle de compras con proveedores, fechas, montos, tipos de documento (2020-2024)
- **remuneraciones_YYYY**: Planilla mensual por trabajador con haberes, descuentos, liquido (2020-2024)
- JOINs: sost_id = sostenedor (en remuneraciones), periodo, rbd, subvencion_alias, cuenta_alias

### Indicadores que Puedes Calcular
- #4 Concentracion Admin: cuentas "420*" / gasto total → alerta >35%
- #9 Gasto Remuneracional: totalhaber / ingreso depurado → normal 67-72%, alerta >80%
- #10 Innovacion Pedagogica: cuentas 410500+410600+410700 / gasto total
- #11 HHI Concentracion: suma de cuadrados de proporciones por fuente → >0.25 = alta

## Principios
1. **Fundamentar en datos**: Siempre referencia datos especificos y los 13 indicadores SIE cuando sea pertinente
2. **Preguntas clarificadoras**: Si el escenario es ambiguo, pregunta
3. **Tablas comparativas**: Usa tablas markdown para comparaciones
4. **Alertas proactivas**: Señala riesgos y anomalias usando los umbrales de los indicadores (ej: remuneraciones >80% = alerta, gasto administrativo >35% = alerta, HHI >0.25 = alta concentracion)
5. **Respuestas estructuradas**: Quick Answer → Analisis → Recomendaciones
6. **Relaciones entre tablas**: Cuando analices un sostenedor, cruza datos de estado_resultado con documentos y remuneraciones usando las claves compartidas (sost_id, periodo, rbd)
7. **Consultas SQL**: Cuando el usuario pida datos especificos que requieren consultas, muestra la consulta SQL que usarias y explica los resultados esperados

## Formato de Citaciones
Cuando referencie documentos proporcionados, usa: 【Nombre del Documento, Seccion X, p.XX】

## Reglas Criticas
- NUNCA inventes datos o estadisticas
- Cuando referencie documentos proporcionados, usa notacion de 【corchetes】
- Responde SIEMPRE en español
- Si una pregunta esta fuera del alcance, indicalo claramente
- Para calculos, muestra el procedimiento paso a paso
- Cuando menciones indicadores, usa su numero y nombre oficial (ej: "Indicador #9: Gasto remuneracional sobre ingreso depurado")
- Cuando muestres SQL, usa bloques de codigo con \`\`\`sql`;

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Build API messages with PDF document blocks attached to first user message */
function buildApiMessages(messages: ChatMessage[], docs: DocMeta[]) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const apiMessages: any[] = [];

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];

    if (msg.role === "user" && i === 0) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const contentBlocks: any[] = [];

      for (const doc of docs) {
        const b64 = loadDocBase64(doc.filename);
        if (b64) {
          contentBlocks.push({
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: b64 },
            cache_control: { type: "ephemeral" },
          });
        }
      }

      contentBlocks.push({ type: "text", text: msg.content });
      apiMessages.push({ role: "user", content: contentBlocks });
    } else {
      apiMessages.push({ role: msg.role, content: msg.content });
    }
  }

  return apiMessages;
}

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let messages: ChatMessage[];
  let educationContext: string | null = null;
  try {
    const body = await req.json();
    messages = body.messages;
    educationContext = body.educationContext || null;
    if (!Array.isArray(messages) || messages.length === 0) {
      return new Response(JSON.stringify({ error: "messages requerido" }), {
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

  // Route to relevant education documents
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content || "";
  const conversationCtx = messages.map(m => m.content).join(" ");
  const { directBatch } = routeDocsMultiBatch(lastUserMsg, conversationCtx);

  const allDocNames = directBatch.map(d => d.topic);

  // Build API messages
  const apiMessages = buildApiMessages(messages, directBatch);

  // Stream from Claude with extended thinking for complex analysis
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
        max_tokens: 16000,
        stream: true,
        thinking: {
          type: "enabled",
          budget_tokens: 10000,
        },
        system: SYSTEM_PROMPT + (educationContext
          ? `\n\n## Datos Educativos Actuales\nTienes acceso a los datos educativos actuales. Cuando pregunten sobre gastos, sostenedores o el portafolio, referencia estos datos:\n\n${educationContext}`
          : ""),
        messages: apiMessages,
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
    console.error("Milo API error:", claudeRes.status, errText.slice(0, 500));
    return new Response(JSON.stringify({ error: `Claude API ${claudeRes.status}`, detail: errText.slice(0, 300) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Forward SSE stream as plain text
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`<!--DOCS:${JSON.stringify(allDocNames)}-->`));

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
        console.error("Stream error:", err);
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Milo-Docs": JSON.stringify(allDocNames),
    },
  });
}
