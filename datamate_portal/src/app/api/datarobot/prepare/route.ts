import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";

/**
 * GET /api/datarobot/prepare
 * Exports properly-framed datasets for DataRobot. Each use case is
 * structured so that:
 *   - Every row represents the same grain (one sostenedor × one periodo)
 *   - The target column comes from a FUTURE period (supervised) or is absent (unsupervised)
 *   - No feature column contains information derivable from the target at prediction time
 *
 * ?usecase=risk_classification   → Predict NEXT period risk level (CRITICO/ALERTA/OK)
 * ?usecase=gasto_prediction      → Predict NEXT period total_gastos
 * ?usecase=anomaly_detection     → No target; unsupervised clustering / anomaly detection
 * ?usecase=yoy_variance          → Predict NEXT period yoy_gastos_pct (is spending accelerating?)
 * ?format=json|csv               → Output format (default: csv)
 */

const BOM = "\uFEFF";

async function fetchAllPaginated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
  batchSize = 1000,
  maxRows = 100000,
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

function toCsv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return "";
  const headers = Object.keys(rows[0]);
  const escape = (v: unknown): string => {
    const s = v == null ? "" : String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  };
  const lines = [headers.join(",")];
  for (const row of rows) lines.push(headers.map(h => escape(row[h])).join(","));
  return lines.join("\n");
}

function filename(usecase: string, format: string): string {
  return `datarobot_${usecase}_${new Date().toISOString().slice(0, 10)}.${format}`;
}

/**
 * Features known AT prediction time for a given sostenedor-periodo.
 * Does NOT include risk_score, risk_level, or any derived risk label —
 * those are either the target or computed from target-related logic.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function featuresFromProfile(p: any): Record<string, unknown> {
  const rbd_count = Number(p.rbd_count) || 0;
  const trabajadores = Number(p.trabajadores) || 0;
  const total_ingresos = Number(p.total_ingresos) || 0;
  const total_gastos = Number(p.total_gastos) || 0;
  const total_haberes = Number(p.total_haberes) || 0;

  return {
    // ── Identity (kept for DataRobot partition / display, not used as features)
    sost_id: p.sost_id,
    nombre: p.nombre || "",
    rut: p.rut || "",
    periodo: p.periodo,
    region_rbd: p.region_rbd || "",
    dependencia_rbd: p.dependencia_rbd || "",   // free-text categorical — DataRobot handles it

    // ── Scale features
    rbd_count,
    trabajadores,
    doc_count: Number(p.doc_count) || 0,
    proveedores_unicos: Number(p.proveedores_unicos) || 0,

    // ── Financial absolutes
    total_ingresos,
    total_gastos,
    balance: Number(p.balance) || 0,
    gasto_admin: Number(p.gasto_admin) || 0,
    gasto_pedagogico: Number(p.gasto_pedagogico) || 0,
    gasto_innovacion: Number(p.gasto_innovacion) || 0,
    gasto_operacion: Number(p.gasto_operacion) || 0,
    gasto_infraestructura: Number(p.gasto_infraestructura) || 0,
    total_haberes,
    doc_monto: Number(p.doc_monto) || 0,

    // ── Ratios (known at report time, no leakage)
    balance_ratio: Number(p.balance_ratio) || 0,
    ind4_admin_ratio: Number(p.ind4_admin_ratio) || 0,
    ind9_payroll_ratio: Number(p.ind9_payroll_ratio) || 0,
    ind10_innovacion_ratio: Number(p.ind10_innovacion_ratio) || 0,
    ind11_hhi: Number(p.ind11_hhi) || 0,
    doc_coverage_ratio: Number(p.doc_coverage_ratio) || 0,
    tasa_ejecucion: Number(p.tasa_ejecucion) || 0,

    // ── Per-unit derived features
    ingresos_per_rbd: rbd_count > 0 ? Math.round(total_ingresos / rbd_count) : 0,
    gastos_per_trabajador: trabajadores > 0 ? Math.round(total_gastos / trabajadores) : 0,
    haberes_per_trabajador: trabajadores > 0 ? Math.round(total_haberes / trabajadores) : 0,
  };
}

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const usecase = sp.get("usecase") || "risk_classification";
    const format = sp.get("format") === "json" ? "json" : "csv";

    const db = getDesafioClient();

    // Fetch all profiles sorted by sost_id then periodo
    const profiles = await fetchAllPaginated(() =>
      db.from("mv_sostenedor_profile")
        .select("*")
        .order("sost_id")
        .order("periodo"),
    );

    if (profiles.length === 0) {
      return NextResponse.json({ error: "No hay datos en mv_sostenedor_profile" }, { status: 404 });
    }

    // Fetch YOY data
    const yoyRows = await fetchAllPaginated(() =>
      db.from("mv_sostenedor_yoy")
        .select("sost_id, periodo, yoy_ingresos_pct, yoy_gastos_pct, yoy_balance_pct"),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const yoyMap = new Map<string, any>();
    for (const y of yoyRows) yoyMap.set(`${y.sost_id}-${y.periodo}`, y);

    // Group profiles by sost_id, sorted by periodo (already sorted above)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const byId = new Map<string, any[]>();
    for (const p of profiles) {
      const arr = byId.get(p.sost_id) || [];
      arr.push(p);
      byId.set(p.sost_id, arr);
    }

    let rows: Record<string, unknown>[] = [];

    switch (usecase) {

      // ── USE CASE 1: Risk Classification ────────────────────────────────────
      // Grain   : sostenedor × periodo_T
      // Features: all financial/ratio features from periodo_T
      //           + yoy change from T-1→T (available at prediction time for period T)
      // Target  : risk_label of periodo_T+1
      //
      // Framing: "Given what we observe about a sostenedor at end of period T,
      //           what risk level will their NEXT annual report show?"
      // No leakage: risk_score and risk_level are EXCLUDED from features.
      //             They belong to the SAME period as the target.
      case "risk_classification": {
        for (const [, arr] of byId) {
          for (let i = 0; i < arr.length - 1; i++) {  // stop at second-to-last: need T+1 as target
            const cur = arr[i];    // period T — these become features
            const nxt = arr[i + 1]; // period T+1 — target comes from here

            const yoy = yoyMap.get(`${cur.sost_id}-${cur.periodo}`);
            const features = featuresFromProfile(cur);

            rows.push({
              ...features,
              // YOY changes for period T (known at end of T, no leakage)
              yoy_ingresos_pct: yoy ? Number(yoy.yoy_ingresos_pct) || 0 : null,
              yoy_gastos_pct: yoy ? Number(yoy.yoy_gastos_pct) || 0 : null,
              yoy_balance_pct: yoy ? Number(yoy.yoy_balance_pct) || 0 : null,
              // Target columns (from future period T+1)
              target_periodo: nxt.periodo,
              target_risk_label: nxt.risk_level === "CRITICO" ? 2 : nxt.risk_level === "ALERTA" ? 1 : 0,
              target_risk_level: nxt.risk_level || "OK",  // string version for reference
            });
          }

          // Last period = scoring row (no known future target yet)
          const last = arr[arr.length - 1];
          const yoyLast = yoyMap.get(`${last.sost_id}-${last.periodo}`);
          rows.push({
            ...featuresFromProfile(last),
            yoy_ingresos_pct: yoyLast ? Number(yoyLast.yoy_ingresos_pct) || 0 : null,
            yoy_gastos_pct: yoyLast ? Number(yoyLast.yoy_gastos_pct) || 0 : null,
            yoy_balance_pct: yoyLast ? Number(yoyLast.yoy_balance_pct) || 0 : null,
            target_periodo: null,
            target_risk_label: null,   // null = DataRobot will predict this
            target_risk_level: null,
          });
        }
        break;
      }

      // ── USE CASE 2: Gasto Prediction ───────────────────────────────────────
      // Grain   : sostenedor × periodo_T
      // Features: financial features from T + lag-1 features from T-1
      //           + yoy changes T-1→T
      // Target  : total_gastos of periodo_T+1
      //
      // Framing: "Given spending patterns through period T, how much will
      //           this sostenedor spend in period T+1?"
      // No leakage: total_gastos of period T is a feature (it IS known at T),
      //             target is total_gastos of T+1 (future, unknown at T).
      case "gasto_prediction": {
        for (const [, arr] of byId) {
          for (let i = 0; i < arr.length - 1; i++) {
            const cur = arr[i];
            const prev = i > 0 ? arr[i - 1] : null;
            const nxt = arr[i + 1];
            const yoy = yoyMap.get(`${cur.sost_id}-${cur.periodo}`);

            rows.push({
              sost_id: cur.sost_id,
              nombre: cur.nombre || "",
              periodo: cur.periodo,
              dependencia_rbd: cur.dependencia_rbd || "",
              region_rbd: cur.region_rbd || "",

              // Current period (T) features
              rbd_count: Number(cur.rbd_count) || 0,
              trabajadores: Number(cur.trabajadores) || 0,
              total_ingresos: Number(cur.total_ingresos) || 0,
              total_gastos: Number(cur.total_gastos) || 0,
              balance: Number(cur.balance) || 0,
              gasto_admin: Number(cur.gasto_admin) || 0,
              gasto_pedagogico: Number(cur.gasto_pedagogico) || 0,
              gasto_innovacion: Number(cur.gasto_innovacion) || 0,
              total_haberes: Number(cur.total_haberes) || 0,
              ind4_admin_ratio: Number(cur.ind4_admin_ratio) || 0,
              ind9_payroll_ratio: Number(cur.ind9_payroll_ratio) || 0,
              ind10_innovacion_ratio: Number(cur.ind10_innovacion_ratio) || 0,
              ind11_hhi: Number(cur.ind11_hhi) || 0,
              tasa_ejecucion: Number(cur.tasa_ejecucion) || 0,
              balance_ratio: Number(cur.balance_ratio) || 0,
              doc_count: Number(cur.doc_count) || 0,

              // Lag-1 features (T-1) — context from prior period
              lag1_total_gastos: prev ? Number(prev.total_gastos) || 0 : null,
              lag1_total_ingresos: prev ? Number(prev.total_ingresos) || 0 : null,
              lag1_balance: prev ? Number(prev.balance) || 0 : null,
              lag1_trabajadores: prev ? Number(prev.trabajadores) || 0 : null,
              lag1_ind4_admin_ratio: prev ? Number(prev.ind4_admin_ratio) || 0 : null,
              lag1_ind9_payroll_ratio: prev ? Number(prev.ind9_payroll_ratio) || 0 : null,

              // YOY change from T-1→T (known at end of T)
              yoy_ingresos_pct: yoy ? Number(yoy.yoy_ingresos_pct) || 0 : null,
              yoy_gastos_pct: yoy ? Number(yoy.yoy_gastos_pct) || 0 : null,
              yoy_balance_pct: yoy ? Number(yoy.yoy_balance_pct) || 0 : null,

              // Target: T+1 spending (future, no leakage)
              target_periodo: nxt.periodo,
              target_total_gastos: Number(nxt.total_gastos) || 0,
            });
          }

          // Scoring row (latest period, no future target yet)
          const last = arr[arr.length - 1];
          const prev = arr.length >= 2 ? arr[arr.length - 2] : null;
          const yoyLast = yoyMap.get(`${last.sost_id}-${last.periodo}`);
          rows.push({
            sost_id: last.sost_id,
            nombre: last.nombre || "",
            periodo: last.periodo,
            dependencia_rbd: last.dependencia_rbd || "",
            region_rbd: last.region_rbd || "",
            rbd_count: Number(last.rbd_count) || 0,
            trabajadores: Number(last.trabajadores) || 0,
            total_ingresos: Number(last.total_ingresos) || 0,
            total_gastos: Number(last.total_gastos) || 0,
            balance: Number(last.balance) || 0,
            gasto_admin: Number(last.gasto_admin) || 0,
            gasto_pedagogico: Number(last.gasto_pedagogico) || 0,
            gasto_innovacion: Number(last.gasto_innovacion) || 0,
            total_haberes: Number(last.total_haberes) || 0,
            ind4_admin_ratio: Number(last.ind4_admin_ratio) || 0,
            ind9_payroll_ratio: Number(last.ind9_payroll_ratio) || 0,
            ind10_innovacion_ratio: Number(last.ind10_innovacion_ratio) || 0,
            ind11_hhi: Number(last.ind11_hhi) || 0,
            tasa_ejecucion: Number(last.tasa_ejecucion) || 0,
            balance_ratio: Number(last.balance_ratio) || 0,
            doc_count: Number(last.doc_count) || 0,
            lag1_total_gastos: prev ? Number(prev.total_gastos) || 0 : null,
            lag1_total_ingresos: prev ? Number(prev.total_ingresos) || 0 : null,
            lag1_balance: prev ? Number(prev.balance) || 0 : null,
            lag1_trabajadores: prev ? Number(prev.trabajadores) || 0 : null,
            lag1_ind4_admin_ratio: prev ? Number(prev.ind4_admin_ratio) || 0 : null,
            lag1_ind9_payroll_ratio: prev ? Number(prev.ind9_payroll_ratio) || 0 : null,
            yoy_ingresos_pct: yoyLast ? Number(yoyLast.yoy_ingresos_pct) || 0 : null,
            yoy_gastos_pct: yoyLast ? Number(yoyLast.yoy_gastos_pct) || 0 : null,
            yoy_balance_pct: yoyLast ? Number(yoyLast.yoy_balance_pct) || 0 : null,
            target_periodo: null,
            target_total_gastos: null,  // null = DataRobot will score this
          });
        }
        break;
      }

      // ── USE CASE 3: Anomaly Detection / Clustering ─────────────────────────
      // Grain   : sostenedor × periodo
      // No target. One row per sostenedor per period.
      // DataRobot: Unsupervised anomaly detection, k-means clustering, DBSCAN, etc.
      // All features are known at that period — no time-shift needed.
      case "anomaly_detection": {
        rows = profiles.map(p => {
          const yoy = yoyMap.get(`${p.sost_id}-${p.periodo}`);
          return {
            ...featuresFromProfile(p),
            // YOY for this period (contextual, no target)
            yoy_ingresos_pct: yoy ? Number(yoy.yoy_ingresos_pct) || 0 : null,
            yoy_gastos_pct: yoy ? Number(yoy.yoy_gastos_pct) || 0 : null,
            yoy_balance_pct: yoy ? Number(yoy.yoy_balance_pct) || 0 : null,
            // Include risk_level as a label column for post-hoc validation only
            // (NOT a feature — mark as partition/ID in DataRobot)
            risk_level: p.risk_level || "OK",
            risk_score: Number(p.risk_score) || 0,
          };
        });
        break;
      }

      // ── USE CASE 4: YOY Variance Prediction ────────────────────────────────
      // Grain   : sostenedor × periodo_T
      // Features: financial features from T + yoy_ingresos_pct from T (income side known)
      // Target  : yoy_gastos_pct of periodo_T+1 (is spending growth accelerating?)
      //
      // Framing: "Given the income trend and spending profile observed in period T,
      //           will spending GROW or SHRINK in the next reporting period?"
      // No leakage: yoy_gastos_pct for period T is NOT a feature when
      //             yoy_gastos_pct for T+1 is the target.
      //             flag_yoy_gastos_anomalo is derived from target — excluded.
      case "yoy_variance": {
        for (const [, arr] of byId) {
          for (let i = 0; i < arr.length - 1; i++) {
            const cur = arr[i];
            const nxt = arr[i + 1];

            const yoyCur = yoyMap.get(`${cur.sost_id}-${cur.periodo}`);
            const yoyNxt = yoyMap.get(`${nxt.sost_id}-${nxt.periodo}`);
            const features = featuresFromProfile(cur);

            rows.push({
              ...features,
              // Income-side YOY for period T (safe feature: different from spending target)
              yoy_ingresos_pct: yoyCur ? Number(yoyCur.yoy_ingresos_pct) || 0 : null,
              yoy_balance_pct: yoyCur ? Number(yoyCur.yoy_balance_pct) || 0 : null,
              // NOTE: yoy_gastos_pct for period T is intentionally excluded —
              //       the model should predict spending growth from income/balance signals.

              // Anomaly flag based on INCOME side only (no leakage)
              flag_yoy_ingresos_anomalo: Math.abs(Number(yoyCur?.yoy_ingresos_pct) || 0) > 30 ? 1 : 0,
              flag_deficit_actual: (Number(cur.balance) || 0) < 0 ? 1 : 0,

              // Target: T+1 spending YOY change (future, unknown at T)
              target_periodo: nxt.periodo,
              target_yoy_gastos_pct: yoyNxt ? Number(yoyNxt.yoy_gastos_pct) || 0 : null,
              // Binary version for classification variant: 1 = spending accelerating >10%
              target_gasto_acelerando: yoyNxt && Number(yoyNxt.yoy_gastos_pct) > 10 ? 1 : 0,
            });
          }

          // Scoring row
          const last = arr[arr.length - 1];
          const yoyLast = yoyMap.get(`${last.sost_id}-${last.periodo}`);
          rows.push({
            ...featuresFromProfile(last),
            yoy_ingresos_pct: yoyLast ? Number(yoyLast.yoy_ingresos_pct) || 0 : null,
            yoy_balance_pct: yoyLast ? Number(yoyLast.yoy_balance_pct) || 0 : null,
            flag_yoy_ingresos_anomalo: Math.abs(Number(yoyLast?.yoy_ingresos_pct) || 0) > 30 ? 1 : 0,
            flag_deficit_actual: (Number(last.balance) || 0) < 0 ? 1 : 0,
            target_periodo: null,
            target_yoy_gastos_pct: null,
            target_gasto_acelerando: null,
          });
        }
        break;
      }

      default:
        return NextResponse.json(
          { error: `Caso de uso no válido: ${usecase}. Usar: risk_classification, gasto_prediction, anomaly_detection, yoy_variance` },
          { status: 400 },
        );
    }

    const descriptions: Record<string, string> = {
      risk_classification: "Clasificación multi-clase. Predice risk_level del período T+1 a partir de features del período T. Filas sin target = datos para scoring.",
      gasto_prediction: "Regresión. Predice total_gastos del período T+1 usando features del período T + lag-1. Filas sin target = datos para scoring.",
      anomaly_detection: "Sin supervisión. Una fila por sostenedor×período. Usar para clustering o detección de anomalías. risk_level/risk_score son labels de validación, no features.",
      yoy_variance: "Regresión/clasificación. Predice si el gasto crecerá en el siguiente período. Features = período T; target = yoy_gastos_pct del período T+1.",
    };

    const trainingRows = rows.filter(r => r.target_risk_label !== null || r.target_total_gastos !== null || r.target_yoy_gastos_pct !== null || usecase === "anomaly_detection").length;

    if (format === "json") {
      return new Response(
        JSON.stringify({
          usecase,
          description: descriptions[usecase],
          total_rows: rows.length,
          training_rows: usecase === "anomaly_detection" ? rows.length : trainingRows,
          scoring_rows: usecase === "anomaly_detection" ? 0 : rows.length - trainingRows,
          generated_at: new Date().toISOString(),
          data: rows,
        }, null, 2),
        {
          status: 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition": `attachment; filename="${filename(usecase, "json")}"`,
          },
        },
      );
    }

    const csv = BOM + toCsv(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename(usecase, "csv")}"`,
        "X-DataRobot-Usecase": usecase,
        "X-DataRobot-Rows": String(rows.length),
        "X-DataRobot-Training-Rows": String(usecase === "anomaly_detection" ? rows.length : trainingRows),
      },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error al preparar datos";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
