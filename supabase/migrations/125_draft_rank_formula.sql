-- Gaffa — Migration 125: unify the draft-rank formula
--
-- See docs/superpowers/specs/2026-08-19-draft-rank-design.md. Two changes to
-- auto_pick_expired_drafts (unchanged from 110 otherwise), mirroring the
-- refined formula now in src/lib/draft/autoPickEngine.ts's scoreDraftPool():
--
--   1. total_points/ppg now come from season_player_stats_archive for the
--      league's resolved prior-completed season, not the live players
--      columns. players.total_points/ppg track whatever FPL currently
--      considers the *live* season (see 064_multi_season_archives.sql) —
--      during preseason, or early in a season, that's sparse-to-empty, so
--      every quality_score in this function was being computed against
--      near-zero stats for the exact reason loadDraftPool.ts's own
--      resolveDraftStatsSeason() exists (its docstring: "never returns an
--      empty upcoming/live season for scouting") — a fix that TS side had
--      and this SQL side never did. Season resolution here is a simplified
--      version of resolveDraftStatsSeason (prefer leagues.previous_season,
--      else the latest season with archive rows) — it skips that function's
--      further FPL-API-dependent fallback chain, which needs an HTTP call
--      this cron-invoked function has no cheap way to make, and covers the
--      case that matters for an active draft (a league far enough along to
--      be mid-draft has a real previous_season set).
--
--   2. quality_score is no longer a flat 55% value / 45% stats split. Stats
--      weight now scales with games played last season (0 games — e.g. a
--      promoted-club signing with no PL history — means 0% stats weight,
--      100% value-driven; 10+ meaningful-minute games means the full 45%),
--      and a modest multiplier deranks currently injured/suspended/doubtful
--      players (not a severity grade — see the spec for why). Both
--      percentiles (value, stats) stay unpartitioned by position — checked
--      against real 2025-26 data and confirmed Gaffa's position-baseline
--      scoring already produces a fair cross-position ordering (Gabriel
--      Magalhães, a CB, ranks 11th overall by total_points), so no
--      partitioning was needed to "fix" a bias that doesn't exist here.

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
  v_stats_season TEXT;
  v_confidence NUMERIC;
  v_performance_weight NUMERIC;
  v_value_weight NUMERIC;
  v_stats_pct NUMERIC;
  v_base_score NUMERIC;
  v_status_mult NUMERIC;
BEGIN
  FOR draft_record IN
    SELECT l.id AS league_id, l.roster_size, l.previous_season
    FROM leagues l
    WHERE l.status = 'drafting'
      AND l.name NOT ILIKE '%demo%'
    ORDER BY l.id
  LOOP
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

    -- Pick #1 is never auto-picked — its clock hasn't started yet.
    IF v_current_pick_count = 0 THEN
      CONTINUE;
    END IF;

    SELECT MAX(picked_at) INTO v_latest_picked_at
    FROM draft_picks WHERE league_id = draft_record.league_id;

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

    -- Absent for two picks running: skip the 120-second wait entirely.
    IF NOT (v_consecutive_autopicks >= 2 AND v_is_in_room = FALSE) THEN
      IF NOW() - v_latest_picked_at < INTERVAL '120 seconds' THEN
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
    --    empty or exhausted.
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

      -- Simplified resolveDraftStatsSeason() (currentSeason.ts) — prefer the
      -- league's own previous_season, else the latest season with archive
      -- rows. See the migration header for why this skips the TS version's
      -- further FPL-API-dependent fallbacks.
      v_stats_season := draft_record.previous_season;
      IF v_stats_season IS NULL OR NOT EXISTS (
        SELECT 1 FROM season_player_stats_archive WHERE season = v_stats_season
      ) THEN
        SELECT season INTO v_stats_season
        FROM season_player_stats_archive
        GROUP BY season
        ORDER BY season DESC
        LIMIT 1;
      END IF;

      v_best_score := -1;
      v_best_candidate := NULL;

      FOR v_player_rec IN
        WITH gp_counts AS (
          SELECT ps.player_id, COUNT(*) AS gp
          FROM player_stats ps
          WHERE ps.season = v_stats_season
            AND COALESCE((ps.stats->>'minutes_played')::INT, 0) >= 15
          GROUP BY ps.player_id
        )
        SELECT
          c.id, c.primary_position, c.gp, c.fpl_status,
          PERCENT_RANK() OVER (ORDER BY c.market_value) AS value_pct,
          PERCENT_RANK() OVER (ORDER BY c.total_points) AS points_pct,
          PERCENT_RANK() OVER (ORDER BY c.ppg) AS ppg_pct
        FROM (
          SELECT p.id, p.primary_position, p.market_value, p.fpl_status,
                 COALESCE(a.total_points, 0) AS total_points,
                 COALESCE(a.ppg, 0) AS ppg,
                 COALESCE(gc.gp, 0) AS gp
          FROM players p
          LEFT JOIN season_player_stats_archive a
            ON a.player_id = p.id AND a.season = v_stats_season
          LEFT JOIN gp_counts gc ON gc.player_id = p.id
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

        -- Stats weight ramps with games played (GAMES_FLOOR = 10, matching
        -- autoPickEngine.ts) instead of a flat 45% for every player.
        v_confidence := LEAST(1, v_player_rec.gp::NUMERIC / 10);
        v_performance_weight := 0.45 * v_confidence;
        v_value_weight := 1 - v_performance_weight;
        v_stats_pct := (COALESCE(v_player_rec.points_pct, 0) + COALESCE(v_player_rec.ppg_pct, 0)) / 2.0;
        v_base_score := v_value_weight * (COALESCE(v_player_rec.value_pct, 0) * 100)
          + v_performance_weight * (v_stats_pct * 100);

        v_status_mult := CASE
          WHEN v_player_rec.fpl_status IN ('i', 's') THEN 0.85
          WHEN v_player_rec.fpl_status = 'd' THEN 0.95
          ELSE 1.0
        END;

        v_quality_score := v_base_score * v_status_mult;

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
