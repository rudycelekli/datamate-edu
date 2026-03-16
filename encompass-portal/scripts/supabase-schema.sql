-- Encompass Pipeline → Supabase schema
-- Run this in the Supabase SQL Editor

-- 1. Pipeline loans table
CREATE TABLE IF NOT EXISTS pipeline_loans (
  loan_guid       TEXT PRIMARY KEY,
  loan_number     TEXT NOT NULL DEFAULT '',
  borrower_first  TEXT NOT NULL DEFAULT '',
  borrower_last   TEXT NOT NULL DEFAULT '',
  co_borrower_first TEXT NOT NULL DEFAULT '',
  co_borrower_last  TEXT NOT NULL DEFAULT '',
  loan_folder     TEXT NOT NULL DEFAULT '',
  last_modified   TEXT NOT NULL DEFAULT '',
  loan_amount     NUMERIC NOT NULL DEFAULT 0,
  loan_status     TEXT NOT NULL DEFAULT '',
  date_created    TEXT NOT NULL DEFAULT '',
  milestone       TEXT NOT NULL DEFAULT '',
  loan_officer    TEXT NOT NULL DEFAULT '',
  loan_processor  TEXT NOT NULL DEFAULT '',
  property_address TEXT NOT NULL DEFAULT '',
  property_city   TEXT NOT NULL DEFAULT '',
  property_state  TEXT NOT NULL DEFAULT '',
  property_zip    TEXT NOT NULL DEFAULT '',
  note_rate       NUMERIC NOT NULL DEFAULT 0,
  loan_program    TEXT NOT NULL DEFAULT '',
  loan_purpose    TEXT NOT NULL DEFAULT '',
  lien_position   TEXT NOT NULL DEFAULT '',
  channel         TEXT NOT NULL DEFAULT '',
  lock_status     TEXT NOT NULL DEFAULT '',
  lock_expiration TEXT NOT NULL DEFAULT '',
  closing_date    TEXT NOT NULL DEFAULT '',
  application_date TEXT NOT NULL DEFAULT '',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_pl_milestone ON pipeline_loans (milestone);
CREATE INDEX IF NOT EXISTS idx_pl_loan_officer ON pipeline_loans (loan_officer);
CREATE INDEX IF NOT EXISTS idx_pl_property_state ON pipeline_loans (property_state);
CREATE INDEX IF NOT EXISTS idx_pl_loan_purpose ON pipeline_loans (loan_purpose);
CREATE INDEX IF NOT EXISTS idx_pl_lock_status ON pipeline_loans (lock_status);
CREATE INDEX IF NOT EXISTS idx_pl_loan_program ON pipeline_loans (loan_program);
CREATE INDEX IF NOT EXISTS idx_pl_last_modified ON pipeline_loans (last_modified DESC);
CREATE INDEX IF NOT EXISTS idx_pl_loan_amount ON pipeline_loans (loan_amount);
CREATE INDEX IF NOT EXISTS idx_pl_note_rate ON pipeline_loans (note_rate);
CREATE INDEX IF NOT EXISTS idx_pl_loan_number ON pipeline_loans (loan_number);
CREATE INDEX IF NOT EXISTS idx_pl_borrower_last ON pipeline_loans (borrower_last);
CREATE INDEX IF NOT EXISTS idx_pl_date_created ON pipeline_loans (date_created);

-- 3. Full-text search (GIN index)
CREATE INDEX IF NOT EXISTS idx_pl_search ON pipeline_loans
  USING GIN (to_tsvector('english',
    COALESCE(loan_number, '') || ' ' ||
    COALESCE(borrower_first, '') || ' ' ||
    COALESCE(borrower_last, '') || ' ' ||
    COALESCE(loan_officer, '') || ' ' ||
    COALESCE(property_city, '') || ' ' ||
    COALESCE(property_state, '')
  ));

-- 4. Sync status singleton table
CREATE TABLE IF NOT EXISTS sync_status (
  id               INT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  last_sync_at     TIMESTAMPTZ,
  total_rows       INT NOT NULL DEFAULT 0,
  status           TEXT NOT NULL DEFAULT 'idle',
  error_message    TEXT,
  sync_duration_ms INT NOT NULL DEFAULT 0
);

INSERT INTO sync_status (id, status) VALUES (1, 'idle')
  ON CONFLICT (id) DO NOTHING;

-- 5. SQL function: get_filter_options()
CREATE OR REPLACE FUNCTION get_filter_options()
RETURNS JSON
LANGUAGE sql
STABLE
AS $$
  SELECT json_build_object(
    'milestones', (
      SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::text[])
      FROM (SELECT DISTINCT milestone AS x FROM pipeline_loans WHERE milestone != '') t
    ),
    'los', (
      SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::text[])
      FROM (SELECT DISTINCT loan_officer AS x FROM pipeline_loans WHERE loan_officer != '') t
    ),
    'states', (
      SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::text[])
      FROM (SELECT DISTINCT property_state AS x FROM pipeline_loans WHERE property_state != '') t
    ),
    'purposes', (
      SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::text[])
      FROM (SELECT DISTINCT loan_purpose AS x FROM pipeline_loans WHERE loan_purpose != '') t
    ),
    'locks', (
      SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::text[])
      FROM (SELECT DISTINCT lock_status AS x FROM pipeline_loans WHERE lock_status != '') t
    ),
    'programs', (
      SELECT COALESCE(array_agg(x ORDER BY x), ARRAY[]::text[])
      FROM (SELECT DISTINCT loan_program AS x FROM pipeline_loans WHERE loan_program != '') t
    )
  );
$$;

-- 6. Enable Realtime on pipeline_loans
ALTER PUBLICATION supabase_realtime ADD TABLE pipeline_loans;

-- 7. RLS: public read, service-role write
ALTER TABLE pipeline_loans ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_status ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read pipeline_loans" ON pipeline_loans
  FOR SELECT USING (true);

CREATE POLICY "Service role write pipeline_loans" ON pipeline_loans
  FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "Public read sync_status" ON sync_status
  FOR SELECT USING (true);

CREATE POLICY "Service role write sync_status" ON sync_status
  FOR ALL USING (auth.role() = 'service_role');

-- ─────────────────────────────────────────────────────────────
-- 8. AI Text-to-SQL: execute_readonly_query()
-- ─────────────────────────────────────────────────────────────
-- Securely executes read-only SQL for AI-generated analytics queries.
-- Only allows SELECT statements against pipeline_loans.
CREATE OR REPLACE FUNCTION execute_readonly_query(query_text TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  result JSON;
  clean_query TEXT;
BEGIN
  -- Normalize and validate
  clean_query := TRIM(query_text);

  -- Must start with SELECT
  IF NOT (UPPER(clean_query) LIKE 'SELECT%') THEN
    RAISE EXCEPTION 'Only SELECT queries are allowed';
  END IF;

  -- Block dangerous keywords
  IF UPPER(clean_query) ~ '\b(DELETE|UPDATE|INSERT|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY)\b' THEN
    RAISE EXCEPTION 'Write operations are not allowed';
  END IF;

  -- Must reference pipeline_loans (safety check)
  IF NOT (LOWER(clean_query) LIKE '%pipeline_loans%') THEN
    RAISE EXCEPTION 'Query must reference pipeline_loans table';
  END IF;

  -- Execute and return as JSON array
  EXECUTE 'SELECT COALESCE(json_agg(row_to_json(t)), ''[]''::json) FROM (' || clean_query || ') t'
    INTO result;

  RETURN result;
END;
$$;

-- ─────────────────────────────────────────────────────────────
-- 9. Automated sync scheduling
-- ─────────────────────────────────────────────────────────────
-- The app auto-syncs when it detects data is stale (>5 min old).
-- This happens via the /api/pipeline/stats endpoint which the
-- header polls every 30 seconds.
--
-- OPTIONAL: If you want pg_cron + pg_net (HTTP calls from Postgres):
--   1. Enable "pg_net" in Dashboard → Database → Extensions
--      (search for "net" or "pg_net")
--   2. Then run:
--
-- SELECT cron.schedule(
--   'sync-pipeline-every-5min',
--   '*/5 * * * *',
--   $$
--     SELECT net.http_post(
--       url    := 'YOUR_DEPLOYMENT_URL/api/cron/sync-pipeline',
--       headers := jsonb_build_object(
--         'Content-Type', 'application/json',
--         'Authorization', 'Bearer YOUR_CRON_SECRET'
--       ),
--       body   := '{}'::jsonb
--     );
--   $$
-- );
--
-- To verify: SELECT * FROM cron.job;
-- To remove: SELECT cron.unschedule('sync-pipeline-every-5min');
