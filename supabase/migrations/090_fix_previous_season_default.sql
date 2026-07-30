-- Migration 090: Fix stale previous_season default that sent brand-new
-- 2026-27 leagues to 2024-25 (zero archive rows → empty draft boards / ranks).
-- Archives currently exist for 2025-26 only.

ALTER TABLE public.leagues
  ALTER COLUMN previous_season SET DEFAULT '2025-26';

-- Backfill setup/drafting leagues whose previous_season has no archive data.
-- Keep current_season as-is (upcoming fantasy year); only correct the scouting
-- baseline so draft boards and preseason club cards resolve to 2025-26.
UPDATE public.leagues l
SET previous_season = '2025-26'
WHERE l.status IN ('setup', 'drafting')
  AND COALESCE(l.previous_season, '') = '2024-25'
  AND NOT EXISTS (
    SELECT 1
    FROM public.season_player_stats_archive a
    WHERE a.season = '2024-25'
    LIMIT 1
  );
