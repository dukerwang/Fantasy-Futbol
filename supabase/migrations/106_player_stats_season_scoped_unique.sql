-- ============================================================
-- Migration 106: Scope player_stats uniqueness to season.
-- ============================================================
--
-- player_stats was UNIQUE (player_id, match_id), where match_id is the raw
-- FPL fixture id. Per CLAUDE.md's club-identity warning, fixtures[].id
-- restarts at 1 every season -- confirmed live: 2025-26 GW1 fixtures used
-- match_id 1-10ish, and the already-published 2026-27 GW1 fixtures
-- (kickoff 2026-08-21) reuse the same low ids (1, 3, 4, 5, 6...).
--
-- Without season in the key, the first fpl_live sync of the new season
-- would upsert onConflict (player_id, match_id) straight into last
-- season's row for any player whose new fixture id matches an old one --
-- silently overwriting 2025-26 season/gameweek/stats with 2026-27 data,
-- every gameweek, all season.

ALTER TABLE public.player_stats
  DROP CONSTRAINT player_stats_player_id_match_id_key;

ALTER TABLE public.player_stats
  ADD CONSTRAINT player_stats_player_id_season_match_id_key
  UNIQUE (player_id, season, match_id);
