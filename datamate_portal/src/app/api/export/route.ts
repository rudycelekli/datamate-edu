import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";

/**
 * GET /api/export
 * Exporta datos en CSV o JSON con paginacion completa.
 *
 * Params:
 *   format: "csv" | "json" (default: csv)
 *   type: "profiles" | "alerts" | "sostenedor"
 *   sost_id: (requerido cuando type=sostenedor)
 */

const BOM = "\uFEFF"; // UTF-8 BOM para compatibilidad Excel

// ── Helpers ──

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
  for (const row of rows) {
    lines.push(headers.map((h) => escape(row[h])).join(","));
  }
  return lines.join("\n");
}

function filename(type: string, format: string, sostId?: string): string {
  const date = new Date().toISOString().slice(0, 10);
  if (sostId) return `datamate_${type}_${sostId}_${date}.${format}`;
  return `datamate_${type}_${date}.${format}`;
}

// ── Route ──

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const format = sp.get("format") === "json" ? "json" : "csv";
    const type = sp.get("type") || "profiles";
    const sostId = sp.get("sost_id");

    const db = getDesafioClient();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let rows: any[] = [];

    switch (type) {
      case "profiles": {
        rows = await fetchAllPaginated(() =>
          db
            .from("mv_sostenedor_profile")
            .select("sost_id, nombre, rut, periodo, region_rbd, dependencia_rbd, rbd_count, total_ingresos, total_gastos, balance, balance_ratio, ind4_admin_ratio, ind4_level, ind9_payroll_ratio, ind9_level, ind10_innovacion_ratio, ind11_hhi, ind11_level, doc_count, doc_monto, doc_coverage_ratio, trabajadores, risk_score, risk_level")
            .order("risk_score", { ascending: false }),
        );
        break;
      }

      case "alerts": {
        // Fetch profiles, filter to flagged only
        const all = await fetchAllPaginated(() =>
          db
            .from("mv_sostenedor_profile")
            .select("sost_id, nombre, rut, periodo, region_rbd, dependencia_rbd, total_ingresos, total_gastos, balance, balance_ratio, ind4_admin_ratio, ind9_payroll_ratio, ind10_innovacion_ratio, ind11_hhi, doc_coverage_ratio, risk_score, risk_level")
            .order("risk_score", { ascending: false }),
        );
        rows = all.filter(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (r: any) => r.risk_level === "CRITICO" || r.risk_level === "ALERTA",
        );
        break;
      }

      case "sostenedor": {
        if (!sostId) {
          return NextResponse.json(
            { error: "sost_id es requerido para type=sostenedor" },
            { status: 400 },
          );
        }
        const [profileRes, yoyRes] = await Promise.all([
          db.from("mv_sostenedor_profile").select("*").eq("sost_id", sostId).order("periodo"),
          db.from("mv_sostenedor_yoy").select("*").eq("sost_id", sostId).order("periodo"),
        ]);
        if (profileRes.error) throw new Error(profileRes.error.message);
        rows = (profileRes.data || []).map((p: Record<string, unknown>) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const yoy = (yoyRes.data || []).find((y: any) => y.periodo === p.periodo);
          return { ...p, ...(yoy ? { yoy_ingresos_pct: yoy.yoy_ingresos_pct, yoy_gastos_pct: yoy.yoy_gastos_pct } : {}) };
        });
        break;
      }

      default:
        return NextResponse.json(
          { error: `Tipo no valido: ${type}. Usar: profiles, alerts, sostenedor` },
          { status: 400 },
        );
    }

    // ── Format response ──

    if (format === "json") {
      const body = JSON.stringify({ data: rows, total: rows.length, exported_at: new Date().toISOString() }, null, 2);
      return new Response(body, {
        status: 200,
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename(type, "json", sostId || undefined)}"`,
        },
      });
    }

    // CSV with BOM
    const csv = BOM + toCsv(rows);
    return new Response(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename(type, "csv", sostId || undefined)}"`,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error al exportar";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
