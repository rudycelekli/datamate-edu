import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";
import { DOMAIN_CONTEXT } from "@/lib/domain-knowledge";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

interface SimulationRequest {
  sost_id: string;
  periodo: string;
  adjustments: {
    gasto_admin_pct?: number;
    gasto_pedagogico_pct?: number;
    gasto_innovacion_pct?: number;
    total_gastos_pct?: number;
    trabajadores_pct?: number;
  };
}

interface ProfileRow {
  sost_id: string;
  periodo: string;
  nombre: string;
  total_ingresos: number;
  total_gastos: number;
  balance: number;
  gasto_admin: number;
  gasto_pedagogico: number;
  gasto_innovacion: number;
  gasto_operacion: number;
  gasto_infraestructura: number;
  ind4_admin_ratio: number;
  ind9_payroll_ratio: number;
  ind10_innovacion_ratio: number;
  ind11_hhi: number;
  total_haberes: number;
  trabajadores: number;
  risk_score: number;
  risk_level: string;
  tasa_ejecucion: number;
  doc_count: number;
  proveedores_unicos: number;
  [key: string]: unknown;
}

function applyPct(base: number, pct: number | undefined): number {
  if (pct === undefined || pct === 0) return base;
  return Math.round(base * (1 + pct / 100));
}

function recalculateIndicators(original: ProfileRow, simulated: Partial<ProfileRow>): Partial<ProfileRow> {
  const totalGastos = (simulated.total_gastos ?? original.total_gastos) || 1;
  const totalIngresos = original.total_ingresos || 1;
  const gastoAdmin = simulated.gasto_admin ?? original.gasto_admin;
  const gastoPedagogico = simulated.gasto_pedagogico ?? original.gasto_pedagogico;
  const gastoInnovacion = simulated.gasto_innovacion ?? original.gasto_innovacion;
  const totalHaberes = original.total_haberes;
  const trabajadores = simulated.trabajadores ?? original.trabajadores;

  // #4 Admin concentration ratio
  const ind4_admin_ratio = Number(((gastoAdmin / totalGastos) * 100).toFixed(1));

  // #9 Payroll ratio (haberes / ingresos depurados)
  const ind9_payroll_ratio = Number(((totalHaberes / totalIngresos) * 100).toFixed(1));

  // #10 Innovation ratio
  const ind10_innovacion_ratio = Number(((gastoInnovacion / totalGastos) * 100).toFixed(1));

  // #11 HHI (spending concentration across categories)
  const categories = [gastoAdmin, gastoPedagogico, gastoInnovacion,
    simulated.gasto_operacion ?? original.gasto_operacion,
    simulated.gasto_infraestructura ?? original.gasto_infraestructura];
  const totalCat = categories.reduce((a, b) => a + b, 0) || 1;
  const ind11_hhi = Number(categories.reduce((sum, c) => {
    const share = c / totalCat;
    return sum + share * share;
  }, 0).toFixed(4));

  // Balance
  const balance = totalIngresos - totalGastos;

  // Tasa de ejecucion
  const tasa_ejecucion = Number(((totalGastos / totalIngresos) * 100).toFixed(1));

  // Risk score recalculation
  let weightedScore = 0;

  // #4 weight: 25%
  if (ind4_admin_ratio > 50) weightedScore += 25;
  else if (ind4_admin_ratio > 35) weightedScore += 15;

  // #9 weight: 25%
  if (ind9_payroll_ratio > 95) weightedScore += 25;
  else if (ind9_payroll_ratio > 80) weightedScore += 15;

  // Balance weight: 20%
  const deficitRatio = totalIngresos > 0 ? (balance / totalIngresos) * 100 : 0;
  if (deficitRatio < -20) weightedScore += 20;
  else if (balance < 0) weightedScore += 12;

  // HHI weight: 15%
  if (ind11_hhi > 0.5) weightedScore += 15;
  else if (ind11_hhi > 0.25) weightedScore += 9;

  // Innovation weight: 15%
  if (ind10_innovacion_ratio < 2) weightedScore += 15;
  else if (ind10_innovacion_ratio < 5) weightedScore += 9;

  const risk_score = Math.min(100, weightedScore);
  const risk_level = risk_score > 70 ? "CRITICO" : risk_score > 40 ? "ALERTA" : "OK";

  return {
    ...simulated,
    ind4_admin_ratio,
    ind9_payroll_ratio,
    ind10_innovacion_ratio,
    ind11_hhi,
    balance,
    tasa_ejecucion,
    risk_score,
    risk_level,
    trabajadores,
  };
}

function computeDeltas(original: ProfileRow, simulated: Partial<ProfileRow>): Record<string, { before: number; after: number; delta: number; pctChange: number }> {
  const fields = [
    "total_gastos", "balance", "gasto_admin", "gasto_pedagogico", "gasto_innovacion",
    "gasto_operacion", "gasto_infraestructura", "ind4_admin_ratio", "ind9_payroll_ratio",
    "ind10_innovacion_ratio", "ind11_hhi", "risk_score", "tasa_ejecucion", "trabajadores",
  ];
  const deltas: Record<string, { before: number; after: number; delta: number; pctChange: number }> = {};
  for (const f of fields) {
    const before = Number((original as Record<string, unknown>)[f]) || 0;
    const after = Number((simulated as Record<string, unknown>)[f]) || 0;
    const delta = after - before;
    const pctChange = before !== 0 ? Number(((delta / before) * 100).toFixed(1)) : 0;
    deltas[f] = { before, after, delta, pctChange };
  }
  return deltas;
}

/**
 * POST /api/sostenedor/simulate
 * Simulates spending scenario adjustments and generates AI narrative.
 */
export async function POST(req: NextRequest) {
  let body: SimulationRequest;
  try {
    body = await req.json();
    if (!body.sost_id || !body.periodo) {
      return NextResponse.json({ error: "sost_id y periodo son requeridos" }, { status: 400 });
    }
  } catch {
    return NextResponse.json({ error: "JSON invalido" }, { status: 400 });
  }

  const { sost_id, periodo, adjustments } = body;
  const db = getDesafioClient();

  // Fetch original profile
  const { data: profileData, error: profileErr } = await db
    .from("mv_sostenedor_profile")
    .select("*")
    .eq("sost_id", sost_id)
    .eq("periodo", periodo)
    .single();

  if (profileErr || !profileData) {
    return NextResponse.json(
      { error: `Sostenedor ${sost_id} no encontrado para periodo ${periodo}` },
      { status: 404 },
    );
  }

  const original = profileData as ProfileRow;

  // Apply adjustments
  const simGastoAdmin = applyPct(original.gasto_admin, adjustments.gasto_admin_pct);
  const simGastoPedagogico = applyPct(original.gasto_pedagogico, adjustments.gasto_pedagogico_pct);
  const simGastoInnovacion = applyPct(original.gasto_innovacion, adjustments.gasto_innovacion_pct);
  const simTrabajadores = applyPct(original.trabajadores, adjustments.trabajadores_pct);

  // If total_gastos_pct is set, scale all spending proportionally
  let simTotalGastos: number;
  if (adjustments.total_gastos_pct !== undefined && adjustments.total_gastos_pct !== 0) {
    simTotalGastos = applyPct(original.total_gastos, adjustments.total_gastos_pct);
  } else {
    // Recompute total from individual category changes
    const adminDelta = simGastoAdmin - original.gasto_admin;
    const pedDelta = simGastoPedagogico - original.gasto_pedagogico;
    const innDelta = simGastoInnovacion - original.gasto_innovacion;
    simTotalGastos = original.total_gastos + adminDelta + pedDelta + innDelta;
  }

  const simulatedRaw: Partial<ProfileRow> = {
    total_gastos: simTotalGastos,
    gasto_admin: simGastoAdmin,
    gasto_pedagogico: simGastoPedagogico,
    gasto_innovacion: simGastoInnovacion,
    gasto_operacion: original.gasto_operacion,
    gasto_infraestructura: original.gasto_infraestructura,
    trabajadores: simTrabajadores,
  };

  const simulated = recalculateIndicators(original, simulatedRaw);
  const deltas = computeDeltas(original, simulated);

  // Build response without AI narrative first
  const result = {
    original,
    simulated: { ...original, ...simulated },
    deltas,
    adjustments,
    ai_narrative: null as string | null,
  };

  // If no ANTHROPIC_API_KEY, return without AI narrative
  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json(result);
  }

  // Generate AI narrative using streaming
  const simulationContext = `
## Perfil Original (${periodo})
- Ingresos: $${original.total_ingresos?.toLocaleString("es-CL")}
- Gastos: $${original.total_gastos?.toLocaleString("es-CL")}
- Balance: $${original.balance?.toLocaleString("es-CL")}
- Gasto Admin: $${original.gasto_admin?.toLocaleString("es-CL")} (${original.ind4_admin_ratio}%)
- Gasto Pedagogico: $${original.gasto_pedagogico?.toLocaleString("es-CL")}
- Gasto Innovacion: $${original.gasto_innovacion?.toLocaleString("es-CL")} (${original.ind10_innovacion_ratio}%)
- Ind #9 Remuneraciones: ${original.ind9_payroll_ratio}%
- HHI: ${original.ind11_hhi}
- Trabajadores: ${original.trabajadores}
- Risk Score: ${original.risk_score} (${original.risk_level})

## Ajustes Aplicados
${adjustments.gasto_admin_pct ? `- Gasto Admin: ${adjustments.gasto_admin_pct > 0 ? "+" : ""}${adjustments.gasto_admin_pct}%` : ""}
${adjustments.gasto_pedagogico_pct ? `- Gasto Pedagogico: ${adjustments.gasto_pedagogico_pct > 0 ? "+" : ""}${adjustments.gasto_pedagogico_pct}%` : ""}
${adjustments.gasto_innovacion_pct ? `- Gasto Innovacion: ${adjustments.gasto_innovacion_pct > 0 ? "+" : ""}${adjustments.gasto_innovacion_pct}%` : ""}
${adjustments.total_gastos_pct ? `- Gasto Total: ${adjustments.total_gastos_pct > 0 ? "+" : ""}${adjustments.total_gastos_pct}%` : ""}
${adjustments.trabajadores_pct ? `- Trabajadores: ${adjustments.trabajadores_pct > 0 ? "+" : ""}${adjustments.trabajadores_pct}%` : ""}

## Resultado Simulado
- Gastos Simulados: $${simulated.total_gastos?.toLocaleString("es-CL")}
- Balance Simulado: $${simulated.balance?.toLocaleString("es-CL")}
- Ind #4 Admin: ${original.ind4_admin_ratio}% -> ${simulated.ind4_admin_ratio}%
- Ind #9 Remun: ${original.ind9_payroll_ratio}% -> ${simulated.ind9_payroll_ratio}%
- Ind #10 Innov: ${original.ind10_innovacion_ratio}% -> ${simulated.ind10_innovacion_ratio}%
- HHI: ${original.ind11_hhi} -> ${simulated.ind11_hhi}
- Risk Score: ${original.risk_score} -> ${simulated.risk_score} (${original.risk_level} -> ${simulated.risk_level})
- Trabajadores: ${original.trabajadores} -> ${simulated.trabajadores}

## Deltas
${JSON.stringify(deltas, null, 2)}
`;

  const systemPrompt = `Eres **Milo**, experto fiscal de la Superintendencia de Educacion de Chile. El usuario esta ejecutando una simulacion de escenarios de gasto para un sostenedor educacional.

${DOMAIN_CONTEXT}

## Tu Tarea
Analiza el escenario simulado y genera un informe ejecutivo en espanol. Estructura:

### Resumen del Escenario
2-3 oraciones describiendo que ajustes se aplicaron y su impacto general.

### Cambios en Indicadores
Tabla con cada indicador, valor original, valor simulado, cambio, y evaluacion (mejora/empeora/neutro).

### Riesgos Emergentes
Que nuevos riesgos aparecen o se agravan con estos ajustes. Ser especifico.

### Riesgos Resueltos
Que alertas o riesgos se reducen o eliminan.

### Recomendaciones
3-5 recomendaciones concretas basadas en la simulacion. Incluir acciones especificas y su impacto esperado.

## Reglas
- USA SOLO los datos proporcionados
- Formatea montos en CLP
- Se directo y accionable
- Identifica trade-offs entre categorias de gasto`;

  try {
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: 8000,
        stream: true,
        thinking: { type: "enabled", budget_tokens: 6000 },
        system: systemPrompt,
        messages: [{ role: "user", content: simulationContext }],
      }),
    });

    if (!claudeRes.ok) {
      // Return result without AI narrative on API failure
      return NextResponse.json(result);
    }

    // Stream the response
    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        // First, send the simulation data as a JSON line
        controller.enqueue(encoder.encode(JSON.stringify({
          type: "simulation_data",
          original,
          simulated: { ...original, ...simulated },
          deltas,
          adjustments,
        }) + "\n---STREAM_START---\n"));

        // Then stream the AI narrative
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
  } catch {
    // Return result without AI on error
    return NextResponse.json(result);
  }
}
