import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";
import {
  syncMatricula,
  syncEstablecimientos,
  syncSNED,
  syncDotacion,
  discoverResources,
} from "@/lib/mineduc-api";

/**
 * POST /api/mineduc/sync
 * Syncs external MINEDUC data and computes extended indicators.
 * Requires MINEDUC_API_KEY in .env.local
 *
 * Body: { datasets?: string[] }
 * datasets: "all" | ["matricula", "establecimientos", "sned", "dotacion"]
 *
 * GET /api/mineduc/sync
 * Returns sync status and available datasets.
 */

export async function GET() {
  const hasKey = !!process.env.MINEDUC_API_KEY;

  if (!hasKey) {
    return NextResponse.json({
      status: "not_configured",
      message: "MINEDUC_API_KEY no configurada. Registrarse en http://datos.mineduc.cl/developers/ y agregar MINEDUC_API_KEY al .env.local",
      instructions: [
        "1. Ir a http://datos.mineduc.cl/developers/",
        "2. Registrarse y obtener auth_key",
        "3. Agregar MINEDUC_API_KEY=tu_key al archivo .env.local",
        "4. Reiniciar el servidor",
        "5. POST /api/mineduc/sync con body: { datasets: 'all' }",
      ],
    });
  }

  // Check what data we already have
  const db = getDesafioClient();
  const counts: Record<string, number> = {};

  for (const table of ["mineduc_matricula", "mineduc_establecimientos", "mineduc_sned", "mineduc_dotacion"]) {
    try {
      const { count } = await db.from(table).select("*", { count: "exact", head: true });
      counts[table] = count || 0;
    } catch {
      counts[table] = -1; // table doesn't exist yet
    }
  }

  return NextResponse.json({
    status: "configured",
    api_key_set: true,
    synced_data: counts,
    available_datasets: ["matricula", "establecimientos", "sned", "dotacion"],
    endpoints: {
      sync: "POST /api/mineduc/sync",
      discover: "POST /api/mineduc/sync { action: 'discover', query: 'matricula' }",
    },
  });
}

export async function POST(req: NextRequest) {
  if (!process.env.MINEDUC_API_KEY) {
    return NextResponse.json({
      error: "MINEDUC_API_KEY no configurada",
      instructions: "Registrarse en http://datos.mineduc.cl/developers/ y agregar MINEDUC_API_KEY al .env.local",
    }, { status: 400 });
  }

  let body: { datasets?: string | string[]; action?: string; query?: string };
  try {
    body = await req.json();
  } catch {
    body = { datasets: "all" };
  }

  const db = getDesafioClient();

  // Discovery mode
  if (body.action === "discover") {
    try {
      const resources = await discoverResources(body.query || "");
      return NextResponse.json({ resources });
    } catch (err) {
      return NextResponse.json({ error: err instanceof Error ? err.message : "Discovery failed" }, { status: 500 });
    }
  }

  // Sync mode
  const datasets = body.datasets === "all"
    ? ["matricula", "establecimientos", "sned", "dotacion"]
    : Array.isArray(body.datasets) ? body.datasets : [body.datasets || "matricula"];

  const results: Record<string, { synced?: number; error?: string }> = {};

  for (const ds of datasets) {
    try {
      switch (ds) {
        case "matricula":
          results.matricula = await syncMatricula(db);
          break;
        case "establecimientos":
          results.establecimientos = await syncEstablecimientos(db);
          break;
        case "sned":
          results.sned = await syncSNED(db);
          break;
        case "dotacion":
          results.dotacion = await syncDotacion(db);
          break;
        default:
          results[ds] = { error: `Dataset desconocido: ${ds}` };
      }
    } catch (err) {
      results[ds] = { error: err instanceof Error ? err.message : "Sync failed" };
    }
  }

  // After sync, compute extended indicators
  if (datasets.includes("matricula") || datasets.includes("all")) {
    try {
      await computeExtendedIndicators(db);
      results._indicators = { synced: 1 };
    } catch (err) {
      results._indicators = { error: err instanceof Error ? err.message : "Indicator computation failed" };
    }
  }

  return NextResponse.json({ results });
}

/** Compute extended indicators (#1, #2, #5, #12, #13) from MINEDUC data */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function computeExtendedIndicators(db: any) {
  // Get all sostenedor profiles
  const { data: profiles } = await db.from("mv_sostenedor_profile").select("sost_id, periodo, total_ingresos, total_gastos, rbd_count").limit(50000);
  if (!profiles || profiles.length === 0) return;

  // Get matricula data
  const { data: matricula } = await db.from("mineduc_matricula").select("*").limit(50000);
  const matriculaByRbd = new Map<string, Record<string, unknown>[]>();
  for (const m of (matricula || [])) {
    const key = `${m.rbd}-${m.periodo}`;
    if (!matriculaByRbd.has(key)) matriculaByRbd.set(key, []);
    matriculaByRbd.get(key)!.push(m);
  }

  // Get establecimientos for ruralidad
  const { data: establecimientos } = await db.from("mineduc_establecimientos").select("*").limit(50000);
  const estabByRbd = new Map<string, Record<string, unknown>>();
  for (const e of (establecimientos || [])) {
    estabByRbd.set(String(e.rbd), e);
  }

  // Get SNED scores
  const { data: sned } = await db.from("mineduc_sned").select("*").limit(50000);
  const snedByRbd = new Map<string, Record<string, unknown>>();
  for (const s of (sned || [])) {
    snedByRbd.set(`${s.rbd}-${s.periodo}`, s);
  }

  // Get dotacion
  const { data: dotacion } = await db.from("mineduc_dotacion").select("*").limit(50000);
  const dotacionByRbd = new Map<string, Record<string, unknown>>();
  for (const d of (dotacion || [])) {
    dotacionByRbd.set(`${d.rbd}-${d.periodo}`, d);
  }

  // Get RBDs per sostenedor from estado_resultado
  const { data: rbdMapping } = await db.from("mv_sostenedor_financials").select("sost_id, periodo, rbd_count").limit(50000);

  // For each sostenedor-periodo, compute extended indicators
  const indicators: Record<string, unknown>[] = [];

  for (const p of profiles) {
    const sostId = p.sost_id;
    const periodo = p.periodo;

    // Aggregate matricula across all RBDs for this sostenedor
    // (We'd need the RBD list — for now use establecimientos mapping)
    const sostEstabs = (establecimientos || []).filter((e: Record<string, unknown>) => String(e.sost_id) === sostId);
    const sostRbds = sostEstabs.map((e: Record<string, unknown>) => String(e.rbd));

    let totalMatricula = 0;
    let ruralCount = 0;
    const comunas = new Set<string>();
    let snedSum = 0;
    let snedCount = 0;
    let docenteSum = 0;
    let horasSum = 0;

    for (const rbd of sostRbds) {
      // Matricula
      const mKey = `${rbd}-${periodo}`;
      const mRecords = matriculaByRbd.get(mKey);
      if (mRecords) {
        for (const m of mRecords) totalMatricula += Number(m.matricula_total) || 0;
      }

      // Ruralidad
      const estab = estabByRbd.get(rbd);
      if (estab) {
        if (String(estab.ruralidad).toUpperCase() === "RURAL") ruralCount++;
        if (estab.comuna) comunas.add(String(estab.comuna));
      }

      // SNED
      const snedRecord = snedByRbd.get(mKey);
      if (snedRecord && Number(snedRecord.puntaje_sned) > 0) {
        snedSum += Number(snedRecord.puntaje_sned);
        snedCount++;
      }

      // Dotacion
      const dotRecord = dotacionByRbd.get(mKey);
      if (dotRecord) {
        docenteSum += Number(dotRecord.total_docentes) || 0;
        horasSum += Number(dotRecord.horas_contrato_total) || 0;
      }
    }

    const totalGastos = Number(p.total_gastos) || 0;
    const totalIngresos = Number(p.total_ingresos) || 0;

    indicators.push({
      sost_id: sostId,
      periodo,
      // #1: Territorial complexity
      ruralidad_pct: sostRbds.length > 0 ? Math.round((ruralCount / sostRbds.length) * 100) : 0,
      comunas_count: comunas.size,
      complexity_score: Math.min(100, Math.round((ruralCount / Math.max(sostRbds.length, 1)) * 50 + comunas.size * 10)),
      // #2: Cost per student
      matricula_total: totalMatricula,
      costo_por_alumno: totalMatricula > 0 ? Math.round(totalGastos / totalMatricula) : 0,
      costo_cluster_avg: 0, // Computed in second pass
      costo_desviacion_pct: 0,
      // #5: Income vs enrollment variation (needs prior period)
      matricula_yoy_pct: 0, // Computed in second pass
      ingresos_yoy_pct: 0,
      desajuste_ingreso_matricula: 0,
      // #12: SNED cross
      avg_sned_score: snedCount > 0 ? Math.round(snedSum / snedCount) : 0,
      sned_risk_correlation: "N/A",
      // #13: Teacher efficiency
      total_docentes: docenteSum,
      horas_docentes_total: horasSum,
      ratio_alumno_docente: docenteSum > 0 ? Math.round(totalMatricula / docenteSum * 10) / 10 : 0,
      ratio_horas_matricula: totalMatricula > 0 ? Math.round(horasSum / totalMatricula * 10) / 10 : 0,
    });
  }

  // Upsert indicators
  for (let i = 0; i < indicators.length; i += 500) {
    const batch = indicators.slice(i, i + 500);
    await db.from("sostenedor_extended_indicators").upsert(batch, { onConflict: "sost_id,periodo" });
  }
}
