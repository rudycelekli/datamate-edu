import { NextRequest, NextResponse } from "next/server";
import { getDesafioClient, getSupabaseAdmin } from "@/lib/supabase";

/**
 * GET /api/sostenedor/mineduc?sost_id=X
 *
 * Returns MINEDUC reference data for a sostenedor, joined with fiscal data:
 *   - #1  Costo por alumno: total_gastos / mat_total
 *   - #2  Eficiencia pedagógica: gasto_pedagogico / mat_total
 *   - #12 SNED × riesgo financiero: SNED index vs risk_score
 *   - #13 Eficiencia dotación docente: mat_total / n_docentes
 *
 * Join key: desafio.sost_id = public.mineduc_*.rut_sost
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const sostId = sp.get("sost_id");

  if (!sostId) {
    return NextResponse.json({ error: "sost_id es requerido" }, { status: 400 });
  }

  try {
    const desafio = getDesafioClient();
    const pub = getSupabaseAdmin(); // public schema

    // ── 1. Fetch fiscal profile (all periods) ──
    const { data: profiles, error: pe } = await desafio
      .from("mv_sostenedor_profile")
      .select("periodo, nombre, total_gastos, total_ingresos, balance, risk_score, risk_level, ind9_payroll_ratio, ind4_admin_ratio")
      .eq("sost_id", sostId)
      .order("periodo");

    if (pe) throw new Error(pe.message);

    // ── 2. Fetch MINEDUC matricula ──
    const { data: matRows, error: me } = await pub
      .from("mineduc_matricula")
      .select("agno, mat_total, n_establecimientos")
      .eq("rut_sost", sostId)
      .order("agno");

    if (me) throw new Error(me.message);

    // ── 3. Fetch MINEDUC docentes ──
    const { data: docRows, error: de } = await pub
      .from("mineduc_docentes")
      .select("agno, n_docentes, horas_contrato_total")
      .eq("rut_sost", sostId)
      .order("agno");

    if (de) throw new Error(de.message);

    // ── 4. Fetch SNED ──
    const { data: snedRows, error: se } = await pub
      .from("mineduc_sned")
      .select("periodo_sned, n_establecimientos, indice_sned_promedio, n_seleccionados, pct_seleccionados")
      .eq("rut_sost", sostId)
      .order("periodo_sned");

    if (se) throw new Error(se.message);

    // ── 5. Fetch gastos pedagógicos from estado_resultado ──
    // Look for cuentas with desc_cuenta_padre containing "pedagogico" or "educacion"
    const { data: gastoPed, error: gpe } = await desafio
      .from("estado_resultado")
      .select("periodo, monto_declarado, desc_cuenta_padre, desc_cuenta")
      .eq("sost_id", sostId)
      .eq("desc_tipo_cuenta", "Gasto")
      .ilike("desc_cuenta_padre", "%pedagog%")
      .not("monto_declarado", "is", null);

    // Aggregate pedagogical spend by period
    const pedByPeriodo = new Map<string, number>();
    if (!gpe && gastoPed) {
      for (const r of gastoPed) {
        const per = String(r.periodo || "");
        const monto = Number(r.monto_declarado) || 0;
        pedByPeriodo.set(per, (pedByPeriodo.get(per) || 0) + monto);
      }
    }

    // Also try "Gasto Corriente" or "Actividades de Aprendizaje" patterns
    const { data: gastoPed2 } = await desafio
      .from("estado_resultado")
      .select("periodo, monto_declarado")
      .eq("sost_id", sostId)
      .eq("desc_tipo_cuenta", "Gasto")
      .ilike("desc_cuenta", "%actividades de aprendizaje%")
      .not("monto_declarado", "is", null);

    if (gastoPed2) {
      for (const r of gastoPed2) {
        const per = String(r.periodo || "");
        const monto = Number(r.monto_declarado) || 0;
        pedByPeriodo.set(per, (pedByPeriodo.get(per) || 0) + monto);
      }
    }

    // ── Build lookup maps ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const matRows_ = matRows as any[] || [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const docRows_ = docRows as any[] || [];

    const matByYear = new Map<string, { mat_total: number; n_estab: number }>();
    for (const r of matRows_) {
      matByYear.set(String(r.agno), { mat_total: r.mat_total, n_estab: r.n_establecimientos });
    }
    const docByYear = new Map<string, { n_docentes: number; horas: number }>();
    for (const r of docRows_) {
      docByYear.set(String(r.agno), { n_docentes: r.n_docentes, horas: r.horas_contrato_total });
    }

    // Fallback: use the most recent MINEDUC year available when no exact period match
    const matYears = matRows_.map((r: { agno: string }) => String(r.agno)).sort();
    const docYears = docRows_.map((r: { agno: string }) => String(r.agno)).sort();
    const latestMatYear = matYears[matYears.length - 1] || null;
    const latestDocYear = docYears[docYears.length - 1] || null;

    // ── 6. Build per-period indicators ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const periodoData = (profiles || []).map((p: any) => {
      const per = String(p.periodo);
      // Try exact match first, fall back to latest available MINEDUC year
      const mat = matByYear.get(per) ?? (latestMatYear ? matByYear.get(latestMatYear) : undefined);
      const doc = docByYear.get(per) ?? (latestDocYear ? docByYear.get(latestDocYear) : undefined);
      const matAgno = matByYear.has(per) ? per : (latestMatYear || null);
      const gastosPed = pedByPeriodo.get(per) || 0;
      const totalGastos = Number(p.total_gastos) || 0;

      // #1 Costo por alumno (CLP per student)
      const costoPorAlumno = mat && mat.mat_total > 0
        ? Math.round(totalGastos / mat.mat_total)
        : null;

      // #2 Eficiencia pedagógica — use gasto_pedagogico from desafio profile directly
      const gastoPedProfile = Number(p.gasto_pedagogico) || 0;
      const effectiveGastoPed = gastosPed > 0 ? gastosPed : gastoPedProfile;
      const eficienciaPed = mat && mat.mat_total > 0 && effectiveGastoPed > 0
        ? Math.round((effectiveGastoPed / mat.mat_total) / 1000) / 10
        : null;
      const pctPedagogico = totalGastos > 0 && effectiveGastoPed > 0
        ? Math.round((effectiveGastoPed / totalGastos) * 1000) / 10
        : null;

      // #13 Eficiencia dotación docente (students per teacher)
      const alumnosPorDocente = mat && doc && doc.n_docentes > 0
        ? Math.round((mat.mat_total / doc.n_docentes) * 10) / 10
        : null;

      const horasPorAlumno = mat && doc && mat.mat_total > 0
        ? Math.round((doc.horas / mat.mat_total) * 10) / 10
        : null;

      return {
        periodo: per,
        mineduc_agno: matAgno,  // which MINEDUC year was used
        risk_score: p.risk_score,
        risk_level: p.risk_level,
        total_gastos: totalGastos,
        gasto_pedagogico_perfil: gastoPedProfile || null,
        // MINEDUC-dependent
        mat_total: mat?.mat_total ?? null,
        n_establecimientos: mat?.n_estab ?? null,
        n_docentes: doc?.n_docentes ?? null,
        horas_contrato_total: doc?.horas ?? null,
        gasto_pedagogico: effectiveGastoPed || null,
        // Indicators
        ind1_costo_por_alumno: costoPorAlumno,
        ind2_eficiencia_ped_pct: pctPedagogico,
        ind2_costo_ped_por_alumno: eficienciaPed,
        ind13_alumnos_por_docente: alumnosPorDocente,
        ind13_horas_por_alumno: horasPorAlumno,
      };
    });

    // ── #12 SNED × riesgo ──
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const latestFiscal = profiles && profiles.length > 0 ? profiles[profiles.length - 1] : null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const snedCross = (snedRows as any[] || []).map((s: any) => {
      const years = String(s.periodo_sned).split("-");
      const matchYear = years[years.length - 1];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fiscal = (profiles || []).find((p: any) => String(p.periodo) === matchYear)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        || (profiles || []).find((p: any) => String(p.periodo) === years[0])
        || latestFiscal;  // always fall back to most recent fiscal period
      return {
        periodo_sned: s.periodo_sned,
        indice_sned_promedio: s.indice_sned_promedio,
        n_seleccionados: s.n_seleccionados,
        pct_seleccionados: s.pct_seleccionados,
        n_establecimientos: s.n_establecimientos,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        risk_score_fiscal: (fiscal as any)?.risk_score ?? null,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        risk_level_fiscal: (fiscal as any)?.risk_level ?? null,
        sned_riesgo_flag: fiscal
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          ? (s.indice_sned_promedio > 60 && ((fiscal as any).risk_score || 0) > 45
            ? "ALERTA_CRITICA"
            : s.indice_sned_promedio < 40 && ((fiscal as any).risk_score || 0) < 15
            ? "OK"
            : "NORMAL")
          : null,
      };
    });

    // ── Latest values for summary ──
    const latest = periodoData[periodoData.length - 1] || null;
    const snedLatest = snedCross[snedCross.length - 1] || null;

    // Reference benchmarks (rough national averages)
    const BENCHMARK_COSTO_ALUMNO = 2_500_000; // ~2.5M CLP/student/year
    const BENCHMARK_ALUMNOS_DOC  = 25;         // 25 students/teacher national avg
    const BENCHMARK_PCT_PEDAGOGICO = 65;        // 65% of spend should be pedagogical

    return NextResponse.json({
      sost_id: sostId,
      nombre: profiles?.[0]
        ? (profiles[profiles.length - 1] as { nombre?: string }).nombre || sostId
        : sostId,
      has_mineduc_data: matRows && matRows.length > 0,
      summary: latest ? {
        periodo: latest.periodo,
        ind1_costo_por_alumno: latest.ind1_costo_por_alumno,
        ind1_benchmark: BENCHMARK_COSTO_ALUMNO,
        ind1_flag: latest.ind1_costo_por_alumno
          ? (latest.ind1_costo_por_alumno > BENCHMARK_COSTO_ALUMNO * 1.5 ? "CRITICO"
            : latest.ind1_costo_por_alumno > BENCHMARK_COSTO_ALUMNO * 1.2 ? "ALERTA" : "OK")
          : null,
        ind2_pct_pedagogico: latest.ind2_eficiencia_ped_pct,
        ind2_benchmark: BENCHMARK_PCT_PEDAGOGICO,
        ind2_flag: latest.ind2_eficiencia_ped_pct
          ? (latest.ind2_eficiencia_ped_pct < 40 ? "CRITICO"
            : latest.ind2_eficiencia_ped_pct < BENCHMARK_PCT_PEDAGOGICO ? "ALERTA" : "OK")
          : null,
        ind13_alumnos_por_docente: latest.ind13_alumnos_por_docente,
        ind13_benchmark: BENCHMARK_ALUMNOS_DOC,
        ind13_flag: latest.ind13_alumnos_por_docente
          ? (latest.ind13_alumnos_por_docente > BENCHMARK_ALUMNOS_DOC * 1.5 ? "CRITICO"
            : latest.ind13_alumnos_por_docente > BENCHMARK_ALUMNOS_DOC ? "ALERTA" : "OK")
          : null,
        ind12_sned_index: snedLatest?.indice_sned_promedio ?? null,
        ind12_sned_flag: snedLatest?.sned_riesgo_flag ?? null,
        mat_total: latest.mat_total,
        n_establecimientos: latest.n_establecimientos,
        n_docentes: latest.n_docentes,
      } : null,
      by_periodo: periodoData,
      sned: snedCross,
      data_coverage: {
        fiscal_periods: profiles?.length || 0,
        mineduc_mat_periods: matRows?.length || 0,
        mineduc_doc_periods: docRows?.length || 0,
        sned_periods: snedRows?.length || 0,
      },
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error en indicadores MINEDUC";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
