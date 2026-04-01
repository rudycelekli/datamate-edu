-- MINEDUC reference data tables
-- These tables store data downloaded from datosabiertos.mineduc.cl

CREATE TABLE IF NOT EXISTS public.mineduc_establecimientos (
  agno        text NOT NULL,
  rbd         text NOT NULL,
  nom_rbd     text,
  rut_sost    text,
  cod_depe    text,
  cod_depe2   text,
  rural       boolean DEFAULT false,
  cod_reg     text,
  nom_reg     text,
  cod_com     text,
  nom_com     text,
  estado_estab text,
  mat_total   numeric DEFAULT 0,
  PRIMARY KEY (agno, rbd)
);

CREATE TABLE IF NOT EXISTS public.mineduc_matricula (
  agno               text NOT NULL,
  rut_sost           text NOT NULL,
  mat_total          integer DEFAULT 0,
  n_establecimientos integer DEFAULT 0,
  PRIMARY KEY (agno, rut_sost)
);

CREATE TABLE IF NOT EXISTS public.mineduc_sned (
  periodo_sned        text NOT NULL,
  rut_sost            text NOT NULL,
  n_establecimientos  integer DEFAULT 0,
  indice_sned_promedio numeric DEFAULT 0,
  n_seleccionados     integer DEFAULT 0,
  pct_seleccionados   numeric DEFAULT 0,
  PRIMARY KEY (periodo_sned, rut_sost)
);

CREATE TABLE IF NOT EXISTS public.mineduc_docentes (
  agno                 text NOT NULL,
  rut_sost             text NOT NULL,
  n_docentes           integer DEFAULT 0,
  horas_contrato_total numeric DEFAULT 0,
  PRIMARY KEY (agno, rut_sost)
);

-- Indexes for common lookups by rut_sost
CREATE INDEX IF NOT EXISTS idx_mineduc_establecimientos_rut ON public.mineduc_establecimientos(rut_sost);
CREATE INDEX IF NOT EXISTS idx_mineduc_matricula_rut ON public.mineduc_matricula(rut_sost);
CREATE INDEX IF NOT EXISTS idx_mineduc_sned_rut ON public.mineduc_sned(rut_sost);
CREATE INDEX IF NOT EXISTS idx_mineduc_docentes_rut ON public.mineduc_docentes(rut_sost);
