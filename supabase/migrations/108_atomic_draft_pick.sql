-- Gaffa — Migration 108: one draft pick path, transactionally locked
--
-- A player ended up on two clubs in the same league, eight times, all
-- acquisition_type = 'draft'. The draft has two independent writers and
-- neither one is atomic:
--
--   * POST /api/leagues/[leagueId]/draft/pick — six sequential PostgREST
--     calls, each its own transaction. It reads draft_picks, decides who is
--     on the clock, checks the player is free, THEN inserts the pick, THEN
--     (separate transaction, no re-check) inserts the roster row. Every
--     validation is stale by the time the write lands.
--
--   * auto_pick_expired_drafts() — scheduled by 011 as THREE overlapping
--     pg_cron jobs per minute (:00, :20 via pg_sleep, :40 via pg_sleep), and
--     additionally reachable through POST /api/leagues/[leagueId]/draft/
--     auto-pick, which every browser in the draft room fires the instant its
--     timer hits zero. Four-plus concurrent invocations of the same global
--     function is the normal case, not the edge case.
--
-- Both writers ask "is this player in draft_picks for this league?" and
-- neither asks "is this player already on a roster in this league?" — so the
-- only thing standing between the draft and a duplicate is the
-- unique_league_player constraint added by hand in 048, on a different table
-- than the one that got corrupted. 048 is a bare ADD CONSTRAINT with no
-- IF NOT EXISTS: if the table held a duplicate the day it was pasted into the
-- SQL editor, it errored and the constraint does not exist. Nothing in the
-- code would notice.
--
-- This migration collapses both writers onto one function that takes a
-- league-scoped advisory lock, re-derives who is on the clock *under that
-- lock*, checks roster_entries as well as draft_picks, and writes both rows in
-- one transaction. Migration 109 then makes the duplicate structurally
-- impossible; this one makes the path that produced it correct.
--
-- Candidate-selection scoring in auto_pick_expired_drafts below is carried
-- over unchanged from 089 (percentile-blended need/quality composite,
-- LWB/RWB as DEF, ramped GK need) — only the locking/writing shell changes.
-- Both scans additionally exclude players already on a roster in the league
-- (not just players in draft_picks), matching the RPC's own check.

-- ── 1. The atomic pick ───────────────────────────────────────
--
-- p_user_id NULL means "server-initiated" (auto-pick): ownership is not
-- checked and consecutive_autopicks increments instead of resetting.
--
-- The advisory lock is transaction-scoped, so it is released when PostgREST
-- commits the statement — safe under Supabase's connection pooling, where a
-- session-scoped lock would leak onto whoever gets the connection next.

CREATE OR REPLACE FUNCTION public.make_draft_pick_rpc(
  p_league_id UUID,
  p_player_id UUID,
  p_user_id   UUID DEFAULT NULL,
  -- Optional assertion from the caller. A client that believes it is making
  -- pick 47 fails loudly if the board moved under it, instead of silently
  -- drafting for whoever is on the clock now.
  p_expect_pick INT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_status        public.league_status;
  v_roster_size   INT;
  v_num_teams     INT;
  v_pick_count    INT;
  v_total_picks   INT;
  v_pick_number   INT;
  v_round         INT;
  v_slot          INT;
  v_team_id       UUID;
  v_team_user_id  UUID;
  v_team_name     TEXT;
  v_is_active     BOOLEAN;
  v_team_picks    INT;
  v_pick_id       UUID;
  v_is_complete   BOOLEAN;
  v_is_autopick   BOOLEAN := (p_user_id IS NULL);
BEGIN
  -- 0. THE SERIALIZATION POINT. Every pick in this league — human or
  --    auto — queues here. Two callers can no longer both read pick count N
  --    and both decide they are making pick N+1.
  PERFORM pg_advisory_xact_lock(hashtext('gaffa:draft'), hashtext(p_league_id::TEXT));

  SELECT status, roster_size INTO v_status, v_roster_size
  FROM public.leagues WHERE id = p_league_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'league_not_found',
      'http_status', 404, 'error', 'League not found');
  END IF;

  IF v_status <> 'drafting' THEN
    RETURN jsonb_build_object('success', false, 'code', 'draft_not_active',
      'http_status', 400, 'error', 'Draft is not active');
  END IF;

  SELECT COUNT(*) INTO v_num_teams FROM public.teams WHERE league_id = p_league_id;

  IF v_num_teams = 0 THEN
    RETURN jsonb_build_object('success', false, 'code', 'no_teams',
      'http_status', 400, 'error', 'No teams found');
  END IF;

  -- 1. Everything below is derived under the lock, so it is still true when
  --    the INSERT runs a few lines later.
  SELECT COUNT(*) INTO v_pick_count FROM public.draft_picks WHERE league_id = p_league_id;

  v_total_picks := v_num_teams * v_roster_size;

  IF v_pick_count >= v_total_picks THEN
    RETURN jsonb_build_object('success', false, 'code', 'draft_complete',
      'http_status', 400, 'error', 'Draft is already complete');
  END IF;

  v_pick_number := v_pick_count + 1;
  v_slot        := public.snake_draft_order(v_pick_number, v_num_teams);
  v_round       := CEIL(v_pick_number::NUMERIC / v_num_teams);

  IF p_expect_pick IS NOT NULL AND p_expect_pick <> v_pick_number THEN
    RETURN jsonb_build_object('success', false, 'code', 'pick_moved',
      'http_status', 409, 'error', 'The board moved — that pick has already been made.');
  END IF;

  SELECT id, user_id, team_name INTO v_team_id, v_team_user_id, v_team_name
  FROM public.teams
  WHERE league_id = p_league_id AND draft_order = v_slot;

  IF v_team_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'code', 'no_current_team',
      'http_status', 500, 'error', 'Could not determine current team');
  END IF;

  IF NOT v_is_autopick AND v_team_user_id <> p_user_id THEN
    RETURN jsonb_build_object('success', false, 'code', 'not_your_pick',
      'http_status', 403, 'error', 'Not your pick');
  END IF;

  SELECT is_active INTO v_is_active FROM public.players WHERE id = p_player_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'code', 'player_not_found',
      'http_status', 404, 'error', 'Player not found');
  END IF;

  IF NOT v_is_active THEN
    RETURN jsonb_build_object('success', false, 'code', 'player_inactive',
      'http_status', 400, 'error', 'Player is not active');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.draft_picks
    WHERE league_id = p_league_id AND player_id = p_player_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'player_taken',
      'http_status', 409, 'error', 'This player has already been drafted by another team.');
  END IF;

  -- 2. THE CHECK NEITHER WRITER MADE. draft_picks is a log of the draft;
  --    roster_entries is the thing that decides who owns whom. A player can
  --    be on a roster without a draft_picks row (auction, trade, loan, an
  --    earlier season's roster carried forward, or a pick log that was
  --    pruned) and every one of those cases used to be draftable again.
  IF EXISTS (
    SELECT 1
    FROM public.roster_entries re
    JOIN public.teams t ON t.id = re.team_id
    WHERE t.league_id = p_league_id
      AND re.player_id = p_player_id
      AND re.status <> 'loan_out'
  ) THEN
    RETURN jsonb_build_object('success', false, 'code', 'player_rostered',
      'http_status', 409, 'error', 'That player is already on a club''s roster in this league.');
  END IF;

  SELECT COUNT(*) INTO v_team_picks
  FROM public.draft_picks
  WHERE league_id = p_league_id AND team_id = v_team_id;

  IF v_team_picks >= v_roster_size THEN
    RETURN jsonb_build_object('success', false, 'code', 'roster_full',
      'http_status', 400, 'error', 'Team roster is full');
  END IF;

  -- 3. Both writes, one transaction. Previously the roster row was a separate
  --    HTTP round trip that nothing rolled back.
  --
  --    The subtransaction is belt-and-braces: under the advisory lock no
  --    concurrent pick can collide, but a unique violation from anywhere else
  --    must roll back BOTH rows and surface as an ordinary 409 — never leave a
  --    pick without its roster row, and never abort a caller's whole
  --    transaction (auto_pick_expired_drafts loops over every league in one).
  BEGIN
    INSERT INTO public.draft_picks (league_id, team_id, player_id, round, pick)
    VALUES (p_league_id, v_team_id, p_player_id, v_round, v_pick_number)
    RETURNING id INTO v_pick_id;

    INSERT INTO public.roster_entries (team_id, player_id, status, acquisition_type)
    VALUES (v_team_id, p_player_id, 'bench', 'draft');
  EXCEPTION
    WHEN unique_violation THEN
      RETURN jsonb_build_object('success', false, 'code', 'pick_conflict',
        'http_status', 409, 'error', 'That pick has already been made. Refresh and try again.');
  END;

  IF v_is_autopick THEN
    UPDATE public.teams
    SET consecutive_autopicks = COALESCE(consecutive_autopicks, 0) + 1
    WHERE id = v_team_id;
  ELSE
    UPDATE public.teams SET consecutive_autopicks = 0 WHERE id = v_team_id;
  END IF;

  v_is_complete := v_pick_number >= v_total_picks;

  IF v_is_complete THEN
    UPDATE public.leagues SET status = 'active' WHERE id = p_league_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'pick_id', v_pick_id,
    'pick', v_pick_number,
    'round', v_round,
    'team_id', v_team_id,
    'team_name', v_team_name,
    'player_id', p_player_id,
    'is_autopick', v_is_autopick,
    'is_complete', v_is_complete
  );
END;
$$;

-- Service-role and pg_cron only, per 050. The route calls it with the admin
-- client; nothing should reach it with an anon key.
REVOKE EXECUTE ON FUNCTION public.make_draft_pick_rpc(uuid, uuid, uuid, int)
  FROM PUBLIC, anon, authenticated;


-- ── 2. Auto-pick delegates instead of duplicating ────────────
--
-- Candidate selection is unchanged from 089 (percentile need/quality
-- composite) except that both scans now also exclude players who are already
-- on a roster in the league, not just players in draft_picks. The insert
-- block is gone: it calls make_draft_pick_rpc, which re-derives the team and
-- the pick number under the same lock this function already holds, so a
-- candidate chosen against a stale board can no longer be written against a
-- fresh one.
--
-- The league loop takes pg_try_advisory_xact_lock and skips on failure. With
-- three overlapping cron jobs plus every draft room in the league firing the
-- HTTP trigger, contention is constant; skipping is correct because whoever
-- holds the lock is already making that league's pick. Try-lock also means
-- this function can never deadlock against itself, which a blocking lock over
-- an unordered league loop could.

CREATE OR REPLACE FUNCTION public.auto_pick_expired_drafts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  draft_record RECORD;
  v_num_teams INT;
  v_total_picks INT;
  v_current_pick_count INT;
  v_pick_number INT;
  v_draft_order_slot INT;
  v_current_team_id UUID;
  v_latest_picked_at TIMESTAMPTZ;
  v_round INT;
  v_team_position_counts JSONB;
  v_category TEXT;
  v_need_score NUMERIC;
  v_quality_score NUMERIC;
  v_need_weight NUMERIC;
  v_quality_weight NUMERIC;
  v_picks_made INT;
  v_best_score NUMERIC;
  v_best_candidate UUID;
  v_player_rec RECORD;
  v_team_pick_ids UUID[];
  v_is_in_room BOOLEAN;
  v_consecutive_autopicks INT;
  v_last_seen_at TIMESTAMPTZ;
BEGIN
  FOR draft_record IN
    SELECT l.id AS league_id, l.roster_size
    FROM leagues l
    WHERE l.status = 'drafting'
      AND l.name NOT ILIKE '%demo%'
    ORDER BY l.id
  LOOP
    -- Someone else is already picking for this league. Their pick is the one
    -- that counts; ours would be computed against a board about to change.
    IF NOT pg_try_advisory_xact_lock(hashtext('gaffa:draft'), hashtext(draft_record.league_id::TEXT)) THEN
      CONTINUE;
    END IF;

    SELECT COUNT(*) INTO v_num_teams
    FROM teams WHERE league_id = draft_record.league_id;

    IF v_num_teams = 0 THEN
      CONTINUE;
    END IF;

    v_total_picks := v_num_teams * draft_record.roster_size;

    SELECT COUNT(*) INTO v_current_pick_count
    FROM draft_picks WHERE league_id = draft_record.league_id;

    IF v_current_pick_count >= v_total_picks THEN
      UPDATE leagues SET status = 'active' WHERE id = draft_record.league_id;
      CONTINUE;
    END IF;

    SELECT COALESCE(
      (SELECT MAX(picked_at) FROM draft_picks WHERE league_id = draft_record.league_id),
      (SELECT updated_at FROM leagues WHERE id = draft_record.league_id)
    ) INTO v_latest_picked_at;

    v_pick_number := v_current_pick_count + 1;
    v_draft_order_slot := snake_draft_order(v_pick_number, v_num_teams);
    v_round := CEIL(v_pick_number::NUMERIC / v_num_teams);

    SELECT id, last_seen_at, consecutive_autopicks
    INTO v_current_team_id, v_last_seen_at, v_consecutive_autopicks
    FROM teams
    WHERE league_id = draft_record.league_id AND draft_order = v_draft_order_slot;

    IF v_current_team_id IS NULL THEN
      CONTINUE;
    END IF;

    v_is_in_room := (v_last_seen_at IS NOT NULL AND v_last_seen_at >= NOW() - INTERVAL '25 seconds');

    -- Absent for two picks running: skip the 90-second wait entirely.
    IF NOT (v_consecutive_autopicks >= 2 AND v_is_in_room = FALSE) THEN
      IF NOW() - v_latest_picked_at < INTERVAL '90 seconds' THEN
        CONTINUE;
      END IF;
    END IF;

    -- 1. The team's own queue first.
    SELECT dq.player_id INTO v_best_candidate
    FROM public.draft_queues dq
    JOIN public.teams t ON t.user_id = dq.user_id AND t.league_id = dq.league_id
    WHERE t.id = v_current_team_id
      AND NOT EXISTS (
        SELECT 1 FROM draft_picks dp
        WHERE dp.league_id = draft_record.league_id AND dp.player_id = dq.player_id
      )
      AND NOT EXISTS (
        SELECT 1 FROM roster_entries re
        JOIN teams rt ON rt.id = re.team_id
        WHERE rt.league_id = draft_record.league_id
          AND re.player_id = dq.player_id
          AND re.status <> 'loan_out'
      )
    ORDER BY dq.rank ASC
    LIMIT 1;

    -- 2. Positional need + market value/stats composite when the queue is
    --    empty or exhausted (percentile blend carried over from 089).
    IF v_best_candidate IS NULL THEN
      SELECT ARRAY_AGG(player_id) INTO v_team_pick_ids
      FROM draft_picks
      WHERE league_id = draft_record.league_id AND team_id = v_current_team_id;

      v_team_position_counts := '{}';
      IF v_team_pick_ids IS NOT NULL THEN
        SELECT jsonb_object_agg(primary_position, cnt)
        INTO v_team_position_counts
        FROM (
          SELECT primary_position, COUNT(*) AS cnt
          FROM players
          WHERE id = ANY(v_team_pick_ids)
          GROUP BY primary_position
        ) sub;
      END IF;

      v_picks_made := COALESCE(
        (
          SELECT SUM((value)::INT)
          FROM jsonb_each_text(COALESCE(v_team_position_counts, '{}'::jsonb))
        ),
        0
      )::INT;

      -- Early: BPA (quality-heavy). Later: need fills holes.
      v_need_weight := LEAST(0.55, 0.25 + v_picks_made * 0.05);
      v_quality_weight := 1.0 - v_need_weight;

      v_best_score := -1;
      v_best_candidate := NULL;

      FOR v_player_rec IN
        SELECT
          c.id, c.primary_position,
          PERCENT_RANK() OVER (ORDER BY c.market_value) AS value_pct,
          PERCENT_RANK() OVER (ORDER BY c.total_points) AS points_pct,
          PERCENT_RANK() OVER (ORDER BY c.ppg) AS ppg_pct
        FROM (
          SELECT p.id, p.primary_position, p.market_value,
                 COALESCE(p.total_points, 0) AS total_points,
                 COALESCE(p.ppg, 0) AS ppg
          FROM players p
          WHERE p.is_active = TRUE
            AND NOT EXISTS (
              SELECT 1 FROM draft_picks dp
              WHERE dp.league_id = draft_record.league_id AND dp.player_id = p.id
            )
            AND NOT EXISTS (
              SELECT 1 FROM roster_entries re
              JOIN teams rt ON rt.id = re.team_id
              WHERE rt.league_id = draft_record.league_id
                AND re.player_id = p.id
                AND re.status <> 'loan_out'
            )
          ORDER BY p.market_value DESC
          LIMIT 300
        ) c
      LOOP
        v_category := CASE
          WHEN v_player_rec.primary_position = 'GK' THEN 'GK'
          WHEN v_player_rec.primary_position IN ('CB', 'LB', 'RB', 'LWB', 'RWB') THEN 'DEF'
          WHEN v_player_rec.primary_position IN ('DM', 'CM', 'AM') THEN 'MID'
          ELSE 'FWD'
        END;

        v_need_score := CASE
          WHEN v_category = 'GK' AND COALESCE((v_team_position_counts->>'GK')::INT, 0) >= 2 THEN 0
          WHEN v_category = 'GK' AND COALESCE((v_team_position_counts->>'GK')::INT, 0) = 0 THEN
            LEAST(90, 25 + v_picks_made * 8)
          WHEN v_category = 'GK' THEN 20
          WHEN v_category = 'DEF' AND (
            COALESCE((v_team_position_counts->>'CB')::INT, 0) +
            COALESCE((v_team_position_counts->>'LB')::INT, 0) +
            COALESCE((v_team_position_counts->>'RB')::INT, 0) +
            COALESCE((v_team_position_counts->>'LWB')::INT, 0) +
            COALESCE((v_team_position_counts->>'RWB')::INT, 0)
          ) >= CEIL(draft_record.roster_size * 0.33) THEN 0
          WHEN v_category = 'MID' AND (
            COALESCE((v_team_position_counts->>'DM')::INT, 0) +
            COALESCE((v_team_position_counts->>'CM')::INT, 0) +
            COALESCE((v_team_position_counts->>'AM')::INT, 0)
          ) >= CEIL(draft_record.roster_size * 0.33) THEN 0
          WHEN v_category = 'FWD' AND (
            COALESCE((v_team_position_counts->>'LW')::INT, 0) +
            COALESCE((v_team_position_counts->>'RW')::INT, 0) +
            COALESCE((v_team_position_counts->>'ST')::INT, 0)
          ) >= CEIL(draft_record.roster_size * 0.27) THEN 0
          ELSE GREATEST(10, 80 - COALESCE((v_team_position_counts->>v_player_rec.primary_position::TEXT)::INT, 0) * 25)
        END;

        IF v_need_score = 0 THEN
          CONTINUE;
        END IF;

        v_quality_score := 0.55 * (COALESCE(v_player_rec.value_pct, 0) * 100)
          + 0.45 * (((COALESCE(v_player_rec.points_pct, 0) + COALESCE(v_player_rec.ppg_pct, 0)) / 2.0) * 100);

        IF (v_need_score * v_need_weight + v_quality_score * v_quality_weight) > v_best_score THEN
          v_best_score := v_need_score * v_need_weight + v_quality_score * v_quality_weight;
          v_best_candidate := v_player_rec.id;
        END IF;
      END LOOP;
    END IF;

    -- 3. Every position capped: take the best player left.
    IF v_best_candidate IS NULL THEN
      SELECT p.id INTO v_best_candidate
      FROM players p
      WHERE p.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM draft_picks dp
          WHERE dp.league_id = draft_record.league_id AND dp.player_id = p.id
        )
        AND NOT EXISTS (
          SELECT 1 FROM roster_entries re
          JOIN teams rt ON rt.id = re.team_id
          WHERE rt.league_id = draft_record.league_id
            AND re.player_id = p.id
            AND re.status <> 'loan_out'
        )
      ORDER BY p.market_value DESC
      LIMIT 1;
    END IF;

    IF v_best_candidate IS NULL THEN
      CONTINUE;
    END IF;

    -- 4. One writer. It revalidates the board under the lock we already hold
    --    and returns {success:false, ...} rather than raising, so a league
    --    that has moved on simply yields no pick and the loop continues.
    PERFORM public.make_draft_pick_rpc(draft_record.league_id, v_best_candidate, NULL, v_pick_number);
  END LOOP;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_pick_expired_drafts() FROM PUBLIC, anon, authenticated;


-- ============================================================
-- POST-APPLY CHECKS
-- ============================================================
--
--   -- Both functions exist with the expected signatures:
--   SELECT p.oid::regprocedure
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public'
--      AND p.proname IN ('make_draft_pick_rpc', 'auto_pick_expired_drafts');
--
--   -- The 048 constraint this code used to lean on — confirm it is actually
--   -- there. If this returns no rows, 048 never applied and duplicate
--   -- draft_picks rows are possible too, not just duplicate roster rows:
--   SELECT conname FROM pg_constraint
--    WHERE conrelid = 'public.draft_picks'::regclass AND conname = 'unique_league_player';
--
--   -- Nobody is on two rosters in the same league (should be zero, always):
--   SELECT t.league_id, re.player_id, COUNT(*)
--     FROM public.roster_entries re JOIN public.teams t ON t.id = re.team_id
--    WHERE re.status <> 'loan_out'
--    GROUP BY t.league_id, re.player_id HAVING COUNT(*) > 1;
