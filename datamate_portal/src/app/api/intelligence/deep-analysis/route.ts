import { NextRequest } from "next/server";
import { DOMAIN_CONTEXT } from "@/lib/domain-knowledge";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

const SYSTEM_PROMPT = `Eres un analista estrategico senior de gastos educativos para la Superintendencia de Educacion de Chile. Analizas datos de gastos de sostenedores educacionales para descubrir tendencias, riesgos y anomalias.

Hoy es ${new Date().toISOString().slice(0, 10)}.

${DOMAIN_CONTEXT}

Recibiras estadisticas completas de TODAS las fuentes de datos (estado de resultado, documentos de compra, remuneraciones) como JSON. Produce un analisis estrategico integral con EXACTAMENTE estas 5 secciones, usando formato markdown:

## 1. Panorama General de Gastos
Analiza la distribucion de gastos por region y tipo de dependencia. Identifica:
- Regiones con mayor y menor gasto
- Proporcion de gasto por tipo de dependencia (Municipal/CM/SLEP/Particular Subvencionado)
- Concentracion de recursos

## 2. Analisis por Cuenta y Subvencion
Identifica patrones no obvios:
- Cuentas con mayor concentracion de gasto
- Distribucion de subvenciones
- Anomalias en la relacion gasto/cuenta

## 3. Alertas de Riesgo
Categoriza hallazgos como:
- **CRITICO** — Requiere accion inmediata
- **ALERTA** — Monitorear esta semana
- **INFORMATIVO** — Consideracion estrategica

Cada alerta debe citar datos especificos.

## 4. Recomendaciones Estrategicas
5-7 recomendaciones numeradas, especificas y accionables. Cada una debe incluir:
- Que hacer
- Por que (respaldado por datos)
- Impacto esperado

## 5. Analisis Profundo
DEEP_DIVE_INSTRUCTION

---

Reglas de formato:
- Usa **negrita** para numeros clave y terminos importantes
- Usa tablas markdown para comparaciones
- Usa viñetas y listas numeradas
- Cada seccion debe ser sustancial
- NO uses consejos genericos — cada afirmacion debe referenciar datos especificos
- Escribe 2000-3000 palabras
- Responde SIEMPRE en español`;

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  let stats: Record<string, unknown>;
  let focus: { region?: string; dependencia?: string; topic?: string } = {};

  try {
    const body = await req.json();
    stats = body.stats;
    focus = body.focus || {};
    if (!stats) {
      return new Response(JSON.stringify({ error: "stats requerido" }), {
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

  let deepDiveInstruction: string;
  if (focus.topic) {
    deepDiveInstruction = `El usuario quiere un analisis profundo sobre: "${focus.topic}". Analizalo exhaustivamente usando los datos, proporcionando insights unicos y hallazgos accionables.`;
  } else {
    deepDiveInstruction = `Elige UN hallazgo sorprendente o contra-intuitivo de los datos. Profundiza — explica que significa, por que importa y que accion tomar.`;
  }

  const focusInstructions: string[] = [];
  if (focus.region) focusInstructions.push(`Presta especial atencion a la region "${focus.region}".`);
  if (focus.dependencia) focusInstructions.push(`Enfocate en el tipo de dependencia "${focus.dependencia}".`);

  const systemPrompt = SYSTEM_PROMPT.replace("DEEP_DIVE_INSTRUCTION", deepDiveInstruction)
    + (focusInstructions.length > 0 ? `\n\n## Instrucciones de Enfoque\n${focusInstructions.join("\n")}` : "");

  const userMessage = `Aqui estan los datos completos de gastos educativos:\n\n${JSON.stringify(stats, null, 2)}`;

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
    return new Response(JSON.stringify({ error: `Error de API: ${err instanceof Error ? err.message : "Desconocido"}` }), {
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
