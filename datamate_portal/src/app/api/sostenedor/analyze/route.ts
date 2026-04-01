import { NextRequest } from "next/server";
import { getDesafioClient } from "@/lib/supabase";
import { DOMAIN_CONTEXT } from "@/lib/domain-knowledge";
import { loadDocBase64 } from "@/lib/education-docs";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

/**
 * POST /api/sostenedor/analyze
 * AI-powered deep analysis of a specific sostenedor.
 * Uses pre-computed profile data + extended thinking.
 */

const SYSTEM_PROMPT = `Eres **Milo**, experto fiscal de la Superintendencia de Educacion de Chile. Recibes el perfil financiero completo de un sostenedor educacional con todos los indicadores SIE pre-calculados.

${DOMAIN_CONTEXT}

## Tu Rol
Eres el fiscalizador experto que revisa el perfil de un sostenedor. Debes producir un analisis que un fiscalizador de la SIE pueda usar directamente en su trabajo.

## Formato de Respuesta (SIEMPRE en español, usar markdown)

### Resumen Ejecutivo
2-3 oraciones con el veredicto principal: estado financiero general, nivel de riesgo, hallazgo mas importante.

### Indicadores Clave
Tabla con cada indicador calculado, su valor, el umbral normativo, y estado (CRITICO/ALERTA/OK).

### Alertas y Hallazgos
Lista priorizada de hallazgos relevantes. Cada uno con:
- **Hallazgo**: que se detectó
- **Evidencia**: numeros específicos del perfil
- **Implicancia**: que significa para el sostenedor
- **Accion recomendada**: que deberia hacer el fiscalizador

### Comparacion Interanual
Analisis de tendencias año a año. Detectar:
- Cambios bruscos en ingresos o gastos (>20% interanual)
- Deterioro o mejora progresiva de indicadores
- Variaciones en composicion del gasto

### Analisis de Documentos y Proveedores
- Cobertura documental (monto docs vs monto ER)
- Diversidad de proveedores
- Tipos de documentos usados

### Analisis de Remuneraciones
- Proporcion planta fija vs contrata
- Evolucion de haberes y liquido
- Horas contratadas por establecimiento

### Saldos No Utilizados
- Balance (ingresos - gastos) por periodo
- Tendencia: creciente o decreciente
- Recomendaciones sobre saldos acumulados o deficit

### Recomendaciones y Oportunidades de Mejora
5-7 recomendaciones concretas, priorizadas, con impacto estimado. Orientadas a:
- Reduccion de gastos no aceptados
- Optimizacion de gasto administrativo vs pedagogico
- Mejora en acreditacion de saldos
- Oportunidades de reasignacion de recursos

## Reglas Criticas
- USA SOLO datos del perfil proporcionado — NUNCA inventes
- Formatea montos en CLP con separadores de miles
- Referencia indicadores por numero y nombre oficial
- Se directo y accionable — esto es para fiscalizadores profesionales
- Señala lo positivo tambien, no solo los problemas`;

export async function POST(req: NextRequest) {
  if (!ANTHROPIC_API_KEY) {
    return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY no configurada" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  let sostId: string;
  let question: string | null = null;
  try {
    const body = await req.json();
    sostId = body.sost_id;
    question = body.question || null;
    if (!sostId) {
      return new Response(JSON.stringify({ error: "sost_id requerido" }), {
        status: 400, headers: { "Content-Type": "application/json" },
      });
    }
  } catch {
    return new Response(JSON.stringify({ error: "JSON invalido" }), {
      status: 400, headers: { "Content-Type": "application/json" },
    });
  }

  // Fetch pre-computed profile
  const db = getDesafioClient();
  const [profileRes, yoyRes] = await Promise.all([
    db.from("mv_sostenedor_profile").select("*").eq("sost_id", sostId).order("periodo"),
    db.from("mv_sostenedor_yoy").select("*").eq("sost_id", sostId).order("periodo"),
  ]);

  if (profileRes.error) {
    return new Response(JSON.stringify({ error: "Error cargando perfil: " + profileRes.error.message }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }

  if (!profileRes.data || profileRes.data.length === 0) {
    return new Response(JSON.stringify({ error: "Sostenedor no encontrado" }), {
      status: 404, headers: { "Content-Type": "application/json" },
    });
  }

  const profileData = JSON.stringify(profileRes.data, null, 2);
  const yoyData = JSON.stringify(yoyRes.data || [], null, 2);

  const userMessage = question
    ? `Analiza el sostenedor ${sostId} y responde esta pregunta especifica: "${question}"\n\nPERFIL COMPLETO:\n${profileData}\n\nCOMPARACION INTERANUAL:\n${yoyData}`
    : `Produce un analisis fiscal completo del sostenedor ${sostId}.\n\nPERFIL COMPLETO (todos los periodos):\n${profileData}\n\nCOMPARACION INTERANUAL:\n${yoyData}`;

  // Load reference PDFs for grounded analysis
  const pdfFiles = [
    "Propuesta_Indicadores.pdf",
    "Guia_tecnica_Superintendencia_Educacion.pdf",
    "Fase de Configuración Inicial con datos del SIE.pdf",
  ];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const contentBlocks: any[] = [];
  for (const filename of pdfFiles) {
    const b64 = loadDocBase64(filename);
    if (b64) {
      contentBlocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: b64 },
        cache_control: { type: "ephemeral" },
      });
    }
  }
  contentBlocks.push({ type: "text", text: userMessage });

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
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: contentBlocks }],
      }),
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `API error: ${err instanceof Error ? err.message : "Unknown"}` }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    return new Response(JSON.stringify({ error: `Claude API ${claudeRes.status}`, detail: errText.slice(0, 300) }), {
      status: 502, headers: { "Content-Type": "application/json" },
    });
  }

  // Stream response
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
            } catch { /* skip */ }
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
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-cache" },
  });
}
