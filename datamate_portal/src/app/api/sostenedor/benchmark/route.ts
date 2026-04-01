import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";

/* ------------------------------------------------------------------ */
/*  GET /api/sostenedor/benchmark?sost_id=X&periodo=Y                  */
/*  Compara un sostenedor contra pares similares del mismo periodo.     */
/* ------------------------------------------------------------------ */

interface ProfileRow {
  sost_id: string;
  periodo: string;
  nombre: string;
  rut: string;
  region_rbd: string;
  dependencia_rbd: string;
  rbd_count: number;
  total_ingresos: number;
  total_gastos: number;
  balance: number;
  ind4_admin_ratio: number;
  ind9_payroll_ratio: number;
  ind10_innovacion_ratio: number;
  ind11_hhi: number;
  risk_score: number;
  risk_level: string;
  trabajadores: number;
  doc_count: number;
  tasa_ejecucion: number;
}

/* ---------- helpers ---------- */

/** Paginated fetch past the 1000-row Supabase limit. */
async function fetchAllRows(
  db: ReturnType<typeof getDesafioClient>,
  query: { dependencia: string; periodo: string },
): Promise<ProfileRow[]> {
  const rows: ProfileRow[] = [];
  let offset = 0;
  const batch = 1000;
  while (true) {
    const { data, error } = await db
      .from("mv_sostenedor_profile")
      .select("*")
      .eq("dependencia_rbd", query.dependencia)
      .eq("periodo", query.periodo)
      .range(offset, offset + batch - 1);
    if (error) throw new Error(error.message);
    if (!data || data.length === 0) break;
    rows.push(...(data as ProfileRow[]));
    offset += batch;
    if (data.length < batch) break;
  }
  return rows;
}

function median(arr: number[]): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function avg(arr: number[]): number {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

/** Percentile rank (0-100): % of peers the target is >= */
function percentileRank(value: number, arr: number[]): number {
  if (arr.length === 0) return 50;
  const below = arr.filter((v) => v < value).length;
  const equal = arr.filter((v) => v === value).length;
  return ((below + equal * 0.5) / arr.length) * 100;
}

/** Deviation from the average as a percentage */
function deviationPct(value: number, average: number): number {
  if (average === 0) return 0;
  return ((value - average) / Math.abs(average)) * 100;
}

/* The indicators we benchmark */
const INDICATORS = [
  { key: "total_ingresos", label: "Total Ingresos", higherIsBetter: true, isCurrency: true },
  { key: "total_gastos", label: "Total Gastos", higherIsBetter: false, isCurrency: true },
  { key: "balance", label: "Saldo (Balance)", higherIsBetter: true, isCurrency: true },
  { key: "ind4_admin_ratio", label: "#4 Concentracion Admin (%)", higherIsBetter: false, isCurrency: false },
  { key: "ind9_payroll_ratio", label: "#9 Gasto Remuneracional (%)", higherIsBetter: false, isCurrency: false },
  { key: "ind10_innovacion_ratio", label: "#10 Innovacion Pedagogica (%)", higherIsBetter: true, isCurrency: false },
  { key: "ind11_hhi", label: "#11 Concentracion HHI", higherIsBetter: false, isCurrency: false },
  { key: "risk_score", label: "Puntaje de Riesgo", higherIsBetter: false, isCurrency: false },
  { key: "rbd_count", label: "Establecimientos (RBD)", higherIsBetter: true, isCurrency: false },
  { key: "trabajadores", label: "Trabajadores", higherIsBetter: true, isCurrency: false },
  { key: "tasa_ejecucion", label: "Tasa de Ejecucion (%)", higherIsBetter: true, isCurrency: false },
] as const;

type IndicatorKey = (typeof INDICATORS)[number]["key"];

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sostId = searchParams.get("sost_id");
    const periodo = searchParams.get("periodo");

    if (!sostId || !periodo) {
      return NextResponse.json(
        { error: "Parametros requeridos: sost_id y periodo" },
        { status: 400 },
      );
    }

    const db = getDesafioClient();

    /* 1. Fetch the target sostenedor */
    const { data: targetRows, error: tErr } = await db
      .from("mv_sostenedor_profile")
      .select("*")
      .eq("sost_id", sostId)
      .eq("periodo", periodo)
      .limit(1);

    if (tErr) throw new Error(tErr.message);
    if (!targetRows || targetRows.length === 0) {
      return NextResponse.json(
        { error: "Sostenedor no encontrado para el periodo indicado" },
        { status: 404 },
      );
    }
    const target = targetRows[0] as ProfileRow;

    /* 2. Fetch all peers with same dependencia + periodo */
    const allPeers = await fetchAllRows(db, {
      dependencia: target.dependencia_rbd,
      periodo,
    });

    /* 3. Narrow to similar rbd_count (±50%) — if too few, keep all */
    const minRbd = Math.floor(target.rbd_count * 0.5);
    const maxRbd = Math.ceil(target.rbd_count * 1.5);
    let peers = allPeers.filter(
      (p) => p.sost_id !== sostId && p.rbd_count >= minRbd && p.rbd_count <= maxRbd,
    );

    let peerCriteria = "misma dependencia + tamano similar (±50% establecimientos)";
    if (peers.length < 5) {
      peers = allPeers.filter((p) => p.sost_id !== sostId);
      peerCriteria = "misma dependencia (grupo ampliado)";
    }

    /* 4. Compute stats per indicator */
    const comparisons = INDICATORS.map((ind) => {
      const key = ind.key as IndicatorKey;
      const targetVal = ((target as unknown) as Record<string, unknown>)[key] as number ?? 0;
      const peerVals = peers
        .map((p) => ((p as unknown) as Record<string, unknown>)[key] as number ?? 0)
        .filter((v) => v !== null && v !== undefined);

      const peerAvg = avg(peerVals);
      const peerMed = median(peerVals);
      const pctRank = percentileRank(targetVal, peerVals);
      const deviation = deviationPct(targetVal, peerAvg);

      // Status: compare value against average
      let status: "mejor" | "similar" | "peor";
      const threshold = 10; // ±10% from mean = similar
      if (ind.higherIsBetter) {
        status = deviation > threshold ? "mejor" : deviation < -threshold ? "peor" : "similar";
      } else {
        status = deviation < -threshold ? "mejor" : deviation > threshold ? "peor" : "similar";
      }

      return {
        key,
        label: ind.label,
        higherIsBetter: ind.higherIsBetter,
        isCurrency: ind.isCurrency,
        targetValue: targetVal,
        peerAvg: Math.round(peerAvg * 100) / 100,
        peerMedian: Math.round(peerMed * 100) / 100,
        percentile: Math.round(pctRank * 10) / 10,
        deviationPct: Math.round(deviation * 10) / 10,
        status,
        peerMin: peerVals.length > 0 ? Math.min(...peerVals) : 0,
        peerMax: peerVals.length > 0 ? Math.max(...peerVals) : 0,
      };
    });

    /* 5. Generate textual insights */
    const insights: string[] = [];
    for (const c of comparisons) {
      if (c.status === "peor" && Math.abs(c.deviationPct) > 25) {
        insights.push(
          `${c.label}: se desvía un ${Math.abs(c.deviationPct).toFixed(0)}% ${c.higherIsBetter ? "por debajo" : "por encima"} del promedio de pares. Requiere atencion.`,
        );
      } else if (c.status === "mejor" && Math.abs(c.deviationPct) > 25) {
        insights.push(
          `${c.label}: destaca positivamente, ${Math.abs(c.deviationPct).toFixed(0)}% ${c.higherIsBetter ? "sobre" : "bajo"} el promedio de pares.`,
        );
      }
    }

    if (insights.length === 0) {
      insights.push("El sostenedor se encuentra dentro de rangos normales respecto a sus pares.");
    }

    return NextResponse.json({
      target: {
        sost_id: target.sost_id,
        nombre: target.nombre,
        rut: target.rut,
        dependencia_rbd: target.dependencia_rbd,
        region_rbd: target.region_rbd,
        rbd_count: target.rbd_count,
        periodo: target.periodo,
        risk_score: target.risk_score,
        risk_level: target.risk_level,
      },
      peerCount: peers.length,
      peerCriteria,
      comparisons,
      insights,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error desconocido";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
