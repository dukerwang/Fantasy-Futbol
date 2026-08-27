-- Migration 142: Merge duplicate player rows (SoFIFA/FPL name-drift bug)
--
-- SYMPTOM
-- -------
-- Rostered players displaying "0 pts" in the UI (Yéremy Pino, Pedro Porro,
-- Igor Thiago, Jamie Gittens, Murillo, Joelinton, ...).
--
-- ROOT CAUSE
-- ----------
-- syncPlayersFromFpl (src/lib/players/syncPlayers.ts) matches incoming FPL
-- rows against existing DB rows by fpl_id, then by an EXACT normalized-name
-- lookup, then by an EXACT web_name+team lookup. When FPL's reported
-- name/web_name for a player drifted from what was already stored — and the
-- existing row had never had fpl_id backfilled either (true for players
-- whose row predates fpl_id being recorded) — none of the three exact-match
-- passes found the real row, and sync fell through to INSERTing a brand-new,
-- empty duplicate. The new row inherited the player's current fpl_id,
-- pl_team and is_active flag but has zero player_stats history, so the UI
-- reads "0 pts" from it while the real season history sits orphaned on the
-- old row. See src/lib/players/syncPlayers.ts (Pass 4, added in this same
-- change) for the sync-side fix.
--
-- SCOPE
-- -----
-- `SELECT web_name, pl_team, COUNT(*) FROM players WHERE pl_season = '2025-26'
--  GROUP BY web_name, pl_team HAVING COUNT(*) > 1` finds 97 duplicate-key
-- groups. Only 18 of those are the SAME real footballer under two rows
-- (verified by requiring the two rows' `name` fields to share a significant
-- token, e.g. "Yéremy Pino" / "Yéremy Pino Santos" both contain "pino") —
-- those 18 are merged below.
--
-- The other 79 groups are a SEPARATE, unrelated form of corruption: an
-- inactive/departed player's row has had its web_name/pl_team overwritten to
-- coincide with a completely different, unrelated active player's identity
-- (e.g. a row named "Albert Sambi Lokonga" now carries web_name "M.Bizot" /
-- pl_team "Aston Villa", matching the real Marco Bizot's row). None of those
-- 79 are referenced by any roster_entries — the real active player in each
-- pair is correctly rostered under their own row — so they are NOT touched
-- by this migration. Merging them would silently delete a distinct real
-- player's row. They need their own investigation (likely a repair/backfill
-- script that zipped two unrelated arrays together) and are intentionally
-- left alone here.
--
-- Of the 18 true duplicates, 6 are currently rostered, accounting for
-- exactly 30 roster_entries rows (6 groups x 5 fantasy teams each) — matching
-- the originally reported "30 duplicates referenced by live roster_entries".
--
-- Full investigation trail: scratch/dry_run_merge_duplicate_players.js
-- (read-only — reproduces every number in this comment against live data).
--
-- KEEPER SELECTION
-- ----------------
-- For each pair, the "keeper" is the row with more player_stats rows (ties
-- broken by total_points, then by having fpl_id set, then by created_at).
-- This is deliberately NOT "prefer the active row" or "prefer the row with
-- fpl_id" — in most pairs the row FPL is actively syncing is the empty one,
-- but in 3 of the 18 pairs (Julián Araujo, Matheus França, John Victor) the
-- row FPL syncs is ALSO the one with more history, so a rule based on
-- is_active/fpl_id alone would keep the wrong row in those three cases.
--
-- SPECIAL CASE — Matheus França (Crystal Palace pair)
-- ----------------------------------------------------
-- The keeper's existing player_season_clubs (2025-26) row says 'burnley';
-- the loser's says 'crystal-palace'. This looks like a genuine mid-season
-- transfer, not corruption — a single row can't represent both, and this
-- migration is not the place to guess which club_slug is authoritative for
-- that season. The keeper's existing 'burnley' row is left as-is (the
-- loser's row is simply dropped, per the generic collision rule in step 10);
-- fix player_season_clubs by hand afterward if 'burnley' turns out wrong.
-- Neither row is currently rostered, so this is not urgent.
--
-- SAFETY
-- ------
-- Every step is a no-op if the source data isn't there (WHERE-filtered
-- UPDATE/DELETE against merge_map), so this migration is safe to re-run.
-- Run scratch/dry_run_merge_duplicate_players.js again first if reapplying
-- after any live sync has run — player_stats/roster state shifts constantly.

BEGIN;

CREATE TEMP TABLE merge_map (
  keeper_id UUID NOT NULL,
  loser_id  UUID NOT NULL,
  label     TEXT NOT NULL,
  -- Populated from the loser row further down, BEFORE the loser is deleted
  -- (players.fpl_id is UNIQUE, so keeper and loser cannot briefly share one
  -- inside the same transaction — the loser has to be gone first).
  final_fpl_id                INT,
  final_is_active              BOOLEAN,
  final_pl_team                TEXT,
  final_pl_team_id              INT,
  final_market_value            NUMERIC,
  final_market_value_updated_at TIMESTAMPTZ,
  final_photo_url              TEXT,
  final_fpl_status              TEXT,
  final_fpl_news                TEXT,
  final_date_of_birth           DATE
) ON COMMIT DROP;

INSERT INTO merge_map (keeper_id, loser_id, label) VALUES
  ('dff991ed-2066-4d35-af6e-bdbdcb6d3e18', 'a7b8448b-359d-40cd-8c03-10acf7414683', 'Jamie Gittens / Chelsea'),
  ('b058045c-a38a-4087-bfeb-2f27eda28848', '7d34c91a-32c6-4148-b102-52dfd8d71ce1', 'Igor Thiago / Brentford'),
  ('e9df668d-5e5d-4c48-85f6-b06a0752a74b', '0fc02493-089b-4944-af9e-4efab5b9d7bf', 'Julián Araujo / Bournemouth'),
  ('50d7b59e-0000-4be6-a5ac-8c4628020d55', '140d2ff0-daad-4b07-b190-96f2022b42a5', 'Pedro Porro / Spurs'),
  ('f71c4738-57f9-442e-ace1-5034b0114b45', 'fabc0950-fead-4cfb-9d13-513c7edbf3c2', 'Jair Cunha / Nott''m Forest'),
  ('4c4752cc-da95-4fa4-b070-7ce69adf317d', '90ac9db9-8814-4344-8a4b-5bf60966b446', 'Marc Guiu / Chelsea'),
  ('0473d57b-d7ba-4c7d-b634-bff59c97d61c', '3c6064e5-06f5-4f5f-bb9c-18ea6bf9c083', 'Chadi Riad / Crystal Palace'),
  ('22bee9ee-5422-4cd9-b95c-58273a23cbd3', '9cfc276c-a14a-4bed-bfaf-f80468421694', 'Carlos Alcaraz / Everton'),
  ('5c4576ad-ee8c-4069-b50f-e923284c5e62', 'c19f01a3-50c8-4ce2-9feb-c071fbd04cab', 'Yéremy Pino / Crystal Palace'),
  ('60091a4c-4a43-4698-beb0-94e98a8057c5', '77545a79-9732-4667-ad62-5abe1f52e44d', 'Jorge Cuenca / Fulham'),
  ('849e7798-5fa5-4271-9eb9-b570b8e0cb89', 'be54a145-d986-44df-af3f-114b563235e2', 'Stefan Bajcetic / Liverpool'),
  ('ce3ac641-f186-4324-b2a4-ff310086601f', '23d7d78e-3cff-4aa0-aade-31986914dd8c', 'Dário Essugo / Chelsea'),
  ('222a3420-6c35-412a-a0f7-b035ac7c3ec5', '833c6f51-1922-4ad4-bc0b-0217cfaade7b', 'Murillo / Nott''m Forest'),
  ('27d39c64-cb27-43ad-8e2b-3aff60b06fa6', '9133eb19-67da-4c96-8ffb-5aa89adff291', 'Mateo Joseph / Leeds'),
  ('3e294cd3-b3a7-40eb-807a-614daa81f04d', '2f0c152e-24bf-4c35-ae1c-e2787d6f2288', 'Matheus França / Crystal Palace'),
  ('8fcf0391-9d05-457b-83e5-eb5e6913704a', '38ec2b28-3e52-429c-a1fd-490a46f1580f', 'Diego Gómez / Brighton'),
  ('5606a893-d5b8-4c73-a014-014e8b432330', '0dc98ce2-b1fd-4d91-bcc7-2e0e0e99eb05', 'Joelinton / Newcastle'),
  ('f9b4ed25-0763-460d-b173-9b837d38399e', 'b4e9d169-453d-4cc0-bb16-ac352389f68d', 'John Victor / Nott''m Forest');

-- Guard: every id must exist and be distinct from its pair partner before
-- touching anything.
DO $$
DECLARE v_bad_count INT;
BEGIN
  SELECT COUNT(*) INTO v_bad_count
  FROM merge_map m
  WHERE NOT EXISTS (SELECT 1 FROM players WHERE id = m.keeper_id)
     OR NOT EXISTS (SELECT 1 FROM players WHERE id = m.loser_id)
     OR m.keeper_id = m.loser_id;
  IF v_bad_count > 0 THEN
    RAISE EXCEPTION 'merge_map has % invalid row(s) — aborting', v_bad_count;
  END IF;
END $$;

-- 0. Capture the sync-owned fields each keeper should end up with, resolved
--    now while both rows still exist. Prefer whichever row FPL is actually
--    tracking (has fpl_id set) — usually the loser, but not always (Julián
--    Araujo / Matheus França / John Victor already had fpl_id on the
--    keeper). Identity fields (name, full_name, sofifa_common_name,
--    primary_position, total_points, ppg, form, ...) are left as the
--    keeper's own — that's precisely the real history this merge protects.
UPDATE merge_map m
SET
  final_fpl_id                = COALESCE(k.fpl_id, l.fpl_id),
  final_is_active               = (k.is_active OR l.is_active),
  final_pl_team                 = CASE WHEN l.fpl_id IS NOT NULL THEN l.pl_team ELSE k.pl_team END,
  final_pl_team_id               = CASE WHEN l.fpl_id IS NOT NULL THEN l.pl_team_id ELSE k.pl_team_id END,
  final_market_value             = CASE WHEN l.fpl_id IS NOT NULL THEN l.market_value ELSE k.market_value END,
  final_market_value_updated_at  = CASE WHEN l.fpl_id IS NOT NULL THEN l.market_value_updated_at ELSE k.market_value_updated_at END,
  final_photo_url                = COALESCE(CASE WHEN l.fpl_id IS NOT NULL THEN l.photo_url END, k.photo_url),
  final_fpl_status                = CASE WHEN l.fpl_id IS NOT NULL THEN l.fpl_status ELSE k.fpl_status END,
  final_fpl_news                  = CASE WHEN l.fpl_id IS NOT NULL THEN l.fpl_news ELSE k.fpl_news END,
  final_date_of_birth              = COALESCE(k.date_of_birth, l.date_of_birth)
FROM players k, players l
WHERE k.id = m.keeper_id AND l.id = m.loser_id;

-- 1. roster_entries — UNIQUE (player_id, team_id). A team cannot hold both
--    the keeper and the loser; if it somehow does, drop the loser's entry
--    for that team and keep the keeper's.
DELETE FROM roster_entries re
USING merge_map m
WHERE re.player_id = m.loser_id
  AND EXISTS (
    SELECT 1 FROM roster_entries re2
    WHERE re2.team_id = re.team_id AND re2.player_id = m.keeper_id
  );

UPDATE roster_entries re
SET player_id = m.keeper_id
FROM merge_map m
WHERE re.player_id = m.loser_id;

-- 2. player_stats — UNIQUE (player_id, match_id). Drop any loser row whose
--    match_id the keeper already has (true history wins); repoint the rest.
DELETE FROM player_stats ps
USING merge_map m
WHERE ps.player_id = m.loser_id
  AND EXISTS (
    SELECT 1 FROM player_stats ps2
    WHERE ps2.player_id = m.keeper_id AND ps2.match_id = ps.match_id
  );

UPDATE player_stats ps
SET player_id = m.keeper_id
FROM merge_map m
WHERE ps.player_id = m.loser_id;

-- 3. transactions — nullable FK, no unique constraint on player_id.
UPDATE transactions t
SET player_id = m.keeper_id
FROM merge_map m
WHERE t.player_id = m.loser_id;

-- 4. waiver_claims — player_id and drop_player_id both reference players.
--    auction_state (078_auction_state_projection.sql) is a trigger-
--    maintained read model off THIS table — updating here fires
--    trg_auction_state_upd and refreshes/resolves the projection
--    automatically. Do not write to auction_state directly.
UPDATE waiver_claims wc
SET player_id = m.keeper_id
FROM merge_map m
WHERE wc.player_id = m.loser_id;

UPDATE waiver_claims wc
SET drop_player_id = m.keeper_id
FROM merge_map m
WHERE wc.drop_player_id = m.loser_id;

-- 5. draft_picks
UPDATE draft_picks dp
SET player_id = m.keeper_id
FROM merge_map m
WHERE dp.player_id = m.loser_id;

-- 6. player_sale_listings
UPDATE player_sale_listings psl
SET player_id = m.keeper_id
FROM merge_map m
WHERE psl.player_id = m.loser_id;

-- 7. player_loans
UPDATE player_loans pl
SET player_id = m.keeper_id
FROM merge_map m
WHERE pl.player_id = m.loser_id;

-- 8. departure_decisions
UPDATE departure_decisions dd
SET player_id = m.keeper_id
FROM merge_map m
WHERE dd.player_id = m.loser_id;

-- 9. trade_proposals — uuid[] columns, rewrite the array element in place.
UPDATE trade_proposals tp
SET offered_players = array_replace(tp.offered_players, m.loser_id, m.keeper_id)
FROM merge_map m
WHERE m.loser_id = ANY(tp.offered_players);

UPDATE trade_proposals tp
SET requested_players = array_replace(tp.requested_players, m.loser_id, m.keeper_id)
FROM merge_map m
WHERE m.loser_id = ANY(tp.requested_players);

-- 10. player_season_clubs — PK (player_id, season). If the keeper already
--     has a row for a season the loser also has, the keeper's existing
--     value wins and the loser's row is just dropped (see the Matheus
--     França note above for the one case where this matters).
DELETE FROM player_season_clubs psc
USING merge_map m
WHERE psc.player_id = m.loser_id
  AND EXISTS (
    SELECT 1 FROM player_season_clubs psc2
    WHERE psc2.player_id = m.keeper_id AND psc2.season = psc.season
  );

UPDATE player_season_clubs psc
SET player_id = m.keeper_id
FROM merge_map m
WHERE psc.player_id = m.loser_id;

-- 11. matchups.lineup_a / lineup_b — JSONB snapshots of
--     { starters: [{slot, player_id}], bench: [...], formation }, not a real
--     FK. Only 'scheduled'/'live' matchups reference any loser id (checked
--     live — none of the 18 loser rows are old enough to appear in an
--     already-'completed' historical lineup), so only those are rewritten;
--     resolved history is left untouched. UUIDs are unique 36-char strings,
--     so a plain text substring replace on the JSONB is safe.
UPDATE matchups mu
SET lineup_a = replace(mu.lineup_a::text, m.loser_id::text, m.keeper_id::text)::jsonb
FROM merge_map m
WHERE mu.status IN ('scheduled', 'live')
  AND mu.lineup_a::text LIKE '%' || m.loser_id::text || '%';

UPDATE matchups mu
SET lineup_b = replace(mu.lineup_b::text, m.loser_id::text, m.keeper_id::text)::jsonb
FROM merge_map m
WHERE mu.status IN ('scheduled', 'live')
  AND mu.lineup_b::text LIKE '%' || m.loser_id::text || '%';

-- 12. Delete the now-fully-repointed loser rows FIRST. players.fpl_id is
--     UNIQUE, so the loser (which still holds the fpl_id the keeper is
--     about to inherit in step 13) has to be gone before that happens.
--     Nothing should still reference these rows at this point — the
--     CASCADE on players.id would silently take out any FK table this
--     migration forgot to repoint above, so re-check supabase/migrations
--     for new `REFERENCES public.players(id)` columns before assuming this
--     list stays complete.
DELETE FROM players p
USING merge_map m
WHERE p.id = m.loser_id;

-- 13. Backfill the keeper's sync-owned fields using the values captured in
--     step 0 (the loser row is gone now, so this can't join to it directly).
UPDATE players k
SET
  fpl_id                  = m.final_fpl_id,
  is_active                = m.final_is_active,
  pl_team                  = m.final_pl_team,
  pl_team_id                = m.final_pl_team_id,
  market_value              = m.final_market_value,
  market_value_updated_at   = m.final_market_value_updated_at,
  photo_url                = m.final_photo_url,
  fpl_status                = m.final_fpl_status,
  fpl_news                  = m.final_fpl_news,
  date_of_birth              = m.final_date_of_birth,
  updated_at                = NOW()
FROM merge_map m
WHERE k.id = m.keeper_id;

-- 14. Recompute total_points/form (and ppg/form_rating) from player_stats
--     for every player — these existing, idempotent RPCs (063) are the
--     app's own canonical recompute path, safer than hand-rolling the
--     aggregation here. Several keepers just inherited extra player_stats
--     rows in step 2, so their cached total_points would otherwise be
--     stale until the next scheduled sync.
SELECT public.update_player_fantasy_scores('2025-26');
SELECT public.update_player_form_ratings('2025-26');

COMMIT;

-- ============================================================
-- POST-APPLY CHECKS
-- ============================================================
--
--   -- Should return zero rows (no loser id survives anywhere):
--   SELECT 'players' t, id FROM players WHERE id IN (
--     'a7b8448b-359d-40cd-8c03-10acf7414683','7d34c91a-32c6-4148-b102-52dfd8d71ce1',
--     '0fc02493-089b-4944-af9e-4efab5b9d7bf','140d2ff0-daad-4b07-b190-96f2022b42a5',
--     'fabc0950-fead-4cfb-9d13-513c7edbf3c2','90ac9db9-8814-4344-8a4b-5bf60966b446',
--     '3c6064e5-06f5-4f5f-bb9c-18ea6bf9c083','9cfc276c-a14a-4bed-bfaf-f80468421694',
--     'c19f01a3-50c8-4ce2-9feb-c071fbd04cab','77545a79-9732-4667-ad62-5abe1f52e44d',
--     'be54a145-d986-44df-af3f-114b563235e2','23d7d78e-3cff-4aa0-aade-31986914dd8c',
--     '833c6f51-1922-4ad4-bc0b-0217cfaade7b','9133eb19-67da-4c96-8ffb-5aa89adff291',
--     '2f0c152e-24bf-4c35-ae1c-e2787d6f2288','38ec2b28-3e52-429c-a1fd-490a46f1580f',
--     '0dc98ce2-b1fd-4d91-bcc7-2e0e0e99eb05','b4e9d169-453d-4cc0-bb16-ac352389f68d'
--   );
--
--   -- Rostered players should now show real points (expect ~30 rows, all pts > 0):
--   SELECT re.team_id, p.name, p.total_points
--   FROM roster_entries re JOIN players p ON p.id = re.player_id
--   WHERE p.id IN (
--     'dff991ed-2066-4d35-af6e-bdbdcb6d3e18','b058045c-a38a-4087-bfeb-2f27eda28848',
--     '50d7b59e-0000-4be6-a5ac-8c4628020d55','5c4576ad-ee8c-4069-b50f-e923284c5e62',
--     '222a3420-6c35-412a-a0f7-b035ac7c3ec5','5606a893-d5b8-4c73-a014-014e8b432330'
--   );
--
--   -- Confirm the 79 different-identity groups were left untouched (should
--   -- still report ~79, not 0 and not 97):
--   SELECT COUNT(*) FROM (
--     SELECT web_name, pl_team FROM players
--     WHERE pl_season = '2025-26' AND web_name IS NOT NULL
--     GROUP BY web_name, pl_team HAVING COUNT(*) > 1
--   ) dupes;
