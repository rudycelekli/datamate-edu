-- Fix: The EXECUTE wraps the query in another string layer, causing quote issues.
-- Solution: Use format() with %s to avoid double-escaping, and execute the query directly.

CREATE OR REPLACE FUNCTION public.execute_readonly_sql(query_text TEXT)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET statement_timeout = '60s'
AS $$
DECLARE
  result JSONB;
  normalized TEXT;
  clean_query TEXT;
BEGIN
  -- Remove SET search_path prefix if present
  clean_query := trim(query_text);
  normalized := lower(clean_query);
  IF normalized LIKE 'set search_path%' THEN
    clean_query := trim(substring(clean_query FROM position(';' IN clean_query) + 1));
    normalized := lower(clean_query);
  END IF;

  -- Validate: must start with SELECT or WITH
  IF NOT (normalized LIKE 'select%' OR normalized LIKE 'with%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Block dangerous operations
  IF normalized ~ '(insert|update|delete|drop|alter|create|truncate|grant|revoke)\s' THEN
    RAISE EXCEPTION 'Mutation operations are not allowed';
  END IF;

  -- Set search path to desafio schema
  SET LOCAL search_path TO desafio, public;

  -- Execute the query directly using format to avoid quoting issues
  EXECUTE format('SELECT COALESCE(jsonb_agg(row_to_json(t)), ''[]''::jsonb) FROM (%s) t', clean_query)
  INTO result;

  RETURN result;
END;
$$;
