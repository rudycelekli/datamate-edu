import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient } from "@/lib/supabase";
import { getFilterOptions } from "@/lib/desafio-queries";

/**
 * Intelligence page stats — now powered by materialized views.
 * Queries pre-computed profiles instead of scanning 252M raw rows.
 */

export async function GET(req: NextRequest) {
  try {
    const sp = req.nextUrl.searchParams;
    const db = getDesafioClient();

    const region = sp.get("region");
    const dependencia = sp.get("dependencia");
    const periodo = sp.get("periodo");
    const subvencion = sp.get("subvencion");

    // Fetch all profiles from materialized view (fast — ~24K rows pre-computed)
    let query = db.from("mv_sostenedor_profile").select("*");
    if (region) query = query.eq("region_rbd", region);
    if (dependencia) query = query.eq("dependencia_rbd", dependencia);
    if (periodo) query = query.eq("periodo", periodo);

    // Paginate past 1000 limit
    const allProfiles: Record<string, unknown>[] = [];
    let offset = 0;
    while (true) {
      const { data, error } = await query.range(offset, offset + 999);
      if (error) throw new Error(error.message);
      if (!data || data.length === 0) break;
      allProfiles.push(...data);
      offset += 1000;
      if (data.length < 1000) break;
      // Re-build query for next batch (supabase client is stateful)
      query = db.from("mv_sostenedor_profile").select("*");
      if (region) query = query.eq("region_rbd", region);
      if (dependencia) query = query.eq("dependencia_rbd", dependencia);
      if (periodo) query = query.eq("periodo", periodo);
    }

    // Aggregate from profiles
    interface Bucket { count: number; monto: number }
    const byRegion: Record<string, Bucket> = {};
    const byDependencia: Record<string, Bucket> = {};
    const byPeriodo: Record<string, Bucket> = {};
    const byRiskLevel: Record<string, number> = { CRITICO: 0, ALERTA: 0, OK: 0 };

    let totalIngresos = 0;
    let totalGastos = 0;
    let totalMonto = 0;
    let totalHaberes = 0;
    let totalLiquido = 0;
    let totalTrabajadores = 0;
    let totalDocs = 0;
    let totalDocMonto = 0;
    const uniqueSost = new Set<string>();
    const uniquePeriodos = new Set<string>();

    // Indicator aggregates
    let sumAdminRatio = 0;
    let sumPayrollRatio = 0;
    let sumInnovacionRatio = 0;
    let sumHhi = 0;
    let sumTasaEjecucion = 0;
    let countWithPayroll = 0;
    let countWithHhi = 0;
    let totalPlantaFija = 0;
    let totalContrata = 0;

    // Payroll by region
    interface PayrollBucket { sumRatio: number; count: number; sumHaberes: number; trabajadores: number }
    const payrollByRegion: Record<string, PayrollBucket> = {};
    // Payroll by dependencia
    const payrollByDep: Record<string, PayrollBucket> = {};
    // Top payroll sostenedores
    const payrollTopRows: { sost_id: string; nombre: string; ratio: number; haberes: number; trabajadores: number; level: string }[] = [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const r of allProfiles as any[]) {
      const ingresos = Number(r.total_ingresos) || 0;
      const gastos = Number(r.total_gastos) || 0;
      const monto = ingresos + gastos;
      totalIngresos += ingresos;
      totalGastos += gastos;
      totalMonto += monto;

      totalHaberes += Number(r.total_haberes) || 0;
      totalLiquido += Number(r.total_liquido) || 0;
      totalTrabajadores += Number(r.trabajadores) || 0;
      totalPlantaFija += Number(r.planta_fija) || 0;
      totalContrata += Number(r.contrata) || 0;
      totalDocs += Number(r.doc_count) || 0;
      totalDocMonto += Number(r.doc_monto) || 0;

      if (r.sost_id) uniqueSost.add(r.sost_id);
      if (r.periodo) uniquePeriodos.add(r.periodo);

      // Risk
      byRiskLevel[r.risk_level] = (byRiskLevel[r.risk_level] || 0) + 1;

      // Indicators
      sumAdminRatio += Number(r.ind4_admin_ratio) || 0;
      sumInnovacionRatio += Number(r.ind10_innovacion_ratio) || 0;
      sumTasaEjecucion += Number(r.tasa_ejecucion) || 0;
      const payRatio = Number(r.ind9_payroll_ratio) || 0;
      if (payRatio > 0) {
        sumPayrollRatio += payRatio;
        countWithPayroll++;
      }
      if (Number(r.ind11_hhi) > 0) {
        sumHhi += Number(r.ind11_hhi);
        countWithHhi++;
      }

      // Region
      const reg = String(r.region_rbd || "Sin region");
      if (!byRegion[reg]) byRegion[reg] = { count: 0, monto: 0 };
      byRegion[reg].count++;
      byRegion[reg].monto += monto;

      // Dependencia
      const dep = String(r.dependencia_rbd || "Sin tipo");
      if (!byDependencia[dep]) byDependencia[dep] = { count: 0, monto: 0 };
      byDependencia[dep].count++;
      byDependencia[dep].monto += monto;

      // Periodo
      const per = String(r.periodo || "");
      if (per) {
        if (!byPeriodo[per]) byPeriodo[per] = { count: 0, monto: 0 };
        byPeriodo[per].count++;
        byPeriodo[per].monto += monto;
      }

      // Payroll by region
      if (payRatio > 0) {
        if (!payrollByRegion[reg]) payrollByRegion[reg] = { sumRatio: 0, count: 0, sumHaberes: 0, trabajadores: 0 };
        payrollByRegion[reg].sumRatio += payRatio;
        payrollByRegion[reg].count++;
        payrollByRegion[reg].sumHaberes += Number(r.total_haberes) || 0;
        payrollByRegion[reg].trabajadores += Number(r.trabajadores) || 0;
      }

      // Payroll by dependencia
      if (payRatio > 0) {
        if (!payrollByDep[dep]) payrollByDep[dep] = { sumRatio: 0, count: 0, sumHaberes: 0, trabajadores: 0 };
        payrollByDep[dep].sumRatio += payRatio;
        payrollByDep[dep].count++;
        payrollByDep[dep].sumHaberes += Number(r.total_haberes) || 0;
        payrollByDep[dep].trabajadores += Number(r.trabajadores) || 0;
      }

      // Track top payroll sostenedores (only CRITICO/ALERTA)
      if (payRatio > 65) {
        payrollTopRows.push({
          sost_id: String(r.sost_id || ""),
          nombre: String(r.nombre || r.sost_id || ""),
          ratio: payRatio,
          haberes: Number(r.total_haberes) || 0,
          trabajadores: Number(r.trabajadores) || 0,
          level: String(r.ind9_level || "OK"),
        });
      }
    }

    const n = allProfiles.length || 1;

    // Sort helpers
    const sortDesc = (arr: { name: string; count: number; monto: number }[]) =>
      arr.sort((a, b) => b.monto - a.monto);

    const regionData = sortDesc(Object.entries(byRegion).map(([name, d]) => ({ name, ...d }))).slice(0, 20);
    const dependenciaData = sortDesc(Object.entries(byDependencia).map(([name, d]) => ({ name, ...d })));
    const periodoData = Object.entries(byPeriodo).map(([name, d]) => ({ name, ...d })).sort((a, b) => a.name.localeCompare(b.name));

    const topRegion = regionData[0];

    // Fetch filter options (cached)
    const filterOpts = await getFilterOptions();

    // Fetch document type breakdown from materialized view
    let docQuery = db.from("mv_sostenedor_documentos").select("doc_types, doc_monto_total");
    if (periodo) docQuery = docQuery.eq("periodo", periodo);
    const { data: docData } = await docQuery.limit(5000);

    const byTipoDoc: Record<string, Bucket> = {};
    for (const d of docData || []) {
      // doc_types is comma-separated
      const types = String(d.doc_types || "").split(", ").filter(Boolean);
      const montoPerType = (Number(d.doc_monto_total) || 0) / (types.length || 1);
      for (const t of types) {
        if (!byTipoDoc[t]) byTipoDoc[t] = { count: 0, monto: 0 };
        byTipoDoc[t].count++;
        byTipoDoc[t].monto += montoPerType;
      }
    }
    const tipoDocumentoData = sortDesc(Object.entries(byTipoDoc).map(([name, d]) => ({ name, ...d }))).slice(0, 15);

    return NextResponse.json({
      // Summary
      totalRegistros: allProfiles.length,
      totalMonto,
      totalIngresos,
      totalGastos,
      totalSostenedores: uniqueSost.size,
      totalPeriodos: uniquePeriodos.size,

      // Risk overview
      riskSummary: byRiskLevel,
      avgRiskScore: Math.round(allProfiles.reduce((s, r) => s + (Number((r as Record<string, unknown>).risk_score) || 0), 0) / n),

      // Average indicators
      avgIndicators: {
        admin_ratio: Number((sumAdminRatio / n).toFixed(1)),
        payroll_ratio: countWithPayroll > 0 ? Number((sumPayrollRatio / countWithPayroll).toFixed(1)) : 0,
        innovacion_ratio: Number((sumInnovacionRatio / n).toFixed(1)),
        hhi: countWithHhi > 0 ? Number((sumHhi / countWithHhi).toFixed(3)) : 0,
        tasa_ejecucion: Number((sumTasaEjecucion / n).toFixed(1)),
      },

      // Chart data
      regionData,
      dependenciaData,
      periodoData,
      tipoDocumentoData,
      tipoCuentaData: [
        { name: "Ingreso", monto: totalIngresos, count: 0 },
        { name: "Gasto", monto: totalGastos, count: 0 },
      ],
      cuentaData: [], // Will be populated from profile spending breakdown
      subvencionData: [], // Can be derived from profiles

      topRegion: topRegion?.name || "--",
      topRegionPercent: topRegion && totalMonto > 0 ? ((topRegion.monto / totalMonto) * 100).toFixed(1) : "0",

      // Payroll
      totalRemuneraciones: totalTrabajadores,
      totalHaber: totalHaberes,
      totalDescuento: 0,
      totalLiquido: totalLiquido,
      promedioLiquido: totalTrabajadores > 0 ? Math.round(totalLiquido / totalTrabajadores) : 0,
      proporcionRemuneraciones: totalGastos > 0 ? Number(((totalHaberes / totalGastos) * 100).toFixed(1)) : 0,
      totalPlantaFija,
      totalContrata,
      payrollByRegion: Object.entries(payrollByRegion)
        .map(([name, d]) => ({
          name,
          avgRatio: Number((d.sumRatio / d.count).toFixed(1)),
          trabajadores: d.trabajadores,
          haberes: d.sumHaberes,
        }))
        .sort((a, b) => b.avgRatio - a.avgRatio)
        .slice(0, 15),
      payrollByDependencia: Object.entries(payrollByDep)
        .map(([name, d]) => ({
          name,
          avgRatio: Number((d.sumRatio / d.count).toFixed(1)),
          trabajadores: d.trabajadores,
          haberes: d.sumHaberes,
        }))
        .sort((a, b) => b.avgRatio - a.avgRatio),
      payrollTopSostenedores: payrollTopRows
        .sort((a, b) => b.ratio - a.ratio)
        .slice(0, 20),

      // Documentos
      totalDocumentos: totalDocs,
      totalDocMonto: totalDocMonto,

      filterOptions: filterOpts,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
