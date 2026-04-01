-- ============================================================
-- Migration: Computed Indicators Materialized View
-- View: desafio.mv_sostenedor_indicators
--
-- Persists to DB the indicators previously computed only in TS:
--   #1  Costo por alumno (total_gastos / mat_total)
--   #2  Eficiencia pedagógica (gasto_pedagogico / total_gastos %)
--   #5  Divergencia ingresos vs matrícula (YOY comparison)
--   #7  Análisis histórico — z-scores vs own history
--   #8  Proyección balance — linear regression (next period)
--   #13 Eficiencia dotación docente (mat_total / n_docentes)
--
-- Cross-schema join: desafio.mv_sostenedor_profile × public.mineduc_*
-- ============================================================

-- Step 1: Regression stats per sostenedor for #8
-- (aggregate regr_slope/intercept needs a nested query to assign row numbers first)
CREATE OR REPLACE VIEW desafio.v_balance_regression AS
SELECT
  sost_id,
  regr_slope(balance::float, rn::float)     AS balance_slope,
  regr_intercept(balance::float, rn::float) AS balance_intercept,
  regr_r2(balance::float, rn::float)        AS balance_r2,
  MAX(rn)                                    AS n_periods
FROM (
  SELECT
    sost_id,
    balance,
    ROW_NUMBER() OVER (PARTITION BY sost_id ORDER BY periodo) AS rn
  FROM desafio.mv_sostenedor_profile
) sub
GROUP BY sost_id;

-- Step 2: Historical stats per sostenedor for #7 (z-score baseline)
CREATE OR REPLACE VIEW desafio.v_sostenedor_hist_stats AS
SELECT
  sost_id,
  AVG(ind4_admin_ratio)                                     AS avg_admin,
  NULLIF(STDDEV_POP(ind4_admin_ratio), 0)                   AS sd_admin,
  AVG(ind9_payroll_ratio)                                   AS avg_payroll,
  NULLIF(STDDEV_POP(ind9_payroll_ratio), 0)                 AS sd_payroll,
  AVG(balance)                                              AS avg_balance,
  NULLIF(STDDEV_POP(balance), 0)                            AS sd_balance,
  AVG(risk_score)                                           AS avg_risk,
  NULLIF(STDDEV_POP(risk_score::float), 0)                  AS sd_risk
FROM desafio.mv_sostenedor_profile
GROUP BY sost_id;

-- Step 3: YOY income for #5 (requires periodo ordering)
CREATE OR REPLACE VIEW desafio.v_sostenedor_income_yoy AS
SELECT
  sost_id,
  periodo,
  total_ingresos,
  LAG(total_ingresos) OVER w AS prev_ingresos,
  CASE
    WHEN LAG(total_ingresos) OVER w > 0
    THEN ROUND(
      (total_ingresos - LAG(total_ingresos) OVER w)::numeric
      / LAG(total_ingresos) OVER w * 100,
    1)
    ELSE NULL
  END AS yoy_ingresos_pct
FROM desafio.mv_sostenedor_profile
WINDOW w AS (PARTITION BY sost_id ORDER BY periodo);

-- Step 4: MINEDUC matricula YOY for #5
CREATE OR REPLACE VIEW public.v_mineduc_mat_yoy AS
SELECT
  rut_sost                                                      AS sost_id,
  agno::text                                                    AS periodo,
  mat_total,
  LAG(mat_total) OVER (PARTITION BY rut_sost ORDER BY agno)    AS mat_total_prev,
  CASE
    WHEN LAG(mat_total) OVER (PARTITION BY rut_sost ORDER BY agno) > 0
    THEN ROUND(
      (mat_total - LAG(mat_total) OVER (PARTITION BY rut_sost ORDER BY agno))::numeric
      / LAG(mat_total) OVER (PARTITION BY rut_sost ORDER BY agno) * 100,
    1)
    ELSE NULL
  END AS yoy_mat_pct
FROM public.mineduc_matricula;

-- ============================================================
-- Step 5: Main materialized view
-- ============================================================
CREATE MATERIALIZED VIEW IF NOT EXISTS desafio.mv_sostenedor_indicators AS

WITH
profile AS (
  SELECT
    sost_id, periodo, nombre,
    total_ingresos, total_gastos, balance,
    gasto_pedagogico, gasto_admin,
    ind4_admin_ratio, ind4_level,
    ind9_payroll_ratio, ind9_level,
    risk_score, risk_level,
    ind10_innovacion_ratio, ind11_hhi, ind11_level
  FROM desafio.mv_sostenedor_profile
),

mat AS (
  SELECT rut_sost AS sost_id, agno::text AS periodo, mat_total, n_establecimientos
  FROM public.mineduc_matricula
),

doc AS (
  SELECT rut_sost AS sost_id, agno::text AS periodo, n_docentes, horas_contrato_total
  FROM public.mineduc_docentes
),

-- Use latest available MINEDUC year as fallback when exact period not found
mat_latest AS (
  SELECT DISTINCT ON (rut_sost) rut_sost AS sost_id, agno::text AS periodo, mat_total, n_establecimientos
  FROM public.mineduc_matricula
  ORDER BY rut_sost, agno DESC
),

doc_latest AS (
  SELECT DISTINCT ON (rut_sost) rut_sost AS sost_id, agno::text AS periodo, n_docentes, horas_contrato_total
  FROM public.mineduc_docentes
  ORDER BY rut_sost, agno DESC
),

hist AS (
  SELECT * FROM desafio.v_sostenedor_hist_stats
),

regr AS (
  SELECT * FROM desafio.v_balance_regression
),

row_nums AS (
  SELECT sost_id, periodo,
    ROW_NUMBER() OVER (PARTITION BY sost_id ORDER BY periodo) AS rn
  FROM desafio.mv_sostenedor_profile
),

income_yoy AS (
  SELECT * FROM desafio.v_sostenedor_income_yoy
),

mat_yoy AS (
  SELECT * FROM public.v_mineduc_mat_yoy
)

SELECT
  p.sost_id,
  p.periodo,
  p.nombre,

  -- ── #1 Costo por alumno ──────────────────────────────────
  -- Uses exact-year MINEDUC match, falls back to latest available year
  CASE
    WHEN COALESCE(m.mat_total, ml.mat_total) > 0
    THEN ROUND(p.total_gastos::numeric / COALESCE(m.mat_total, ml.mat_total))
    ELSE NULL
  END AS ind1_costo_por_alumno,

  CASE
    WHEN COALESCE(m.mat_total, ml.mat_total) IS NULL THEN NULL
    WHEN p.total_gastos::numeric / COALESCE(m.mat_total, ml.mat_total) > 3750000 THEN 'CRITICO'
    WHEN p.total_gastos::numeric / COALESCE(m.mat_total, ml.mat_total) > 3000000 THEN 'ALERTA'
    ELSE 'OK'
  END AS ind1_level,

  -- ── #2 Eficiencia pedagógica ─────────────────────────────
  CASE
    WHEN p.total_gastos > 0
    THEN ROUND(p.gasto_pedagogico::numeric / p.total_gastos * 100, 1)
    ELSE NULL
  END AS ind2_pct_pedagogico,

  CASE
    WHEN p.total_gastos IS NULL OR p.total_gastos = 0 THEN NULL
    WHEN p.gasto_pedagogico::numeric / p.total_gastos * 100 < 40 THEN 'CRITICO'
    WHEN p.gasto_pedagogico::numeric / p.total_gastos * 100 < 65 THEN 'ALERTA'
    ELSE 'OK'
  END AS ind2_level,

  -- ── #5 Divergencia ingresos vs matrícula ─────────────────
  iy.yoy_ingresos_pct AS ind5_yoy_ingresos_pct,
  my.yoy_mat_pct      AS ind5_yoy_mat_pct,

  -- Divergence flag: income and enrollment moving in opposite directions by >10pp
  CASE
    WHEN iy.yoy_ingresos_pct IS NOT NULL AND my.yoy_mat_pct IS NOT NULL
      AND SIGN(iy.yoy_ingresos_pct) <> SIGN(my.yoy_mat_pct)
      AND ABS(iy.yoy_ingresos_pct - my.yoy_mat_pct) > 10
    THEN 'ALERTA'
    WHEN iy.yoy_ingresos_pct IS NOT NULL AND my.yoy_mat_pct IS NOT NULL
      AND SIGN(iy.yoy_ingresos_pct) <> SIGN(my.yoy_mat_pct)
      AND ABS(iy.yoy_ingresos_pct - my.yoy_mat_pct) > 25
    THEN 'CRITICO'
    ELSE 'OK'
  END AS ind5_divergence_flag,

  -- ── #7 Z-scores vs own history ───────────────────────────
  CASE WHEN h.sd_admin   IS NOT NULL THEN ROUND((p.ind4_admin_ratio   - h.avg_admin)   / h.sd_admin,   2) ELSE 0::numeric END AS ind7_zscore_admin,
  CASE WHEN h.sd_payroll IS NOT NULL THEN ROUND((p.ind9_payroll_ratio - h.avg_payroll) / h.sd_payroll, 2) ELSE 0::numeric END AS ind7_zscore_payroll,
  CASE WHEN h.sd_balance IS NOT NULL THEN ROUND((p.balance::numeric   - h.avg_balance) / h.sd_balance, 2) ELSE 0::numeric END AS ind7_zscore_balance,
  CASE WHEN h.sd_risk    IS NOT NULL THEN ROUND((p.risk_score::numeric - h.avg_risk)   / h.sd_risk,   2) ELSE 0::numeric END AS ind7_zscore_risk,

  -- Anomaly if any z-score exceeds ±2σ
  CASE
    WHEN ABS(COALESCE((p.ind4_admin_ratio   - h.avg_admin)   / NULLIF(h.sd_admin,   0), 0)) > 2
      OR ABS(COALESCE((p.ind9_payroll_ratio - h.avg_payroll) / NULLIF(h.sd_payroll, 0), 0)) > 2
      OR ABS(COALESCE((p.balance::numeric   - h.avg_balance) / NULLIF(h.sd_balance, 0), 0)) > 2
    THEN TRUE
    ELSE FALSE
  END AS ind7_anomaly_flag,

  -- ── #8 Balance projection (next period) ──────────────────
  CASE
    WHEN r.balance_slope IS NOT NULL
    THEN ROUND((r.balance_intercept + r.balance_slope * (r.n_periods + 1))::numeric)
    ELSE NULL
  END AS ind8_balance_proj_next,

  CASE
    WHEN r.balance_slope IS NOT NULL
    THEN ROUND((r.balance_intercept + r.balance_slope * (r.n_periods + 2))::numeric)
    ELSE NULL
  END AS ind8_balance_proj_plus2,

  ROUND(r.balance_slope::numeric) AS ind8_balance_slope_per_period,
  ROUND(r.balance_r2::numeric, 3) AS ind8_model_r2,

  CASE
    WHEN r.balance_slope IS NOT NULL
      AND (r.balance_intercept + r.balance_slope * (r.n_periods + 1)) < p.total_ingresos * -0.05
    THEN 'CRITICO'
    WHEN r.balance_slope IS NOT NULL
      AND (r.balance_intercept + r.balance_slope * (r.n_periods + 1)) < p.total_ingresos * 0.05
    THEN 'ALERTA'
    ELSE 'OK'
  END AS ind8_proj_risk_level,

  -- ── #13 Eficiencia dotación docente ──────────────────────
  CASE
    WHEN COALESCE(d.n_docentes, dl.n_docentes) > 0
     AND COALESCE(m.mat_total,  ml.mat_total)  > 0
    THEN ROUND(COALESCE(m.mat_total, ml.mat_total)::numeric / COALESCE(d.n_docentes, dl.n_docentes), 1)
    ELSE NULL
  END AS ind13_alumnos_por_docente,

  CASE
    WHEN COALESCE(d.n_docentes, dl.n_docentes) > 0
     AND COALESCE(m.mat_total,  ml.mat_total)  > 0
    THEN
      CASE
        WHEN COALESCE(m.mat_total, ml.mat_total)::numeric / COALESCE(d.n_docentes, dl.n_docentes) > 37 THEN 'CRITICO'
        WHEN COALESCE(m.mat_total, ml.mat_total)::numeric / COALESCE(d.n_docentes, dl.n_docentes) > 25 THEN 'ALERTA'
        ELSE 'OK'
      END
    ELSE NULL
  END AS ind13_level,

  -- ── Supporting raw data ───────────────────────────────────
  COALESCE(m.mat_total,  ml.mat_total)  AS mat_total,
  COALESCE(m.n_establecimientos, ml.n_establecimientos) AS n_establecimientos,
  COALESCE(d.n_docentes, dl.n_docentes) AS n_docentes,
  COALESCE(d.horas_contrato_total, dl.horas_contrato_total) AS horas_contrato_total,

  -- Existing indicators (pass-through for convenience)
  p.ind4_admin_ratio,   p.ind4_level,
  p.ind9_payroll_ratio, p.ind9_level,
  p.ind10_innovacion_ratio,
  p.ind11_hhi,          p.ind11_level,
  p.risk_score,         p.risk_level,
  p.total_ingresos,     p.total_gastos,   p.balance,
  p.gasto_pedagogico,   p.gasto_admin

FROM profile p

-- MINEDUC exact year match
LEFT JOIN mat  m  ON m.sost_id  = p.sost_id AND m.periodo  = p.periodo
LEFT JOIN doc  d  ON d.sost_id  = p.sost_id AND d.periodo  = p.periodo

-- MINEDUC latest year fallback (only used when exact match missing)
LEFT JOIN mat_latest ml ON ml.sost_id = p.sost_id AND m.sost_id IS NULL
LEFT JOIN doc_latest dl ON dl.sost_id = p.sost_id AND d.sost_id IS NULL

-- Historical stats
LEFT JOIN hist     h  ON h.sost_id  = p.sost_id

-- Regression
LEFT JOIN regr     r  ON r.sost_id  = p.sost_id

-- Row numbers (for regression alignment)
LEFT JOIN row_nums rn ON rn.sost_id = p.sost_id AND rn.periodo = p.periodo

-- YOY
LEFT JOIN income_yoy iy ON iy.sost_id = p.sost_id AND iy.periodo = p.periodo
LEFT JOIN mat_yoy    my ON my.sost_id = p.sost_id AND my.periodo = p.periodo

WITH NO DATA;

-- ── Indexes ──────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS idx_mv_indicators_pk
  ON desafio.mv_sostenedor_indicators (sost_id, periodo);

CREATE INDEX IF NOT EXISTS idx_mv_indicators_sost
  ON desafio.mv_sostenedor_indicators (sost_id);

CREATE INDEX IF NOT EXISTS idx_mv_indicators_periodo
  ON desafio.mv_sostenedor_indicators (periodo);

CREATE INDEX IF NOT EXISTS idx_mv_indicators_risk
  ON desafio.mv_sostenedor_indicators (risk_level, risk_score);

-- ── Initial population ────────────────────────────────────────
REFRESH MATERIALIZED VIEW desafio.mv_sostenedor_indicators;

-- ── Update the refresh function to include this view ─────────
CREATE OR REPLACE FUNCTION desafio.refresh_all_profiles()
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_identity;
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_financials;
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_payroll;
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_hhi;
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_documentos;
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_profile;
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_yoy;
  -- New: computed indicators (depends on profile + MINEDUC public tables)
  REFRESH MATERIALIZED VIEW CONCURRENTLY desafio.mv_sostenedor_indicators;
END;
$$;

-- Grant read access to the service role (used by the app)
GRANT SELECT ON desafio.mv_sostenedor_indicators TO service_role;
GRANT SELECT ON desafio.v_balance_regression TO service_role;
GRANT SELECT ON desafio.v_sostenedor_hist_stats TO service_role;
GRANT SELECT ON desafio.v_sostenedor_income_yoy TO service_role;
GRANT SELECT ON public.v_mineduc_mat_yoy TO service_role;
