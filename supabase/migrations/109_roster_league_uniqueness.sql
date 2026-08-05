-- Gaffa — Migration 109: one club per player per league, enforced by the index
--
-- roster_entries is UNIQUE (player_id, team_id) — which says a player cannot be
-- on the SAME club twice, and says nothing at all about him being on two
-- DIFFERENT clubs in the same league. That is the shape of every duplication
-- bug this table has had: the draft race fixed in 108, the free-agent bid on a
-- rostered player fixed in 079, the double-sale fixed in 076. Each was found
-- after the fact, in production data, by a GROUP BY that should have been an
-- index all along.
--
-- WHY NOT A PLAIN UNIQUE (league_id, player_id):
--   roster_entries has no league_id, and the league is only reachable through
--   teams. An expression index cannot do the join (a subquery is not
--   IMMUTABLE), and a plain BEFORE-INSERT trigger that SELECTs for a conflict
--   does not serialize — two concurrent inserts both see no conflict and both
--   commit, which is precisely the failure being fixed. Only a real btree
--   index is safe under concurrency.
--
--   So: denormalize league_id, maintained by trigger rather than by callers.
--   There are ~a dozen writers of roster_entries across routes, RPCs, cron and
--   scripts; asking every one of them to pass a new column is a guarantee that
--   one of them eventually won't. The trigger derives it from team_id on every
--   insert and on any team_id change, so existing writers need no edit and a
--   writer that supplies a wrong league_id (scratch/clone-league.js copies
--   whole rows with SELECT *) has it corrected rather than honoured.
--
-- WHY PARTIAL ON status <> 'loan_out':
--   A loan is the one legitimate case of two roster rows for one player in one
--   league (060): the lender's row flips to 'loan_out' and the borrower gets a
--   new 'loan_in' row. The lender's row is a rights placeholder, not squad
--   membership. Excluding 'loan_out' leaves exactly one indexed row during a
--   loan, so loans keep working and a second real roster row still collides.
--   Two 'loan_out' rows for one player cannot arise either — creating the
--   second one requires a second indexed row first.
--
-- ORDER OF OPERATIONS: this migration REFUSES TO APPLY while duplicates exist.
-- Resolve them first with scripts/repair-duplicate-roster-entries.mjs, which
-- needs a human decision about which club keeps each player. Apply 108 before
-- this one; 108 is safe on dirty data and stops new duplicates being created
-- while the existing ones are being adjudicated.

-- ── 1. Refuse to run on dirty data ───────────────────────────

DO $$
DECLARE
  v_report TEXT;
BEGIN
  SELECT string_agg(
           format('  league %s / player %s (%s) on %s clubs: %s',
                  d.league_id, d.player_id, COALESCE(d.player_name, '?'), d.n, d.teams),
           E'\n' ORDER BY d.league_id, d.player_name)
  INTO v_report
  FROM (
    SELECT t.league_id,
           re.player_id,
           MAX(p.name)                AS player_name,
           COUNT(*)                   AS n,
           string_agg(t.team_name, ', ' ORDER BY t.team_name) AS teams
    FROM public.roster_entries re
    JOIN public.teams   t ON t.id = re.team_id
    LEFT JOIN public.players p ON p.id = re.player_id
    WHERE re.status <> 'loan_out'
    GROUP BY t.league_id, re.player_id
    HAVING COUNT(*) > 1
  ) d;

  IF v_report IS NOT NULL THEN
    RAISE EXCEPTION E'Cannot apply 109: players are on two clubs in the same league.\n%\n\nRun `node scripts/repair-duplicate-roster-entries.mjs` to review and resolve these, then re-run this migration.', v_report;
  END IF;
END $$;

-- ── 2. The denormalized league ───────────────────────────────

ALTER TABLE public.roster_entries
  ADD COLUMN IF NOT EXISTS league_id UUID REFERENCES public.leagues(id) ON DELETE CASCADE;

UPDATE public.roster_entries re
SET league_id = t.league_id
FROM public.teams t
WHERE t.id = re.team_id
  AND re.league_id IS DISTINCT FROM t.league_id;

-- Derived, never supplied. team_id is the source of truth; this column is a
-- projection of it that exists only so an index can see it.
CREATE OR REPLACE FUNCTION public.roster_entries_set_league_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  SELECT t.league_id INTO NEW.league_id
  FROM public.teams t WHERE t.id = NEW.team_id;

  IF NEW.league_id IS NULL THEN
    RAISE EXCEPTION 'roster_entries.team_id % does not resolve to a league', NEW.team_id
      USING ERRCODE = 'foreign_key_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_roster_entries_set_league_id ON public.roster_entries;
CREATE TRIGGER trg_roster_entries_set_league_id
  BEFORE INSERT OR UPDATE OF team_id ON public.roster_entries
  FOR EACH ROW EXECUTE FUNCTION public.roster_entries_set_league_id();

ALTER TABLE public.roster_entries ALTER COLUMN league_id SET NOT NULL;

-- ── 3. The guard ─────────────────────────────────────────────

CREATE UNIQUE INDEX IF NOT EXISTS roster_entries_one_club_per_player_per_league
  ON public.roster_entries (league_id, player_id)
  WHERE status <> 'loan_out'::public.roster_status;

COMMENT ON INDEX public.roster_entries_one_club_per_player_per_league IS
  'A player belongs to at most one club per league. Excludes loan_out, the lender''s rights placeholder while a player is out on loan (see migration 060).';


-- ============================================================
-- POST-APPLY CHECKS
-- ============================================================
--
--   -- The index exists and is unique + partial:
--   SELECT indexdef FROM pg_indexes
--    WHERE schemaname = 'public'
--      AND indexname = 'roster_entries_one_club_per_player_per_league';
--
--   -- Every row has a league_id and it matches its team:
--   SELECT COUNT(*) FROM public.roster_entries re
--     JOIN public.teams t ON t.id = re.team_id
--    WHERE re.league_id IS DISTINCT FROM t.league_id;   -- expect 0
--
--   -- The guard actually bites (expect a unique_violation, then ROLLBACK):
--   -- BEGIN;
--   --   INSERT INTO public.roster_entries (team_id, player_id, status, acquisition_type)
--   --   SELECT (SELECT id FROM public.teams
--   --            WHERE league_id = re.league_id AND id <> re.team_id LIMIT 1),
--   --          re.player_id, 'bench', 'draft'
--   --     FROM public.roster_entries re WHERE re.status = 'bench' LIMIT 1;
--   -- ROLLBACK;
--
--   -- Active loans still hold two rows, one of them loan_out:
--   SELECT league_id, player_id, array_agg(status)
--     FROM public.roster_entries
--    GROUP BY league_id, player_id HAVING COUNT(*) > 1;
--   -- expect only {loan_in,loan_out} pairs
