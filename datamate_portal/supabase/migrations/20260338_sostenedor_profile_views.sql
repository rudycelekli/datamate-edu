-- Sostenedor profile views — Part 1: Financials, Identity, Documents.
-- Payroll (heavy) is in 20260339. HHI + Profile + YOY in 20260340.
SET statement_timeout = '600s';

-- 1. Financial summary from estado_resultado (~22.6M rows)
DROP MATERIALIZED VIEW IF EXISTS desafio.mv_sostenedor_financials;
CREATE MATERIALIZED VIEW desafio.mv_sostenedor_financials AS
SELECT
  er.sost_id, er.periodo,
  MAX(er.region_rbd) AS region_rbd, MAX(er.dependencia_rbd) AS dependencia_rbd,
  COUNT(DISTINCT er.rbd) AS rbd_count,
  SUM(CASE WHEN er.desc_tipo_cuenta = 'Ingreso' THEN er.monto_declarado::numeric ELSE 0 END) AS total_ingresos,
  SUM(CASE WHEN er.desc_tipo_cuenta = 'Gasto' THEN er.monto_declarado::numeric ELSE 0 END) AS total_gastos,
  SUM(CASE WHEN er.desc_tipo_cuenta = 'Ingreso' THEN er.monto_declarado::numeric ELSE 0 END)
  - SUM(CASE WHEN er.desc_tipo_cuenta = 'Gasto' THEN er.monto_declarado::numeric ELSE 0 END) AS balance,
  SUM(CASE WHEN er.desc_tipo_cuenta = 'Gasto' AND (er.cuenta_alias LIKE '420%' OR er.cuenta_alias_padre LIKE '420%')
    THEN er.monto_declarado::numeric ELSE 0 END) AS gasto_admin,
  SUM(CASE WHEN er.desc_tipo_cuenta = 'Gasto' AND (er.cuenta_alias LIKE '410%' OR er.cuenta_alias_padre LIKE '410%')
    THEN er.monto_declarado::numeric ELSE 0 END) AS gasto_pedagogico,
  SUM(CASE WHEN er.desc_tipo_cuenta = 'Gasto' AND (
    er.cuenta_alias LIKE '4105%' OR er.cuenta_alias LIKE '4106%' OR er.cuenta_alias LIKE '4107%' OR
    er.cuenta_alias_padre LIKE '4105%' OR er.cuenta_alias_padre LIKE '4106%' OR er.cuenta_alias_padre LIKE '4107%'
  ) THEN er.monto_declarado::numeric ELSE 0 END) AS gasto_innovacion,
  SUM(CASE WHEN er.desc_tipo_cuenta = 'Gasto' AND (er.cuenta_alias LIKE '4109%' OR er.cuenta_alias_padre LIKE '4109%')
    THEN er.monto_declarado::numeric ELSE 0 END) AS gasto_operacion,
  SUM(CASE WHEN er.desc_tipo_cuenta = 'Gasto' AND (er.cuenta_alias LIKE '4116%' OR er.cuenta_alias_padre LIKE '4116%')
    THEN er.monto_declarado::numeric ELSE 0 END) AS gasto_infraestructura,
  COUNT(DISTINCT er.subvencion_alias) AS subvencion_count,
  STRING_AGG(DISTINCT er.subvencion_alias, ', ' ORDER BY er.subvencion_alias) AS subvenciones,
  COUNT(DISTINCT er.cuenta_alias_padre) AS cuenta_categories
FROM desafio.estado_resultado er
GROUP BY er.sost_id, er.periodo;
CREATE UNIQUE INDEX ON desafio.mv_sostenedor_financials(sost_id, periodo);
CREATE INDEX ON desafio.mv_sostenedor_financials(sost_id);

-- 2. Identity from documentos
DROP MATERIALIZED VIEW IF EXISTS desafio.mv_sostenedor_identity;
CREATE MATERIALIZED VIEW desafio.mv_sostenedor_identity AS
SELECT DISTINCT ON (sost_id) sost_id, nombre_sost, rut_sost
FROM desafio.documentos WHERE nombre_sost IS NOT NULL AND nombre_sost != ''
ORDER BY sost_id, periodo DESC;
CREATE UNIQUE INDEX ON desafio.mv_sostenedor_identity(sost_id);

-- 3. Document analysis
DROP MATERIALIZED VIEW IF EXISTS desafio.mv_sostenedor_documentos;
CREATE MATERIALIZED VIEW desafio.mv_sostenedor_documentos AS
SELECT sost_id, periodo,
  COUNT(*) AS doc_count, SUM(monto_declarado::numeric) AS doc_monto_total,
  COUNT(DISTINCT tipo_docs_alias) AS doc_types_count,
  STRING_AGG(DISTINCT tipo_docs_alias, ', ' ORDER BY tipo_docs_alias) AS doc_types,
  COUNT(DISTINCT rbd) AS doc_rbd_count, COUNT(DISTINCT rut_documento) AS proveedores_unicos
FROM desafio.documentos GROUP BY sost_id, periodo;
CREATE UNIQUE INDEX ON desafio.mv_sostenedor_documentos(sost_id, periodo);

RESET statement_timeout;
