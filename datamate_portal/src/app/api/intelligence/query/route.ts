import { NextRequest } from "next/server";
import { DOMAIN_CONTEXT } from "@/lib/domain-knowledge";
import { executeSql, getSchemaDescription } from "@/lib/sql-executor";
import { getAIContext } from "@/lib/desafio-queries";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * Enhanced Intelligence Query endpoint.
 * Uses extended thinking to:
 * 1. Understand the user's question
 * 2. Generate SQL queries to get precise data
 * 3. Execute queries against all datasets
 * 4. Analyze results and provide actionable insights
 */

const SYSTEM_PROMPT = `Eres **Milo Analytics**, el motor de inteligencia avanzada de DataMate para la Superintendencia de Educacion de Chile.

Hoy es ${new Date().toISOString().slice(0, 10)}.

${DOMAIN_CONTEXT}

${getSchemaDescription()}

## Tu Capacidad
Tienes acceso DIRECTO a la base de datos PostgreSQL del esquema "desafio" en Supabase. Puedes escribir y ejecutar consultas SQL para responder CUALQUIER pregunta sobre los datos educativos.

## Proceso de Analisis
Para cada pregunta del usuario:

1. **ANALIZA** la pregunta y determina que datos necesitas
2. **GENERA** una o mas consultas SQL precisas (solo SELECT)
3. **INTERPRETA** los resultados con contexto institucional
4. **RESPONDE** con insights accionables

## Formato de Respuesta
Responde con un JSON valido (sin markdown):
{
  "thinking": "Tu razonamiento interno sobre como abordar la pregunta",
  "queries": [
    {
      "purpose": "Descripcion de que busca esta consulta",
      "sql": "SELECT ... FROM desafio.tabla WHERE ... LIMIT 500"
    }
  ],
  "needsExecution": true
}

## Reglas SQL CRITICAS (252 MILLONES DE FILAS — todos los valores son TEXT, castear siempre)
- SIEMPRE usa el prefijo "desafio." para las tablas (ej: desafio.estado_resultado)
- Solo consultas SELECT (lecturas)
- LIMIT maximo 500 filas en resultado final
- **CASTEO OBLIGATORIO**: monto_declarado::numeric, totalhaber::numeric, liquido::numeric, hc::numeric, mes::int, anio::int — TODOS son TEXT en la DB
- **SIEMPRE** usa GROUP BY con funciones de agregacion (SUM, COUNT, AVG) — NUNCA hagas SELECT * sin filtros estrictos
- **SIEMPRE** filtra por al menos una dimension (periodo, sost_id, region_rbd, dependencia_rbd)

## Estrategia Multi-Año INTELIGENTE
NO leas todos los datos cuando no necesitas hacerlo:
- **Pregunta sobre 1 sostenedor**: WHERE sost_id = 'X' — reduce a miles de filas, seguro
- **Pregunta sobre 1 periodo**: WHERE periodo = '2024' — reduce a ~5-7M, necesita GROUP BY
- **Comparacion entre años**: WHERE periodo IN ('2021','2024') con GROUP BY periodo
- **Remuneraciones multi-año**: usa UNION ALL solo de los años necesarios:
  SELECT sostenedor, periodo, SUM(totalhaber::numeric) FROM desafio.remuneraciones_2023 WHERE sostenedor='X' GROUP BY 1,2
  UNION ALL
  SELECT sostenedor, periodo, SUM(totalhaber::numeric) FROM desafio.remuneraciones_2024 WHERE sostenedor='X' GROUP BY 1,2
- **Ranking general**: filtra UN periodo + GROUP BY sost_id, nunca todos los periodos juntos
- **JOINs**: SIEMPRE filtra ANTES del JOIN con subquery:
  SELECT e.sost_id, d.nombre_sost, SUM(e.monto_declarado::numeric)
  FROM desafio.estado_resultado e
  JOIN (SELECT DISTINCT sost_id, nombre_sost FROM desafio.documentos WHERE sost_id = 'X') d ON e.sost_id = d.sost_id
  WHERE e.sost_id = 'X' GROUP BY 1,2

## JOIN especial: remuneraciones
- La columna se llama "sostenedor" (NO sost_id): JOIN ... ON e.sost_id = r.sostenedor
- Una tabla POR año: desafio.remuneraciones_2020, _2021, _2022, _2023, _2024
- Para cruzar con estado_resultado: filtra por sost_id Y periodo en ambas tablas

## 13 Indicadores SIE (para contextualizar respuestas)
Los mas comunes y como calcularlos:
- #4: Concentracion admin = SUM(monto WHERE cuenta_alias LIKE '420%') / SUM(monto WHERE desc_tipo_cuenta='Gasto'). Alerta >35%
- #9: Gasto remuneracional = SUM(totalhaber::numeric) de remuneraciones / SUM(monto WHERE desc_tipo_cuenta='Ingreso'). Normal 67-72%, alerta >80%
- #10: Innovacion pedagogica = SUM(monto WHERE cuenta_alias IN ('410500','410600','410700')) / SUM(monto gastos)
- #11: HHI = SUM(proporcion^2) por fuente de ingreso. >0.25 = alta concentracion

Responde SIEMPRE en español.`;

const ANALYSIS_PROMPT = `Eres **Milo Analytics**. Recibes resultados de consultas SQL ejecutadas contra la base de datos educativa.

${DOMAIN_CONTEXT}

## Tu Tarea
Analiza los resultados de las consultas y produce un informe claro y accionable.

## Formato de Respuesta
Usa markdown con:
- **Resumen Ejecutivo**: 2-3 oraciones con los hallazgos principales y numeros clave
- **Datos**: Tabla markdown con los resultados mas relevantes (max 20 filas)
- **Analisis**: Interpretacion contextualizada usando indicadores SIE cuando sea relevante
- **Alertas**: Si detectas anomalias, listalas con nivel (CRITICO/ALERTA/INFO)
- **Recomendaciones**: 2-3 acciones concretas basadas en los datos

## Reglas
- Usa numeros REALES de los resultados, NUNCA inventes
- Formatea montos en CLP con separadores de miles
- Referencia indicadores SIE por nombre y numero cuando aplique
- Si los datos son insuficientes para responder, indicalo
- Responde SIEMPRE en español`;

interface QueryPlan {
  thinking: string;
  queries: Array<{ purpose: string; sql: string }>;
  needsExecution: boolean;
}

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let question: string;
  let filters: Record<string, string> | undefined;
  let conversationHistory: Array<{ role: string; content: string }> = [];

  try {
    const body = await req.json();
    question = body.question;
    filters = body.filters;
    conversationHistory = body.history || [];
    if (!question || typeof question !== "string") {
      return new Response(JSON.stringify({ error: "Falta la pregunta" }), {
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

  // Step 1: Get pre-aggregated context for reference
  let statsContext = "";
  try {
    const { stats, totalRows } = await getAIContext(question, filters);
    statsContext = `\n\nDatos pre-agregados disponibles (${totalRows} filas totales):\n${JSON.stringify(stats, null, 0)}`;
  } catch {
    statsContext = "\n\n(No se pudieron cargar estadisticas pre-agregadas)";
  }

  // Step 2: Use extended thinking to plan SQL queries
  let queryPlan: QueryPlan;

  try {
    const planRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 16000,
        thinking: {
          type: "enabled",
          budget_tokens: 10000,
        },
        system: SYSTEM_PROMPT,
        messages: [
          ...conversationHistory.slice(-4).map(m => ({
            role: m.role as "user" | "assistant",
            content: m.content,
          })),
          {
            role: "user",
            content: `Pregunta del analista: ${question}${statsContext}\n\nGenera el plan de consultas SQL para responder esta pregunta. Retorna SOLO JSON.`,
          },
        ],
      }),
    });

    if (!planRes.ok) {
      const errText = await planRes.text();
      console.error("Query plan API error:", planRes.status, errText.slice(0, 500));
      return new Response(JSON.stringify({ error: `Claude API ${planRes.status}`, detail: errText.slice(0, 300) }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const planResult = await planRes.json();

    // Extract text from response (may have thinking blocks)
    let planText = "";
    for (const block of planResult.content || []) {
      if (block.type === "text") {
        planText = block.text;
        break;
      }
    }

    // Parse the query plan JSON
    let cleaned = planText.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    if (!cleaned.startsWith("{")) {
      const idx = cleaned.indexOf("{");
      if (idx >= 0) cleaned = cleaned.slice(idx);
    }
    if (!cleaned.endsWith("}")) {
      const last = cleaned.lastIndexOf("}");
      if (last > 0) cleaned = cleaned.slice(0, last + 1);
    }

    queryPlan = JSON.parse(cleaned);
  } catch (err) {
    console.error("Query plan parse error:", err);
    // Don't fail — create a fallback plan that uses the pre-aggregated stats
    queryPlan = {
      thinking: "No se pudo generar un plan SQL. Usando datos pre-agregados disponibles.",
      queries: [],
      needsExecution: false,
    };
  }

  // Step 3: Execute SQL queries
  const queryResults: Array<{
    purpose: string;
    sql: string;
    result: { data: Record<string, unknown>[]; rowCount: number; error?: string; executionMs: number };
  }> = [];

  for (const q of (queryPlan.queries || []).slice(0, 5)) {
    try {
      const result = await executeSql(q.sql);
      queryResults.push({
        purpose: q.purpose,
        sql: q.sql,
        result: {
          data: result.data.slice(0, 100), // Cap for analysis prompt
          rowCount: result.rowCount,
          error: result.error,
          executionMs: result.executionMs,
        },
      });
    } catch (err) {
      queryResults.push({
        purpose: q.purpose,
        sql: q.sql,
        result: {
          data: [],
          rowCount: 0,
          error: err instanceof Error ? err.message : "Error ejecutando consulta",
          executionMs: 0,
        },
      });
    }
  }

  // Step 4: Stream the analysis using query results
  const analysisInput = `## Pregunta Original
${question}

## Plan de Analisis
${queryPlan.thinking}

## Resultados de Consultas
${queryResults.map((qr, i) => `
### Consulta ${i + 1}: ${qr.purpose}
\`\`\`sql
${qr.sql}
\`\`\`
${qr.result.error
    ? `**Error:** ${qr.result.error}`
    : `**${qr.result.rowCount} filas** (${qr.result.executionMs}ms)\n\`\`\`json\n${JSON.stringify(qr.result.data, null, 2)}\n\`\`\``
}
`).join("\n")}

## Contexto Adicional
${statsContext}

Produce tu analisis completo ahora.`;

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
          budget_tokens: 8000,
        },
        system: ANALYSIS_PROMPT,
        messages: [{ role: "user", content: analysisInput }],
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
    console.error("Analysis API error:", claudeRes.status, errText.slice(0, 500));
    return new Response(JSON.stringify({ error: `Claude API ${claudeRes.status}`, detail: errText.slice(0, 300) }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Stream response - include metadata header with query info
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      // Emit metadata as a hidden comment
      const meta = {
        queries: queryResults.map(qr => ({
          purpose: qr.purpose,
          sql: qr.sql,
          rowCount: qr.result.rowCount,
          executionMs: qr.result.executionMs,
          error: qr.result.error || null,
        })),
        thinking: queryPlan.thinking,
      };
      controller.enqueue(encoder.encode(`<!--QUERY_META:${JSON.stringify(meta)}-->`));

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
              // skip malformed
            }
          }
        }
      } catch (err) {
        console.error("Query stream error:", err);
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
