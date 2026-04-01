-- Rebuild all indexes. Using IF NOT EXISTS so already-built ones are skipped instantly.
SET statement_timeout = '900s';

-- estado_resultado (~22.6M rows)
CREATE INDEX IF NOT EXISTS idx_er_sost ON desafio.estado_resultado(sost_id);
CREATE INDEX IF NOT EXISTS idx_er_sost_periodo ON desafio.estado_resultado(sost_id, periodo);

-- documentos (~17.4M rows)
CREATE INDEX IF NOT EXISTS idx_doc_sost ON desafio.documentos(sost_id);
CREATE INDEX IF NOT EXISTS idx_doc_sost_periodo ON desafio.documentos(sost_id, periodo);

-- remuneraciones_2024 (~49M rows)
CREATE INDEX IF NOT EXISTS idx_rem24_sost ON desafio.remuneraciones_2024(sostenedor);

-- remuneraciones_2023 (~30M rows) — UPPERCASE columns
CREATE INDEX IF NOT EXISTS idx_rem23_sost ON desafio.remuneraciones_2023("SOSTENEDOR");

-- remuneraciones_2022/2021/2020 — should already be indexed, IF NOT EXISTS will skip
CREATE INDEX IF NOT EXISTS idx_rem22_sost ON desafio.remuneraciones_2022(sostenedor);
CREATE INDEX IF NOT EXISTS idx_rem21_sost ON desafio.remuneraciones_2021(sostenedor);
CREATE INDEX IF NOT EXISTS idx_rem20_sost ON desafio.remuneraciones_2020(sostenedor);

RESET statement_timeout;
