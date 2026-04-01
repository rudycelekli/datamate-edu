SET statement_timeout = '600s';
CREATE INDEX IF NOT EXISTS idx_er_sost ON desafio.estado_resultado(sost_id);
RESET statement_timeout;
