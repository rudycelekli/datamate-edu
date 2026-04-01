import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";

/**
 * GET /api/alerts
 * Deteccion automatica de alertas fiscales sobre todos los sostenedores.
 * Consulta materialized views mv_sostenedor_profile y mv_sostenedor_yoy.
 *
 * Params opcionales:
 *   periodo: filtra por periodo especifico
 *   region: filtra por region
 *   nivel: "CRITICO" | "ALERTA" | "INFO" — filtra por severidad
 *   tipo: filtra por tipo de alerta
 *   limit: maximo de alertas (default 500)
 */

// ── Types ──

interface Alert {
  sost_id: string;
  nombre: string;
  tipo: string;
  nivel: "CRITICO" | "ALERTA" | "INFO";
  descripcion: string;
  valor: number | string;
  umbral: string;
  periodo: string;
}

// ── Paginated fetch ──

async function fetchAllPaginated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
  batchSize = 1000,
  maxRows = 60000,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): Promise<any[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const all: any[] = [];
  let offset = 0;
  while (all.length < maxRows) {
    const { data, error } = await buildQuery().range(offset, offset + batchSize - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    all.push(...data);
    offset += batchSize;
    if (data.length < batchSize) break;
  }
  return all;
}

// ── Alert detection rules ──

const NIVEL_ORDER: Record<string, number> = { CRITICO: 0, ALERTA: 1, INFO: 2 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectProfileAlerts(row: any): Alert[] {
  const alerts: Alert[] = [];
  const nombre = row.nombre || row.sost_id;
  const periodo = row.periodo || "";

  const adminRatio = Number(row.ind4_admin_ratio) || 0;
  const payrollRatio = Number(row.ind9_payroll_ratio) || 0;
  const balance = Number(row.balance) || 0;
  const balanceRatio = Number(row.balance_ratio) || 0;
  const hhi = Number(row.ind11_hhi) || 0;
  const innovacionRatio = Number(row.ind10_innovacion_ratio) || 0;
  const docCoverage = Number(row.doc_coverage_ratio) || 0;

  // a) GASTO_NO_ACEPTADO_RIESGO
  if (adminRatio > 35) {
    alerts.push({
      sost_id: row.sost_id,
      nombre,
      tipo: "GASTO_NO_ACEPTADO_RIESGO",
      nivel: adminRatio > 50 ? "CRITICO" : "ALERTA",
      descripcion: `Ratio de gasto administrativo excesivo: ${adminRatio.toFixed(1)}% (umbral: 35%)`,
      valor: adminRatio,
      umbral: "35%",
      periodo,
    });
  }
  if (payrollRatio > 80) {
    alerts.push({
      sost_id: row.sost_id,
      nombre,
      tipo: "GASTO_NO_ACEPTADO_RIESGO",
      nivel: payrollRatio > 95 ? "CRITICO" : "ALERTA",
      descripcion: `Ratio de remuneraciones excesivo: ${payrollRatio.toFixed(1)}% (umbral: 80%)`,
      valor: payrollRatio,
      umbral: "80%",
      periodo,
    });
  }

  // b) DEFICIT_CRITICO
  if (balance < 0 && balanceRatio < -20) {
    alerts.push({
      sost_id: row.sost_id,
      nombre,
      tipo: "DEFICIT_CRITICO",
      nivel: "CRITICO",
      descripcion: `Deficit critico: balance ${balance.toLocaleString("es-CL")} CLP (ratio ${balanceRatio.toFixed(1)}%)`,
      valor: balance,
      umbral: "Balance < 0 y ratio < -20%",
      periodo,
    });
  }

  // c) CONCENTRACION_INGRESOS
  if (hhi > 0.25) {
    alerts.push({
      sost_id: row.sost_id,
      nombre,
      tipo: "CONCENTRACION_INGRESOS",
      nivel: hhi > 0.5 ? "CRITICO" : "ALERTA",
      descripcion: `Alta concentracion de ingresos (HHI: ${hhi.toFixed(3)}, umbral: 0.25)`,
      valor: hhi,
      umbral: "HHI > 0.25",
      periodo,
    });
  }

  // d) BAJA_INNOVACION
  if (innovacionRatio < 2 && innovacionRatio >= 0) {
    alerts.push({
      sost_id: row.sost_id,
      nombre,
      tipo: "BAJA_INNOVACION",
      nivel: innovacionRatio < 0.5 ? "ALERTA" : "INFO",
      descripcion: `Baja inversion en innovacion: ${innovacionRatio.toFixed(1)}% del gasto (umbral: 2%)`,
      valor: innovacionRatio,
      umbral: "2%",
      periodo,
    });
  }

  // f) DESAJUSTE_DOCS
  if (docCoverage > 0 && (docCoverage < 50 || docCoverage > 150)) {
    const nivel = docCoverage < 30 || docCoverage > 200 ? "CRITICO" : "ALERTA";
    alerts.push({
      sost_id: row.sost_id,
      nombre,
      tipo: "DESAJUSTE_DOCS",
      nivel,
      descripcion: `Cobertura documental fuera de rango: ${docCoverage.toFixed(1)}% (esperado: 50%-150%)`,
      valor: docCoverage,
      umbral: "50%-150%",
      periodo,
    });
  }

  // g) SOBRECARGA_REMUNERACIONES
  if (payrollRatio > 95) {
    alerts.push({
      sost_id: row.sost_id,
      nombre,
      tipo: "SOBRECARGA_REMUNERACIONES",
      nivel: "CRITICO",
      descripcion: `Sobrecarga de remuneraciones: ${payrollRatio.toFixed(1)}% del gasto total (umbral: 95%)`,
      valor: payrollRatio,
      umbral: "95%",
      periodo,
    });
  }

  return alerts;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function detectYoyAlerts(yoyRow: any, nombre: string): Alert[] {
  const alerts: Alert[] = [];
  const periodo = yoyRow.periodo || "";

  const yoyIngresos = Number(yoyRow.yoy_ingresos_pct) || 0;
  const yoyGastos = Number(yoyRow.yoy_gastos_pct) || 0;

  // e) VARIACION_ANOMALA
  if (Math.abs(yoyIngresos) > 30) {
    alerts.push({
      sost_id: yoyRow.sost_id,
      nombre,
      tipo: "VARIACION_ANOMALA",
      nivel: Math.abs(yoyIngresos) > 50 ? "CRITICO" : "ALERTA",
      descripcion: `Variacion anomala de ingresos interanual: ${yoyIngresos > 0 ? "+" : ""}${yoyIngresos.toFixed(1)}% (umbral: +/-30%)`,
      valor: yoyIngresos,
      umbral: "+/-30%",
      periodo,
    });
  }
  if (Math.abs(yoyGastos) > 30) {
    alerts.push({
      sost_id: yoyRow.sost_id,
      nombre,
      tipo: "VARIACION_ANOMALA",
      nivel: Math.abs(yoyGastos) > 50 ? "CRITICO" : "ALERTA",
      descripcion: `Variacion anomala de gastos interanual: ${yoyGastos > 0 ? "+" : ""}${yoyGastos.toFixed(1)}% (umbral: +/-30%)`,
      valor: yoyGastos,
      umbral: "+/-30%",
      periodo,
    });
  }

  return alerts;
}

// ── Route ──

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const filterPeriodo = sp.get("periodo");
    const filterRegion = sp.get("region");
    const filterNivel = sp.get("nivel");
    const filterTipo = sp.get("tipo");
    const limitParam = Math.min(Number(sp.get("limit")) || 500, 5000);

    const db = getDesafioClient();

    // 1. Fetch all profiles (paginated)
    const profiles = await fetchAllPaginated(() => {
      let q = db
        .from("mv_sostenedor_profile")
        .select("sost_id, nombre, periodo, region_rbd, total_ingresos, total_gastos, balance, balance_ratio, ind4_admin_ratio, ind9_payroll_ratio, ind10_innovacion_ratio, ind11_hhi, doc_coverage_ratio, risk_score, risk_level");
      if (filterPeriodo) q = q.eq("periodo", filterPeriodo);
      if (filterRegion) q = q.eq("region_rbd", filterRegion);
      return q;
    });

    // 2. Fetch YOY data (paginated)
    const yoyRows = await fetchAllPaginated(() => {
      let q = db
        .from("mv_sostenedor_yoy")
        .select("sost_id, periodo, yoy_ingresos_pct, yoy_gastos_pct");
      if (filterPeriodo) q = q.eq("periodo", filterPeriodo);
      return q;
    });

    // Build name map from profiles
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const nameMap = new Map<string, string>();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const p of profiles as any[]) {
      if (p.nombre && !nameMap.has(p.sost_id)) {
        nameMap.set(p.sost_id, p.nombre);
      }
    }

    // 3. Detect alerts
    let allAlerts: Alert[] = [];

    for (const profile of profiles) {
      allAlerts.push(...detectProfileAlerts(profile));
    }

    for (const yoy of yoyRows) {
      const nombre = nameMap.get(yoy.sost_id) || yoy.sost_id;
      allAlerts.push(...detectYoyAlerts(yoy, nombre));
    }

    // 4. Filter
    if (filterNivel) {
      allAlerts = allAlerts.filter((a) => a.nivel === filterNivel);
    }
    if (filterTipo) {
      allAlerts = allAlerts.filter((a) => a.tipo === filterTipo);
    }

    // 5. Sort by severity (CRITICO first), then by sost_id
    allAlerts.sort((a, b) => {
      const nivelDiff = (NIVEL_ORDER[a.nivel] ?? 9) - (NIVEL_ORDER[b.nivel] ?? 9);
      if (nivelDiff !== 0) return nivelDiff;
      return a.sost_id.localeCompare(b.sost_id);
    });

    // 6. Truncate
    const truncated = allAlerts.slice(0, limitParam);

    // 7. Summary
    const byType: Record<string, number> = {};
    const byNivel: Record<string, number> = { CRITICO: 0, ALERTA: 0, INFO: 0 };
    for (const a of allAlerts) {
      byType[a.tipo] = (byType[a.tipo] || 0) + 1;
      byNivel[a.nivel] = (byNivel[a.nivel] || 0) + 1;
    }

    return NextResponse.json({
      alertas: truncated,
      resumen: {
        total: allAlerts.length,
        mostrados: truncated.length,
        por_tipo: byType,
        por_nivel: byNivel,
        sostenedores_afectados: new Set(allAlerts.map((a) => a.sost_id)).size,
      },
      generado_en: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error al detectar alertas";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
