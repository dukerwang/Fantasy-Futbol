-- ============================================================
-- Migration 143: Cup archive carries its competition type
--
-- `season_cup_winners_archive.tournament_name` is free text copied off
-- `tournaments.name`, so identifying WHICH competition a row is has meant
-- string-matching a display name. The club trophy cabinet renders a distinct
-- object per competition, so it needs the type, not the label.
--
-- Also indexes the table by (league_id, winner_id): every existing reader
-- scans by league, but the cabinet reads by team.
-- ============================================================

ALTER TABLE public.season_cup_winners_archive
  ADD COLUMN IF NOT EXISTS tournament_type tournament_type;

-- Backfill, pass 1: from the tournament the row was archived from, matched on
-- (league_id, season, name) — the same triple archiveCupWinners() writes with.
UPDATE public.season_cup_winners_archive a
SET tournament_type = t.type
FROM public.tournaments t
WHERE a.tournament_type IS NULL
  AND t.league_id = a.league_id
  AND t.season    = a.season
  AND t.name      = a.tournament_name;

-- Backfill, pass 2: by name. Pass 1 misses every league that has actually been
-- through a reset — resetTournaments() DELETEs the tournaments right after
-- archiveCupWinners() reads them, so the archive outlives its own source rows.
-- The three names are hardcoded in createTournaments.ts and have never varied.
UPDATE public.season_cup_winners_archive
SET tournament_type = CASE tournament_name
  WHEN 'Champions Cup'   THEN 'primary_cup'::tournament_type
  WHEN 'League Cup'      THEN 'secondary_cup'::tournament_type
  WHEN 'Consolation Cup' THEN 'consolation_cup'::tournament_type
END
WHERE tournament_type IS NULL
  AND tournament_name IN ('Champions Cup', 'League Cup', 'Consolation Cup');

CREATE INDEX IF NOT EXISTS idx_cup_winners_archive_winner
  ON public.season_cup_winners_archive (league_id, winner_id);
