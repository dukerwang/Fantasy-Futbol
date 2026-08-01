-- ============================================================
-- Migration 099: SoFIFA top-5-league position reference cache
-- ============================================================
-- /api/sync/sofifa-players only ever writes positions onto rows that already
-- exist in `players` (matched by name) -- everyone else scraped is discarded.
-- That's fine for a currently-active Prem player, but it means a brand-new
-- signing has nowhere to look up a real position until the *next* full SoFIFA
-- crawl happens to include them, which the app-level flow can't wait on.
--
-- Most new Prem arrivals transfer from the other top-5 leagues. If a periodic
-- (1-2x/year, manual) SoFIFA crawl covers all five leagues and stores every
-- player it sees here -- not just Prem matches -- then syncPlayers.ts can look
-- a new arrival up in this table immediately on insert, independent of
-- whether that player has ever touched the `players` table before.
--
-- sofifa_id is SoFIFA's own stable player id (stable across their squad
-- re-scrapes, unlike our internal uuids) -- the natural upsert key.

CREATE TABLE IF NOT EXISTS public.sofifa_position_reference (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sofifa_id           INTEGER NOT NULL UNIQUE,
  full_name           TEXT NOT NULL,
  common_name         TEXT,
  name_aliases        TEXT[] NOT NULL,
  club_name           TEXT,
  sofifa_league_id    INTEGER NOT NULL,
  primary_position    TEXT NOT NULL,
  secondary_positions TEXT[] NOT NULL DEFAULT '{}',
  scraped_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.sofifa_position_reference IS
  'Cache of SoFIFA position/role data for every top-5-league player seen by the periodic full scrape (scripts: playwright-sofifa.js --top5), not just players already matched to public.players. Looked up via name_aliases overlap when a brand-new FPL signing is inserted, so their granular position can be set correctly before they are auction-eligible instead of falling back to the crude element_type default.';

COMMENT ON COLUMN public.sofifa_position_reference.sofifa_id IS
  'SoFIFA''s own player id -- stable across re-scrapes, used as the upsert key.';
COMMENT ON COLUMN public.sofifa_position_reference.name_aliases IS
  'Normalized (diacritics-stripped, lowercased) name variants -- full name, common name, and first+last-word forms of each, mirroring the candidate-matching this route already does against public.players. A single normalized_name column is too narrow: SoFIFA''s common name ("Vinicius Junior") and FPL''s registered name for the same player often share no common full-string form.';
COMMENT ON COLUMN public.sofifa_position_reference.primary_position IS
  'Already run through the hybrid wide-player position rules -- a final GranularPosition, not a raw SoFIFA code.';

CREATE INDEX IF NOT EXISTS idx_sofifa_position_reference_name_aliases
  ON public.sofifa_position_reference USING GIN (name_aliases);

-- Service-role only (createAdminClient bypasses RLS anyway) -- this table is
-- an internal sync cache, never read by client code.
ALTER TABLE public.sofifa_position_reference ENABLE ROW LEVEL SECURITY;
