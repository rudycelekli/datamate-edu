-- External data tables from MINEDUC Datos Abiertos API.
-- Populated via /api/mineduc/sync endpoint when MINEDUC_API_KEY is configured.
-- Join key: RBD (school code) — matches desafio.estado_resultado.rbd

-- Matricula (enrollment) by school and period
CREATE TABLE IF NOT EXISTS desafio.mineduc_matricula (
  rbd TEXT NOT NULL,
  periodo TEXT NOT NULL,
  nombre_establecimiento TEXT,
  matricula_total INTEGER DEFAULT 0,
  matricula_basica INTEGER DEFAULT 0,
  matricula_media INTEGER DEFAULT 0,
  matricula_parvularia INTEGER DEFAULT 0,
  region TEXT,
  comuna TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (rbd, periodo)
);
CREATE INDEX IF NOT EXISTS idx_mm_rbd ON desafio.mineduc_matricula(rbd);

-- Establecimientos directory (school registry)
CREATE TABLE IF NOT EXISTS desafio.mineduc_establecimientos (
  rbd TEXT PRIMARY KEY,
  sost_id TEXT,
  nombre TEXT,
  region TEXT,
  comuna TEXT,
  dependencia TEXT,
  ruralidad TEXT, -- URBANO / RURAL
  latitud NUMERIC,
  longitud NUMERIC,
  estado TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_me_sost ON desafio.mineduc_establecimientos(sost_id);

-- SNED scores (school performance evaluation)
CREATE TABLE IF NOT EXISTS desafio.mineduc_sned (
  rbd TEXT NOT NULL,
  periodo TEXT NOT NULL,
  puntaje_sned NUMERIC DEFAULT 0,
  clasificacion TEXT,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (rbd, periodo)
);

-- Dotacion docente (teacher staffing)
CREATE TABLE IF NOT EXISTS desafio.mineduc_dotacion (
  rbd TEXT NOT NULL,
  periodo TEXT NOT NULL,
  total_docentes INTEGER DEFAULT 0,
  horas_contrato_total NUMERIC DEFAULT 0,
  docentes_titulares INTEGER DEFAULT 0,
  docentes_contrata INTEGER DEFAULT 0,
  synced_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (rbd, periodo)
);
CREATE INDEX IF NOT EXISTS idx_md_rbd ON desafio.mineduc_dotacion(rbd);

-- Extended sostenedor indicators (computed after MINEDUC sync)
-- Adds indicators #1, #2, #5, #12, #13 to the profile
CREATE TABLE IF NOT EXISTS desafio.sostenedor_extended_indicators (
  sost_id TEXT NOT NULL,
  periodo TEXT NOT NULL,

  -- #1: Territorial complexity
  ruralidad_pct NUMERIC DEFAULT 0,        -- % of rural RBDs
  comunas_count INTEGER DEFAULT 0,         -- Geographic dispersion
  complexity_score NUMERIC DEFAULT 0,      -- Composite 0-100

  -- #2: Cost per student
  matricula_total INTEGER DEFAULT 0,       -- Total enrollment across RBDs
  costo_por_alumno NUMERIC DEFAULT 0,      -- Total gasto / matricula
  costo_cluster_avg NUMERIC DEFAULT 0,     -- Average for similar sostenedores
  costo_desviacion_pct NUMERIC DEFAULT 0,  -- % deviation from cluster

  -- #5: Income variation vs enrollment
  matricula_yoy_pct NUMERIC DEFAULT 0,     -- Enrollment year-over-year %
  ingresos_yoy_pct NUMERIC DEFAULT 0,      -- Income year-over-year %
  desajuste_ingreso_matricula NUMERIC DEFAULT 0, -- Gap between the two

  -- #12: SNED cross with financial risk
  avg_sned_score NUMERIC DEFAULT 0,        -- Average SNED across RBDs
  sned_risk_correlation TEXT DEFAULT 'N/A', -- HIGH_PERF_HIGH_RISK, etc.

  -- #13: Teacher efficiency
  total_docentes INTEGER DEFAULT 0,
  horas_docentes_total NUMERIC DEFAULT 0,
  ratio_alumno_docente NUMERIC DEFAULT 0,  -- Students per teacher
  ratio_horas_matricula NUMERIC DEFAULT 0, -- Hours per student

  computed_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (sost_id, periodo)
);
CREATE INDEX IF NOT EXISTS idx_sei_sost ON desafio.sostenedor_extended_indicators(sost_id);
