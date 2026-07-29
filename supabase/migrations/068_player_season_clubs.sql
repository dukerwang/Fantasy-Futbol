-- ============================================================
-- Migration 068: Per-season club record for players
-- ============================================================
--
-- PROBLEM
-- -------
-- `players.pl_team` / `players.pl_team_id` are overwritten by every sync, so
-- they describe a player's club TODAY, not in any past season. The players
-- table currently carries `pl_season = '2025-26'` while listing Coventry, Hull
-- and Ipswich — clubs that were NOT in the 2025-26 Premier League. It has been
-- partially re-synced to 2026-27 without the label being updated.
--
-- That makes it unusable for joining archived data: a 2025-26 game log keyed on
-- it would give every summer transfer their NEW club's fixtures, and therefore
-- a confidently wrong opponent for each match.
--
-- FIX
-- ---
-- One row per (player, season) recording the club they actually played for,
-- referenced by the stable slug from src/lib/clubs/clubs.json. Written once per
-- season at archive time and never overwritten by a live sync.

CREATE TABLE IF NOT EXISTS public.player_season_clubs (
  player_id   UUID        NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  season      TEXT        NOT NULL,          -- "2025-26"
  club_slug   TEXT        NOT NULL,          -- stable slug, e.g. "west-ham"
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (player_id, season)
);

CREATE INDEX IF NOT EXISTS player_season_clubs_season_idx
  ON public.player_season_clubs (season, club_slug);

ALTER TABLE public.player_season_clubs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Enable read access for all authenticated users"
  ON public.player_season_clubs FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Enable write access for service role only"
  ON public.player_season_clubs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
