-- Split payroll materialized views by year to avoid 600s timeout on 212M row UNION ALL.
-- Each table is 30-49M rows — individual aggregation completes within timeout.
SET statement_timeout = '600s';

-- Individual year views
DROP MATERIALIZED VIEW IF EXISTS desafio.mv_payroll_2024;
CREATE MATERIALIZED VIEW desafio.mv_payroll_2024 AS
SELECT sostenedor AS sost_id, periodo,
  COUNT(*) AS payroll_records, COUNT(DISTINCT rut) AS trabajadores,
  SUM(totalhaber::numeric) AS total_haberes, SUM(totaldescuento::numeric) AS total_descuentos,
  SUM(liquido::numeric) AS total_liquido, AVG(liquido::numeric) AS avg_liquido,
  SUM(CASE WHEN tip = 'CPF' THEN 1 ELSE 0 END) AS planta_fija,
  SUM(CASE WHEN tip = 'CI' THEN 1 ELSE 0 END) AS contrata,
  SUM(hc::numeric) AS total_horas_contratadas, COUNT(DISTINCT rbd) AS payroll_rbd_count
FROM desafio.remuneraciones_2024 GROUP BY sostenedor, periodo;

DROP MATERIALIZED VIEW IF EXISTS desafio.mv_payroll_2023;
CREATE MATERIALIZED VIEW desafio.mv_payroll_2023 AS
SELECT "SOSTENEDOR" AS sost_id, "PERIODO" AS periodo,
  COUNT(*) AS payroll_records, COUNT(DISTINCT "RUT") AS trabajadores,
  SUM("TOTALHABER"::numeric) AS total_haberes, SUM("TOTALDESCUENTO"::numeric) AS total_descuentos,
  SUM("LIQUIDO"::numeric) AS total_liquido, AVG("LIQUIDO"::numeric) AS avg_liquido,
  SUM(CASE WHEN "TIP" = 'CPF' THEN 1 ELSE 0 END) AS planta_fija,
  SUM(CASE WHEN "TIP" = 'CI' THEN 1 ELSE 0 END) AS contrata,
  SUM("HC"::numeric) AS total_horas_contratadas, COUNT(DISTINCT "RBD") AS payroll_rbd_count
FROM desafio.remuneraciones_2023 GROUP BY "SOSTENEDOR", "PERIODO";

DROP MATERIALIZED VIEW IF EXISTS desafio.mv_payroll_2022;
CREATE MATERIALIZED VIEW desafio.mv_payroll_2022 AS
SELECT sostenedor AS sost_id, periodo,
  COUNT(*) AS payroll_records, COUNT(DISTINCT rut) AS trabajadores,
  SUM(totalhaber::numeric) AS total_haberes, SUM(totaldescuento::numeric) AS total_descuentos,
  SUM(liquido::numeric) AS total_liquido, AVG(liquido::numeric) AS avg_liquido,
  SUM(CASE WHEN tip = 'CPF' THEN 1 ELSE 0 END) AS planta_fija,
  SUM(CASE WHEN tip = 'CI' THEN 1 ELSE 0 END) AS contrata,
  SUM(hc::numeric) AS total_horas_contratadas, COUNT(DISTINCT rbd) AS payroll_rbd_count
FROM desafio.remuneraciones_2022 GROUP BY sostenedor, periodo;

DROP MATERIALIZED VIEW IF EXISTS desafio.mv_payroll_2021;
CREATE MATERIALIZED VIEW desafio.mv_payroll_2021 AS
SELECT sostenedor AS sost_id, periodo,
  COUNT(*) AS payroll_records, COUNT(DISTINCT rut) AS trabajadores,
  SUM(totalhaber::numeric) AS total_haberes, SUM(totaldescuento::numeric) AS total_descuentos,
  SUM(liquido::numeric) AS total_liquido, AVG(liquido::numeric) AS avg_liquido,
  SUM(CASE WHEN tip = 'CPF' THEN 1 ELSE 0 END) AS planta_fija,
  SUM(CASE WHEN tip = 'CI' THEN 1 ELSE 0 END) AS contrata,
  SUM(hc::numeric) AS total_horas_contratadas, COUNT(DISTINCT rbd) AS payroll_rbd_count
FROM desafio.remuneraciones_2021 GROUP BY sostenedor, periodo;

DROP MATERIALIZED VIEW IF EXISTS desafio.mv_payroll_2020;
CREATE MATERIALIZED VIEW desafio.mv_payroll_2020 AS
SELECT sostenedor AS sost_id, periodo,
  COUNT(*) AS payroll_records, COUNT(DISTINCT rut) AS trabajadores,
  SUM(totalhaber::numeric) AS total_haberes, SUM(totaldescuento::numeric) AS total_descuentos,
  SUM(liquido::numeric) AS total_liquido, AVG(liquido::numeric) AS avg_liquido,
  SUM(CASE WHEN tip = 'CPF' THEN 1 ELSE 0 END) AS planta_fija,
  SUM(CASE WHEN tip = 'CI' THEN 1 ELSE 0 END) AS contrata,
  SUM(hc::numeric) AS total_horas_contratadas, COUNT(DISTINCT rbd) AS payroll_rbd_count
FROM desafio.remuneraciones_2020 GROUP BY sostenedor, periodo;

-- Now combine the pre-aggregated results (tiny tables, instant)
DROP MATERIALIZED VIEW IF EXISTS desafio.mv_sostenedor_payroll;
CREATE MATERIALIZED VIEW desafio.mv_sostenedor_payroll AS
SELECT * FROM desafio.mv_payroll_2024
UNION ALL SELECT * FROM desafio.mv_payroll_2023
UNION ALL SELECT * FROM desafio.mv_payroll_2022
UNION ALL SELECT * FROM desafio.mv_payroll_2021
UNION ALL SELECT * FROM desafio.mv_payroll_2020;

CREATE INDEX ON desafio.mv_sostenedor_payroll(sost_id);
CREATE INDEX ON desafio.mv_sostenedor_payroll(sost_id, periodo);

RESET statement_timeout;
