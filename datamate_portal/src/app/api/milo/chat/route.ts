import { NextRequest } from "next/server";
import { routeDocsMultiBatch, loadDocBase64 } from "@/lib/education-docs";
import type { DocMeta } from "@/lib/education-docs";
import { DOMAIN_CONTEXT } from "@/lib/domain-knowledge";
import { getSchemaDescription, executeSql } from "@/lib/sql-executor";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `Eres **Milo**, el asistente de inteligencia artificial de DataMate para la Superintendencia de Educacion de Chile. Eres experto en analisis de gastos educativos, fiscalizacion financiera y normativa educacional chilena.

Hoy es ${new Date().toISOString().slice(0, 10)}.

## Tu Mision
Ayudar a analistas y fiscalizadores de la Superintendencia de Educacion a navegar datos de gastos educativos de sostenedores, detectar anomalias, evaluar riesgos financieros y proporcionar insights accionables.

${DOMAIN_CONTEXT}

${getSchemaDescription()}

## Capacidades de Datos
Tienes acceso DIRECTO a la base de datos PostgreSQL "desafio" a traves de la herramienta **query_database**. Cuando el usuario pregunte sobre datos especificos:

1. **USA query_database** para ejecutar SQL y obtener resultados reales
2. **Muestra los datos** en tablas markdown formateadas
3. **Analiza e interpreta** los resultados en contexto de los indicadores SIE
4. **Alerta** cuando encuentres valores fuera de umbral

### Vistas Materializadas (PREFERIR para analisis rapidos)
- **mv_sostenedor_profile**: perfil completo por sostenedor/periodo — ind4_admin_ratio, ind9_payroll_ratio, balance_ratio, risk_score, risk_level, ind11_hhi
- **mv_sostenedor_yoy**: cambios año a año — yoy_ingresos_pct, yoy_gastos_pct, yoy_haberes_pct
- **mv_sostenedor_financials**: totales financieros agregados
- **mv_sostenedor_payroll**: datos de remuneraciones agregados por sostenedor/periodo
- **mv_sostenedor_hhi**: indice HHI de concentracion de ingresos
- **mv_sostenedor_documentos**: resumen de documentos/compras
- **mv_sostenedor_identity**: nombre y RUT de sostenedores

### Tablas Base (para analisis detallado)
- **estado_resultado**, **documentos**, **remuneraciones_YYYY** (ver esquema arriba)

## Principios
1. **Ejecuta queries reales**: Usa query_database para responder preguntas sobre datos
2. **Grafica los datos**: Usa render_chart SIEMPRE que el usuario pida visualizar, comparar o ver tendencias — no esperes a que lo pida explicitamente si tiene sentido graficarlo
3. **Tablas comparativas**: Formatea resultados como tablas markdown cuando no graficas
4. **Alertas proactivas**: Señala riesgos usando umbrales SIE
5. **Respuestas estructuradas**: Quick Answer → Datos/Grafico → Analisis → Recomendaciones
6. **SQL eficiente**: Siempre usa GROUP BY + agregaciones en tablas grandes; prefiere vistas mv_* para consultas generales
7. **Citas documentales**: Usa 【Nombre del Documento, Seccion X, p.XX】para PDF

## Visualizacion de Datos (render_chart)
**USA render_chart proactivamente** — no solo cuando el usuario lo pide:
- Distribucion de haberes por sostenedor → bar chart
- Tendencia de remuneraciones por periodo → line chart
- Proporcion planta fija vs contrata → pie chart
- Comparacion de gasto por region → bar chart
- Evolucion del balance → line chart
- Top sostenedores por indicador → bar chart horizontal

**Flujo correcto:**
1. Consulta datos con query_database (max 20-30 filas para claridad visual)
2. Llama render_chart con los datos obtenidos (pasa los objetos directamente, sin transformar)
3. Agrega analisis textual despues del grafico

**Para remuneraciones**, estas queries son utiles:
- Por sostenedor: SELECT sostenedor AS nombre, SUM(totalhaber::numeric) AS total_haberes FROM desafio.remuneraciones_2024 WHERE anio='2024' GROUP BY sostenedor ORDER BY total_haberes DESC LIMIT 15
- Por mes: SELECT mes, SUM(totalhaber::numeric) AS total_haberes FROM desafio.remuneraciones_2024 WHERE sostenedor='XXXXX' GROUP BY mes ORDER BY mes::int
- Planta vs contrata: SELECT tip, COUNT(DISTINCT rut) AS trabajadores, SUM(totalhaber::numeric) AS total_haberes FROM desafio.remuneraciones_2024 WHERE sostenedor='XXXXX' GROUP BY tip
- Vista rapida: SELECT sost_id, total_haberes, trabajadores, planta_fija, contrata FROM desafio.mv_sostenedor_payroll WHERE periodo='2024' ORDER BY total_haberes DESC LIMIT 20

## Reglas Criticas
- NUNCA inventes datos — SIEMPRE ejecuta una query para obtener numeros reales
- Responde SIEMPRE en español
- Para calculos, muestra el procedimiento paso a paso
- Cuando menciones indicadores, usa numero y nombre oficial (ej: "Indicador #9: Gasto remuneracional")
- Para preguntas de remuneraciones: usa mv_sostenedor_payroll para totales rapidos; remuneraciones_YYYY para detalle por trabajador/mes`;

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

const TOOLS = [
  {
    name: "query_database",
    description: "Ejecuta una consulta SQL SELECT de solo lectura contra la base de datos PostgreSQL 'desafio' de Supabase. Usa esto para obtener datos reales de sostenedores, remuneraciones, documentos y estados de resultado. Siempre usa GROUP BY y agregaciones en tablas grandes. Prefiere las vistas mv_sostenedor_* para consultas generales.",
    input_schema: {
      type: "object",
      properties: {
        sql: {
          type: "string",
          description: "Consulta SQL SELECT valida. Solo SELECT/WITH permitidos. Usa esquema 'desafio.' como prefijo (ej: desafio.mv_sostenedor_profile). Siempre incluye LIMIT. Para tablas grandes (estado_resultado, documentos, remuneraciones_YYYY) SIEMPRE usa agregaciones con GROUP BY.",
        },
        description: {
          type: "string",
          description: "Breve descripcion de lo que busca esta consulta (para mostrar al usuario mientras espera)",
        },
      },
      required: ["sql", "description"],
    },
  },
  {
    name: "render_chart",
    description: "Renderiza un grafico interactivo directamente en el chat. Usar SIEMPRE despues de query_database cuando el usuario pide visualizar datos, comparar valores o ver tendencias. Soporta bar (barras — mejor para comparar sostenedores/regiones/periodos), line (lineas — mejor para tendencias temporales), pie (torta — mejor para distribuciones porcentuales).",
    input_schema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          enum: ["bar", "line", "pie"],
          description: "Tipo de grafico: bar=comparar categorias, line=tendencia temporal, pie=distribucion porcentual",
        },
        title: {
          type: "string",
          description: "Titulo descriptivo del grafico",
        },
        data: {
          type: "array",
          description: "Array de objetos con los datos. Cada objeto debe tener una clave para la etiqueta (xKey) y claves numericas para los valores (yKeys). Max 50 filas para claridad visual.",
          items: { type: "object" },
        },
        xKey: {
          type: "string",
          description: "Nombre de la clave en cada objeto de datos que se usa como etiqueta del eje X / categoria (ej: 'nombre', 'periodo', 'region')",
        },
        yKeys: {
          type: "array",
          items: { type: "string" },
          description: "Lista de claves numericas a graficar (ej: ['total_haberes', 'total_liquido']). Para pie chart, usar solo una.",
        },
        colors: {
          type: "array",
          items: { type: "string" },
          description: "Colores hex opcionales para cada serie (ej: ['#3b82f6', '#ef4444']). Si se omite, se usan colores predefinidos.",
        },
        xLabel: {
          type: "string",
          description: "Etiqueta opcional para el eje X",
        },
        yLabel: {
          type: "string",
          description: "Etiqueta opcional para el eje Y",
        },
        formatY: {
          type: "string",
          enum: ["number", "currency_clp", "percent"],
          description: "Formato para los valores del eje Y: number=numero simple, currency_clp=pesos chilenos, percent=porcentaje",
        },
      },
      required: ["type", "title", "data", "xKey", "yKeys"],
    },
  },
];

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

  const apiMessages = buildApiMessages(messages, directBatch);

  const systemPrompt = SYSTEM_PROMPT + (educationContext
    ? `\n\n## Datos Educativos Actuales\nTienes acceso a los datos educativos actuales. Cuando pregunten sobre gastos, sostenedores o el portafolio, referencia estos datos:\n\n${educationContext}`
    : "");

  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode(`<!--DOCS:${JSON.stringify(allDocNames)}-->`));

      // Agentic loop: Claude can call query_database multiple times
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const loopMessages: any[] = [...apiMessages];
      let iterations = 0;
      const MAX_ITERATIONS = 5;

      while (iterations < MAX_ITERATIONS) {
        iterations++;

        let claudeRes: Response;
        try {
          claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-api-key": ANTHROPIC_API_KEY!,
              "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify({
              model: "claude-sonnet-4-20250514",
              max_tokens: 16000,
              stream: true,
              system: systemPrompt,
              tools: TOOLS,
              messages: loopMessages,
            }),
          });
        } catch (err) {
          controller.enqueue(encoder.encode(`\n\n[Error de conexion: ${err instanceof Error ? err.message : "Desconocido"}]`));
          break;
        }

        if (!claudeRes.ok) {
          const errText = await claudeRes.text();
          console.error("Milo API error:", claudeRes.status, errText.slice(0, 500));
          controller.enqueue(encoder.encode(`\n\n[Error de API: ${claudeRes.status}]`));
          break;
        }

        // Stream and collect the response
        const reader = claudeRes.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolUses: any[] = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const contentBlocks: any[] = [];
        let stopReason = "";
        let currentBlockType = "";
        let currentBlockId = "";
        let currentBlockName = "";
        let currentBlockInput = "";
        let currentBlockText = "";

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

                if (parsed.type === "message_delta" && parsed.delta?.stop_reason) {
                  stopReason = parsed.delta.stop_reason;
                }

                if (parsed.type === "content_block_start") {
                  const block = parsed.content_block;
                  currentBlockType = block.type;
                  currentBlockId = block.id || "";
                  currentBlockName = block.name || "";
                  currentBlockInput = "";
                  currentBlockText = "";
                }

                if (parsed.type === "content_block_delta") {
                  const delta = parsed.delta;
                  if (delta.type === "text_delta") {
                    currentBlockText += delta.text;
                    controller.enqueue(encoder.encode(delta.text));
                  } else if (delta.type === "input_json_delta") {
                    currentBlockInput += delta.partial_json;
                  }
                }

                if (parsed.type === "content_block_stop") {
                  if (currentBlockType === "text") {
                    contentBlocks.push({ type: "text", text: currentBlockText });
                  } else if (currentBlockType === "tool_use") {
                    let parsedInput: { sql?: string; description?: string } = {};
                    try { parsedInput = JSON.parse(currentBlockInput); } catch { /* */ }
                    const toolUseBlock = {
                      type: "tool_use",
                      id: currentBlockId,
                      name: currentBlockName,
                      input: parsedInput,
                    };
                    contentBlocks.push(toolUseBlock);
                    toolUses.push(toolUseBlock);
                  }
                }
              } catch {
                // skip malformed
              }
            }
          }
        } catch (err) {
          console.error("Stream read error:", err);
        }

        // Add Claude's response to loop messages
        loopMessages.push({ role: "assistant", content: contentBlocks });

        // If no tool calls, we're done
        if (stopReason !== "tool_use" || toolUses.length === 0) {
          break;
        }

        // Execute each tool call and send results back
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const toolResults: any[] = [];

        for (const toolUse of toolUses) {
          if (toolUse.name === "query_database") {
            const { sql, description } = toolUse.input as { sql: string; description: string };

            // Notify user we're running a query
            controller.enqueue(encoder.encode(`\n\n_Consultando base de datos: ${description}..._\n\n`));

            const result = await executeSql(sql);

            let resultText: string;
            if (result.error) {
              resultText = JSON.stringify({ error: result.error, sql });
            } else {
              resultText = JSON.stringify({
                rowCount: result.rowCount,
                truncated: result.truncated,
                executionMs: result.executionMs,
                data: result.data,
              });
            }

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: resultText,
            });

          } else if (toolUse.name === "render_chart") {
            // Emit chart spec as a special marker in the stream — frontend parses and renders it
            const chartSpec = toolUse.input as {
              type: string; title: string; data: unknown[]; xKey: string;
              yKeys: string[]; colors?: string[]; xLabel?: string; yLabel?: string; formatY?: string;
            };

            // Emit chart marker — frontend splits on this and renders a Recharts component
            const chartJson = JSON.stringify(chartSpec);
            controller.enqueue(encoder.encode(`\n\n%%CHART%%${chartJson}%%ENDCHART%%\n\n`));

            toolResults.push({
              type: "tool_result",
              tool_use_id: toolUse.id,
              content: JSON.stringify({ rendered: true, rows: chartSpec.data?.length ?? 0 }),
            });
          }
        }

        loopMessages.push({ role: "user", content: toolResults });
      }

      controller.close();
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
