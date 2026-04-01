import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";

/**
 * GET /api/sostenedor/acreditacion?sost_id=X&periodo=Y
 *
 * Indicador #6 — Acreditación de Saldos
 * Reconciles the declared balance in estado_resultado against
 * the sum of supporting documents in the documentos table.
 *
 * Logic:
 *   - "Declared" = SUM(MONTO_DECLARADO) from estado_resultado grouped by tipo_cuenta
 *   - "Documented" = SUM(MONTO_DECLARADO) from documentos table for same sost_id+periodo
 *   - Coverage ratio = documented / declared_gastos
 *   - Gap = declared_gastos - documented_gastos
 *   - Risk level based on coverage and gap size
 *
 * Also returns per-account reconciliation (top accounts by gap).
 */

async function fetchPaginated(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => any,
  batchSize = 1000,
  maxRows = 50000,
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

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sostId = sp.get("sost_id");
  const periodo = sp.get("periodo");

  if (!sostId || !periodo) {
    return NextResponse.json({ error: "sost_id y periodo son requeridos" }, { status: 400 });
  }

  try {
    const db = getDesafioClient();

    // ── 1. Pull estado_resultado for this sostenedor+periodo ──
    const erRows = await fetchPaginated(() =>
      db.from("estado_resultado")
        .select("desc_tipo_cuenta, cuenta_alias, desc_cuenta, monto_declarado, desc_estado")
        .eq("sost_id", sostId)
        .eq("periodo", periodo),
    );

    // ── 2. Pull documentos for same sostenedor+periodo ──
    const docRows = await fetchPaginated(() =>
      db.from("documentos")
        .select("cuenta_alias, desc_cuenta, monto_declarado, monto_total, tipo_docs_alias")
        .eq("sost_id", sostId)
        .eq("periodo", periodo),
    );

    if (erRows.length === 0) {
      return NextResponse.json({
        error: `Sin datos en estado_resultado para sostenedor ${sostId} en periodo ${periodo}`,
      }, { status: 404 });
    }

    // ── 3. Aggregate estado_resultado by tipo_cuenta ──
    let declaredIngresos = 0;
    let declaredGastos = 0;
    let gnaAmount = 0; // Gastos No Aceptados (non-standard desc_estado)

    // Per-account declared gastos
    const declaredByCuenta = new Map<string, { desc_cuenta: string; declared: number; estado_counts: Record<string, number> }>();
    // All distinct desc_estado values seen
    const estadoTotals = new Map<string, number>();

    for (const row of erRows) {
      const monto = Number(row.monto_declarado) || 0;
      const tipo = String(row.desc_tipo_cuenta || "").toLowerCase();
      const cuenta = String(row.cuenta_alias || "");
      const descCuenta = String(row.desc_cuenta || "");
      const estado = String(row.desc_estado || "").trim();

      if (tipo === "ingreso") {
        declaredIngresos += monto;
      } else {
        declaredGastos += monto;

        // Track by account
        if (!declaredByCuenta.has(cuenta)) {
          declaredByCuenta.set(cuenta, { desc_cuenta: descCuenta, declared: 0, estado_counts: {} });
        }
        const acc = declaredByCuenta.get(cuenta)!;
        acc.declared += monto;
        if (estado) acc.estado_counts[estado] = (acc.estado_counts[estado] || 0) + 1;
      }

      // Track all estado values
      if (estado) {
        estadoTotals.set(estado, (estadoTotals.get(estado) || 0) + monto);
      }

      // GNA: expenses whose desc_estado suggests non-acceptance
      // Common values: "Observado", "Rechazado", "No Aceptado", "Con Observacion"
      if (tipo !== "ingreso" && estado && !isAccepted(estado)) {
        gnaAmount += monto;
      }
    }

    // ── 4. Aggregate documentos by cuenta_alias ──
    let documentedTotal = 0;
    const documentedByCuenta = new Map<string, number>();
    const docsByType = new Map<string, number>();

    for (const doc of docRows) {
      const monto = Number(doc.monto_declarado) || 0;
      const cuenta = String(doc.cuenta_alias || "");
      const tipo = String(doc.tipo_docs_alias || "");

      documentedTotal += monto;
      documentedByCuenta.set(cuenta, (documentedByCuenta.get(cuenta) || 0) + monto);
      if (tipo) docsByType.set(tipo, (docsByType.get(tipo) || 0) + monto);
    }

    // ── 5. Per-account reconciliation ──
    const accountRecon: {
      cuenta_alias: string;
      desc_cuenta: string;
      declared: number;
      documented: number;
      gap: number;
      coverage_pct: number;
      status: string;
    }[] = [];

    for (const [cuenta, info] of declaredByCuenta) {
      const documented = documentedByCuenta.get(cuenta) || 0;
      const gap = info.declared - documented;
      const coverage_pct = info.declared > 0 ? Math.round((documented / info.declared) * 1000) / 10 : 0;
      accountRecon.push({
        cuenta_alias: cuenta,
        desc_cuenta: info.desc_cuenta,
        declared: info.declared,
        documented,
        gap,
        coverage_pct,
        status: coverage_pct >= 80 ? "OK" : coverage_pct >= 50 ? "ALERTA" : "CRITICO",
      });
    }

    // Sort by gap descending (largest gaps first)
    accountRecon.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap));

    // ── 6. Summary metrics ──
    const declaredBalance = declaredIngresos - declaredGastos;
    const coverageRatio = declaredGastos > 0 ? (documentedTotal / declaredGastos) * 100 : 0;
    const totalGap = declaredGastos - documentedTotal;
    const gnaRatio = declaredGastos > 0 ? (gnaAmount / declaredGastos) * 100 : 0;

    // Risk level
    let riskLevel: "OK" | "ALERTA" | "CRITICO" = "OK";
    if (coverageRatio < 50 || gnaRatio > 20) riskLevel = "CRITICO";
    else if (coverageRatio < 80 || gnaRatio > 10) riskLevel = "ALERTA";

    // Estado breakdown for UI
    const estadoBreakdown = Array.from(estadoTotals.entries())
      .map(([estado, monto]) => ({ estado, monto, is_accepted: isAccepted(estado) }))
      .sort((a, b) => b.monto - a.monto);

    return NextResponse.json({
      sost_id: sostId,
      periodo,
      risk_level: riskLevel,
      summary: {
        declared_ingresos: declaredIngresos,
        declared_gastos: declaredGastos,
        declared_balance: declaredBalance,
        documented_total: documentedTotal,
        coverage_ratio: Math.round(coverageRatio * 10) / 10,
        total_gap: totalGap,
        gap_ratio: declaredGastos > 0 ? Math.round((totalGap / declaredGastos) * 1000) / 10 : 0,
        gna_amount: gnaAmount,
        gna_ratio: Math.round(gnaRatio * 10) / 10,
        er_rows: erRows.length,
        doc_rows: docRows.length,
      },
      estado_breakdown: estadoBreakdown,
      account_reconciliation: accountRecon.slice(0, 30), // top 30 accounts by gap
      doc_by_type: Array.from(docsByType.entries())
        .map(([tipo, monto]) => ({ tipo, monto }))
        .sort((a, b) => b.monto - a.monto),
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error en acreditación";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Returns true if the desc_estado string indicates an accepted/normal state */
function isAccepted(estado: string): boolean {
  const lower = estado.toLowerCase().trim();
  // Accept standard/empty/approved states
  if (!lower) return true;
  const ACCEPTED_PATTERNS = ["aceptado", "aprobado", "normal", "declarado", "presentado", "enviado", "recibido", "procesado"];
  return ACCEPTED_PATTERNS.some(p => lower.includes(p));
}
