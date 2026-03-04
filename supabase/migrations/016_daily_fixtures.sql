-- ============================================================
-- Fantasy Futbol — Migration 016: Daily Fixtures Tracking
--
-- Supports the "Active Window" live-polling architecture (Pillar 3).
--
-- Adds:
--   1. daily_fixtures table for tracking today's PL matches
--   2. pg_cron job templates for the two new Edge Functions
-- ============================================================

-- ── 1. Daily Fixtures table ─────────────────────────────────────────────
--
-- Each row represents a single PL fixture for the current match day.
-- Populated daily at 00:00 by the sync-daily-fixtures Edge Function.
-- Polled every 15 min by sync-live-hybrid-stats during active windows.

CREATE TABLE IF NOT EXISTS public.daily_fixtures (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  -- API-Football fixture identity
  fixture_id      INT NOT NULL UNIQUE,
  match_date      DATE NOT NULL,
  start_time      TIMESTAMPTZ NOT NULL,

  -- API-Football status codes: NS, 1H, HT, 2H, ET, BT, P, FT, AET, PEN, SUSP, INT, PST, CANC, ABD, AWD, WO, LIVE
  status          TEXT NOT NULL DEFAULT 'NS',

  -- When did we last fetch /fixtures/players for this match?
  last_polled_at  TIMESTAMPTZ,

  -- The final audit call (4 hours post-FT) overwrites provisional stats
  fully_audited   BOOLEAN NOT NULL DEFAULT FALSE,

  -- When the match actually ended (status went to FT/AET/PEN)
  ended_at        TIMESTAMPTZ,

  -- API-Football round string (e.g. "Regular Season - 25")
  round           TEXT,

  -- Teams
  home_team_id    INT,
  home_team_name  TEXT,
  away_team_id    INT,
  away_team_name  TEXT,

  -- Score
  score_home      INT,
  score_away      INT,

  -- Metadata
  season          TEXT NOT NULL DEFAULT '2024',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_daily_fixtures_match_date
  ON public.daily_fixtures(match_date);

CREATE INDEX IF NOT EXISTS idx_daily_fixtures_status
  ON public.daily_fixtures(status);

CREATE INDEX IF NOT EXISTS idx_daily_fixtures_fixture_id
  ON public.daily_fixtures(fixture_id);

-- Auto-update updated_at
CREATE TRIGGER update_daily_fixtures_updated_at
  BEFORE UPDATE ON public.daily_fixtures
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- RLS: public read (it's operational data), service-role writes
ALTER TABLE public.daily_fixtures ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Daily fixtures: read all"
  ON public.daily_fixtures FOR SELECT USING (TRUE);

-- ── 2. pg_cron job templates ────────────────────────────────────────────
--
-- IMPORTANT: Before enabling, you must:
--   a) Deploy both Edge Functions to Supabase
--   b) Replace '<YOUR_SERVICE_ROLE_KEY>' with the actual key
--   c) Update the project URL to match your Supabase project ref
--
-- These are commented out by default.

/*
-- ── Daily Fixture Sync (00:00 UTC) ──────────────────────────────────────
SELECT cron.schedule(
  'sync-daily-fixtures',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://hnkavimrsbytsesdzwvj.supabase.co/functions/v1/sync-daily-fixtures',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>',
      'Content-Type',  'application/json'
    ),
    body    := '{}'::jsonb
  );
  $$
);

-- ── Live Hybrid Stats Polling (every 15 minutes) ────────────────────────
SELECT cron.schedule(
  'sync-live-hybrid-stats',
  '*/15 * * * *',
  $$
  SELECT net.http_post(
    url     := 'https://hnkavimrsbytsesdzwvj.supabase.co/functions/v1/sync-live-hybrid-stats',
    headers := jsonb_build_object(
      'Authorization', 'Bearer <YOUR_SERVICE_ROLE_KEY>',
      'Content-Type',  'application/json'
    ),
    body    := jsonb_build_object('mode', 'auto')
  );
  $$
);
*/
