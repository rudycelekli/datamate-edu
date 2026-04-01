-- Function to execute read-only SQL queries from the AI intelligence system.
-- Only allows SELECT statements and is restricted to the desafio schema.
-- Must be run as a Supabase migration or directly in the SQL editor.
--
-- IMPORTANT: The desafio schema contains ~252 million rows total.
-- This function has a 30-second statement timeout to prevent runaway queries.

CREATE OR REPLACE FUNCTION public.execute_readonly_sql(query_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '30s'
AS $$
DECLARE
  result JSONB;
  normalized TEXT;
BEGIN
  -- Normalize the query
  normalized := lower(trim(query_text));

  -- Remove SET search_path prefix if present
  IF normalized LIKE 'set search_path%' THEN
    query_text := substring(query_text FROM position(';' IN query_text) + 1);
    normalized := lower(trim(query_text));
  END IF;

  -- Validate: must start with SELECT or WITH
  IF NOT (normalized LIKE 'select%' OR normalized LIKE 'with%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Block dangerous operations
  IF normalized ~ '(insert|update|delete|drop|alter|create|truncate|grant|revoke|execute|copy)\s' THEN
    RAISE EXCEPTION 'Mutation operations are not allowed';
  END IF;

  -- Set search path to desafio schema
  EXECUTE 'SET LOCAL search_path TO desafio, public';

  -- Execute and return as JSON array (capped at 500 rows for safety)
  EXECUTE 'SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (SELECT * FROM (' || query_text || ') _inner LIMIT 500) t'
  INTO result;

  RETURN result;
END;
$$;

-- Grant execute to the service role
GRANT EXECUTE ON FUNCTION public.execute_readonly_sql(TEXT) TO service_role;

COMMENT ON FUNCTION public.execute_readonly_sql IS
  'Executes read-only SQL queries against the desafio schema for the AI intelligence system. '
  'Only SELECT/WITH allowed. 30s timeout. Max 500 rows returned. '
  'Tables: estado_resultado (~22.6M), documentos (~17.4M), remuneraciones_2020-2024 (~212M total).';

-- Recommended indexes for AI query performance (run if not already present):
-- CREATE INDEX IF NOT EXISTS idx_er_sost_periodo ON desafio.estado_resultado(sost_id, periodo);
-- CREATE INDEX IF NOT EXISTS idx_er_region ON desafio.estado_resultado(region_rbd);
-- CREATE INDEX IF NOT EXISTS idx_er_dependencia ON desafio.estado_resultado(dependencia_rbd);
-- CREATE INDEX IF NOT EXISTS idx_er_tipo_cuenta ON desafio.estado_resultado(desc_tipo_cuenta);
-- CREATE INDEX IF NOT EXISTS idx_doc_sost_periodo ON desafio.documentos(sost_id, periodo);
-- CREATE INDEX IF NOT EXISTS idx_rem24_sost ON desafio.remuneraciones_2024(sostenedor);
