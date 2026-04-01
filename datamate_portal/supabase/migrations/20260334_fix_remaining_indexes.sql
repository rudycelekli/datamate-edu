-- Remaining remuneraciones indexes. Run one at a time to avoid connection timeout.
SET statement_timeout = '900s';

CREATE INDEX IF NOT EXISTS idx_rem23_sost ON desafio.remuneraciones_2023("SOSTENEDOR");
CREATE INDEX IF NOT EXISTS idx_rem22_sost ON desafio.remuneraciones_2022(sostenedor);
CREATE INDEX IF NOT EXISTS idx_rem21_sost ON desafio.remuneraciones_2021(sostenedor);
CREATE INDEX IF NOT EXISTS idx_rem20_sost ON desafio.remuneraciones_2020(sostenedor);

RESET statement_timeout;
