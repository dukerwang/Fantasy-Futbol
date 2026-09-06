-- ============================================================
-- Migration 154: close a named target when its club signs the player
--
-- Why a trigger and not application code: roster acquisitions are written
-- from at least five places, and nearly all of them are PL/pgSQL —
-- resolve_single_player_auction_rpc, the trade execution RPC, the draft pick
-- RPC, loan activation, and the admin/e2e path. A TypeScript hook would have
-- to be added to each and remembered by every future one. A trigger on the
-- table cannot be forgotten.
--
-- PROFILES ARE DELIBERATELY NOT TOUCHED. Signing one left-back does not mean
-- a club has stopped looking for a left-back — he may be a squad player, or
-- the wrong one. A profile ends when its owner withdraws it or when it
-- expires. This asymmetry is the spec's, not an oversight:
-- docs/superpowers/specs/2026-09-04-targets-design.md § Guards
-- ============================================================

CREATE OR REPLACE FUNCTION public.fill_targets_on_acquisition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.player_targets
  SET status = 'filled'
  WHERE status = 'active'
    AND target_kind = 'player'
    AND player_id = NEW.player_id
    AND team_id = NEW.team_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_fill_targets_on_acquisition ON public.roster_entries;
CREATE TRIGGER trg_fill_targets_on_acquisition
  AFTER INSERT ON public.roster_entries
  FOR EACH ROW EXECUTE FUNCTION public.fill_targets_on_acquisition();
