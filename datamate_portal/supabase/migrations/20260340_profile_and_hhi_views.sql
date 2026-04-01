-- HHI, Profile, and YOY views — depend on financials + payroll being built.
SET statement_timeout = '300s';

-- HHI (from estado_resultado, already indexed)
DROP MATERIALIZED VIEW IF EXISTS desafio.mv_sostenedor_hhi;
CREATE MATERIALIZED VIEW desafio.mv_sostenedor_hhi AS
WITH income_by_source AS (
  SELECT sost_id, periodo, subvencion_alias, SUM(monto_declarado::numeric) AS monto
  FROM desafio.estado_resultado
  WHERE desc_tipo_cuenta = 'Ingreso'
  GROUP BY sost_id, periodo, subvencion_alias
),
income_totals AS (
  SELECT sost_id, periodo, SUM(monto) AS total FROM income_by_source GROUP BY sost_id, periodo
),
shares AS (
  SELECT s.sost_id, s.periodo,
    CASE WHEN t.total > 0 THEN (s.monto / t.total) ELSE 0 END AS share
  FROM income_by_source s JOIN income_totals t ON s.sost_id = t.sost_id AND s.periodo = t.periodo
)
SELECT sost_id, periodo, SUM(share * share) AS hhi_index, COUNT(*) AS income_sources
FROM shares GROUP BY sost_id, periodo;

CREATE UNIQUE INDEX ON desafio.mv_sostenedor_hhi(sost_id, periodo);

-- Unified Profile
DROP MATERIALIZED VIEW IF EXISTS desafio.mv_sostenedor_profile;
CREATE MATERIALIZED VIEW desafio.mv_sostenedor_profile AS
SELECT
  f.sost_id, f.periodo,
  COALESCE(i.nombre_sost, '') AS nombre, COALESCE(i.rut_sost, '') AS rut,
  f.region_rbd, f.dependencia_rbd, f.rbd_count,
  f.total_ingresos, f.total_gastos, f.balance, f.subvenciones, f.subvencion_count,
  f.gasto_admin, f.gasto_pedagogico, f.gasto_innovacion, f.gasto_operacion, f.gasto_infraestructura,

  CASE WHEN f.total_gastos > 0 THEN ROUND((f.gasto_admin / f.total_gastos * 100)::numeric, 1) ELSE 0 END AS ind4_admin_ratio,
  CASE WHEN f.total_gastos > 0 AND (f.gasto_admin / f.total_gastos * 100) > 50 THEN 'CRITICO'
       WHEN f.total_gastos > 0 AND (f.gasto_admin / f.total_gastos * 100) > 35 THEN 'ALERTA' ELSE 'OK' END AS ind4_level,

  CASE WHEN f.total_gastos > 0 THEN ROUND((f.gasto_innovacion / f.total_gastos * 100)::numeric, 1) ELSE 0 END AS ind10_innovacion_ratio,

  CASE WHEN f.total_ingresos > 0 THEN ROUND((f.balance / f.total_ingresos * 100)::numeric, 1) ELSE 0 END AS balance_ratio,
  CASE WHEN f.total_ingresos > 0 AND (f.balance / f.total_ingresos * 100) < -20 THEN 'CRITICO'
       WHEN f.balance < 0 THEN 'ALERTA' ELSE 'OK' END AS balance_level,

  -- Tasa de ejecucion (Indicador Acreditacion Saldos)
  CASE WHEN f.total_ingresos > 0 THEN ROUND((f.total_gastos / f.total_ingresos * 100)::numeric, 1) ELSE 0 END AS tasa_ejecucion,

  COALESCE(p.total_haberes, 0) AS total_haberes, COALESCE(p.total_liquido, 0) AS total_liquido,
  COALESCE(p.trabajadores, 0) AS trabajadores, COALESCE(p.planta_fija, 0) AS planta_fija,
  COALESCE(p.contrata, 0) AS contrata, COALESCE(p.total_horas_contratadas, 0) AS total_horas,

  CASE WHEN f.total_ingresos > 0 AND p.total_haberes IS NOT NULL
    THEN ROUND((p.total_haberes / f.total_ingresos * 100)::numeric, 1) ELSE 0 END AS ind9_payroll_ratio,
  CASE WHEN f.total_ingresos > 0 AND p.total_haberes IS NOT NULL AND (p.total_haberes / f.total_ingresos * 100) > 95 THEN 'CRITICO'
       WHEN f.total_ingresos > 0 AND p.total_haberes IS NOT NULL AND (p.total_haberes / f.total_ingresos * 100) > 80 THEN 'ALERTA' ELSE 'OK' END AS ind9_level,

  COALESCE(h.hhi_index, 0) AS ind11_hhi, COALESCE(h.income_sources, 0) AS income_sources,
  CASE WHEN h.hhi_index > 0.5 THEN 'CRITICO' WHEN h.hhi_index > 0.25 THEN 'ALERTA' ELSE 'OK' END AS ind11_level,

  COALESCE(d.doc_count, 0) AS doc_count, COALESCE(d.doc_monto_total, 0) AS doc_monto,
  COALESCE(d.doc_types, '') AS doc_types, COALESCE(d.proveedores_unicos, 0) AS proveedores_unicos,
  CASE WHEN f.total_gastos > 0 AND d.doc_monto_total IS NOT NULL
    THEN ROUND((d.doc_monto_total / f.total_gastos * 100)::numeric, 1) ELSE 0 END AS doc_coverage_ratio,

  LEAST(100, ROUND((
    CASE WHEN f.total_gastos > 0 AND (f.gasto_admin / f.total_gastos * 100) > 50 THEN 40
         WHEN f.total_gastos > 0 AND (f.gasto_admin / f.total_gastos * 100) > 35 THEN 24 ELSE 0 END +
    CASE WHEN f.total_ingresos > 0 AND p.total_haberes IS NOT NULL AND (p.total_haberes / f.total_ingresos * 100) > 95 THEN 35
         WHEN f.total_ingresos > 0 AND p.total_haberes IS NOT NULL AND (p.total_haberes / f.total_ingresos * 100) > 80 THEN 21 ELSE 0 END +
    CASE WHEN f.total_ingresos > 0 AND (f.balance / f.total_ingresos * 100) < -20 THEN 25
         WHEN f.balance < 0 THEN 15 ELSE 0 END
  )::numeric)) AS risk_score,

  CASE WHEN (
    CASE WHEN f.total_gastos > 0 AND (f.gasto_admin / f.total_gastos * 100) > 50 THEN 40
         WHEN f.total_gastos > 0 AND (f.gasto_admin / f.total_gastos * 100) > 35 THEN 24 ELSE 0 END +
    CASE WHEN f.total_ingresos > 0 AND p.total_haberes IS NOT NULL AND (p.total_haberes / f.total_ingresos * 100) > 95 THEN 35
         WHEN f.total_ingresos > 0 AND p.total_haberes IS NOT NULL AND (p.total_haberes / f.total_ingresos * 100) > 80 THEN 21 ELSE 0 END +
    CASE WHEN f.total_ingresos > 0 AND (f.balance / f.total_ingresos * 100) < -20 THEN 25
         WHEN f.balance < 0 THEN 15 ELSE 0 END
  ) > 70 THEN 'CRITICO'
  WHEN (
    CASE WHEN f.total_gastos > 0 AND (f.gasto_admin / f.total_gastos * 100) > 50 THEN 40
         WHEN f.total_gastos > 0 AND (f.gasto_admin / f.total_gastos * 100) > 35 THEN 24 ELSE 0 END +
    CASE WHEN f.total_ingresos > 0 AND p.total_haberes IS NOT NULL AND (p.total_haberes / f.total_ingresos * 100) > 95 THEN 35
         WHEN f.total_ingresos > 0 AND p.total_haberes IS NOT NULL AND (p.total_haberes / f.total_ingresos * 100) > 80 THEN 21 ELSE 0 END +
    CASE WHEN f.total_ingresos > 0 AND (f.balance / f.total_ingresos * 100) < -20 THEN 25
         WHEN f.balance < 0 THEN 15 ELSE 0 END
  ) > 40 THEN 'ALERTA' ELSE 'OK' END AS risk_level

FROM desafio.mv_sostenedor_financials f
LEFT JOIN desafio.mv_sostenedor_identity i ON f.sost_id = i.sost_id
LEFT JOIN desafio.mv_sostenedor_payroll p ON f.sost_id = p.sost_id AND f.periodo = p.periodo
LEFT JOIN desafio.mv_sostenedor_hhi h ON f.sost_id = h.sost_id AND f.periodo = h.periodo
LEFT JOIN desafio.mv_sostenedor_documentos d ON f.sost_id = d.sost_id AND f.periodo = d.periodo;

CREATE UNIQUE INDEX ON desafio.mv_sostenedor_profile(sost_id, periodo);
CREATE INDEX ON desafio.mv_sostenedor_profile(risk_score DESC);

-- YOY view
DROP MATERIALIZED VIEW IF EXISTS desafio.mv_sostenedor_yoy;
CREATE MATERIALIZED VIEW desafio.mv_sostenedor_yoy AS
WITH ranked AS (
  SELECT *,
    LAG(total_ingresos) OVER (PARTITION BY sost_id ORDER BY periodo) AS prev_ingresos,
    LAG(total_gastos) OVER (PARTITION BY sost_id ORDER BY periodo) AS prev_gastos,
    LAG(total_haberes) OVER (PARTITION BY sost_id ORDER BY periodo) AS prev_haberes,
    LAG(ind4_admin_ratio) OVER (PARTITION BY sost_id ORDER BY periodo) AS prev_admin_ratio,
    LAG(ind9_payroll_ratio) OVER (PARTITION BY sost_id ORDER BY periodo) AS prev_payroll_ratio
  FROM desafio.mv_sostenedor_profile
)
SELECT sost_id, periodo, nombre, total_ingresos, total_gastos, balance,
  ind4_admin_ratio, ind9_payroll_ratio, ind11_hhi, risk_score, risk_level,
  CASE WHEN prev_ingresos > 0 THEN ROUND(((total_ingresos - prev_ingresos) / prev_ingresos * 100)::numeric, 1) ELSE NULL END AS yoy_ingresos_pct,
  CASE WHEN prev_gastos > 0 THEN ROUND(((total_gastos - prev_gastos) / prev_gastos * 100)::numeric, 1) ELSE NULL END AS yoy_gastos_pct,
  CASE WHEN prev_haberes > 0 THEN ROUND(((total_haberes - prev_haberes) / prev_haberes * 100)::numeric, 1) ELSE NULL END AS yoy_haberes_pct,
  (ind4_admin_ratio - COALESCE(prev_admin_ratio, ind4_admin_ratio)) AS yoy_admin_delta,
  (ind9_payroll_ratio - COALESCE(prev_payroll_ratio, ind9_payroll_ratio)) AS yoy_payroll_delta
FROM ranked;

CREATE INDEX ON desafio.mv_sostenedor_yoy(sost_id);

-- Refresh function
CREATE OR REPLACE FUNCTION desafio.refresh_all_profiles()
RETURNS void LANGUAGE plpgsql SET statement_timeout = '600s' AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_financials;
  REFRESH MATERIALIZED VIEW desafio.mv_sostenedor_identity;
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_documentos;
  REFRESH MATERIALIZED VIEW desafio.mv_payroll_2024;
  REFRESH MATERIALIZED VIEW desafio.mv_payroll_2023;
  REFRESH MATERIALIZED VIEW desafio.mv_payroll_2022;
  REFRESH MATERIALIZED VIEW desafio.mv_payroll_2021;
  REFRESH MATERIALIZED VIEW desafio.mv_payroll_2020;
  REFRESH MATERIALIZED VIEW desafio.mv_sostenedor_payroll;
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_hhi;
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_profile;
  REFRESH MATERIALIZED VIEW desafio.mv_sostenedor_yoy;
END;
$$;

RESET statement_timeout;
