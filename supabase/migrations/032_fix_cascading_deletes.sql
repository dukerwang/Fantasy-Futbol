-- ============================================================
-- Fix Matchups Cascading Deletion
-- ============================================================

-- Matchups
ALTER TABLE public.matchups 
  DROP CONSTRAINT IF EXISTS matchups_team_a_id_fkey,
  ADD CONSTRAINT matchups_team_a_id_fkey FOREIGN KEY (team_a_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS matchups_team_b_id_fkey,
  ADD CONSTRAINT matchups_team_b_id_fkey FOREIGN KEY (team_b_id) REFERENCES public.teams(id) ON DELETE CASCADE;

-- Tournament Matchups
ALTER TABLE public.tournament_matchups
  DROP CONSTRAINT IF EXISTS tournament_matchups_team_a_id_fkey,
  ADD CONSTRAINT tournament_matchups_team_a_id_fkey FOREIGN KEY (team_a_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS tournament_matchups_team_b_id_fkey,
  ADD CONSTRAINT tournament_matchups_team_b_id_fkey FOREIGN KEY (team_b_id) REFERENCES public.teams(id) ON DELETE CASCADE,
  DROP CONSTRAINT IF EXISTS tournament_matchups_winner_id_fkey,
  ADD CONSTRAINT tournament_matchups_winner_id_fkey FOREIGN KEY (winner_id) REFERENCES public.teams(id) ON DELETE CASCADE;
