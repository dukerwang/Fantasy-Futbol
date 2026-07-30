-- Migration 089: Auto-pick considers season stats (total_points/ppg) alongside
-- market value, fixes LWB/RWB miscategorized as FWD, and stops empty-roster
-- GK need from forcing keepers first overall (the Donnarumma-at-#1 bug).
--
-- Quality half of the composite (ramped against need — see below):
--   55% market_value percentile + 45% (total_points + ppg) / 2 percentiles
-- Need weight ramps with how many players the team already has:
--   0 picks → need 0.25 / quality 0.75 (BPA)
--   6+ picks → need 0.55 / quality 0.45
-- GK with 0 on roster: need = min(90, 25 + picks_made * 8) instead of a flat 90.

CREATE OR REPLACE FUNCTION public.auto_pick_expired_drafts()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER  -- Runs with table owner privileges, bypassing RLS
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
  -- Autopilot variables
  v_is_in_room BOOLEAN;
  v_consecutive_autopicks INT;
  v_last_seen_at TIMESTAMPTZ;
BEGIN
  -- Find all leagues currently in 'drafting' status (excluding Demo leagues)
  FOR draft_record IN
    SELECT l.id AS league_id, l.roster_size
    FROM leagues l
    WHERE l.status = 'drafting'
      AND l.name NOT ILIKE '%demo%'
  LOOP
    -- Count teams in this league
    SELECT COUNT(*) INTO v_num_teams
    FROM teams WHERE league_id = draft_record.league_id;

    IF v_num_teams = 0 THEN
      CONTINUE;
    END IF;

    v_total_picks := v_num_teams * draft_record.roster_size;

    -- Count existing picks
    SELECT COUNT(*) INTO v_current_pick_count
    FROM draft_picks WHERE league_id = draft_record.league_id;

    IF v_current_pick_count >= v_total_picks THEN
      -- Draft should be complete, update status
      UPDATE leagues SET status = 'active' WHERE id = draft_record.league_id;
      CONTINUE;
    END IF;

    -- Find the latest pick timestamp (or league updated_at if no picks)
    SELECT COALESCE(
      (SELECT MAX(picked_at) FROM draft_picks WHERE league_id = draft_record.league_id),
      (SELECT updated_at FROM leagues WHERE id = draft_record.league_id)
    ) INTO v_latest_picked_at;

    -- Timer details
    v_pick_number := v_current_pick_count + 1;
    v_draft_order_slot := snake_draft_order(v_pick_number, v_num_teams);
    v_round := CEIL(v_pick_number::NUMERIC / v_num_teams);

    -- Find the team on the clock and check their presence / autopilot status
    SELECT id, last_seen_at, consecutive_autopicks
    INTO v_current_team_id, v_last_seen_at, v_consecutive_autopicks
    FROM teams
    WHERE league_id = draft_record.league_id AND draft_order = v_draft_order_slot;

    IF v_current_team_id IS NULL THEN
      CONTINUE;  -- Skip if we can't determine the team
    END IF;

    -- Evaluate presence based on heartbeat
    v_is_in_room := (v_last_seen_at IS NOT NULL AND v_last_seen_at >= NOW() - INTERVAL '25 seconds');

    -- If the team is NOT in the draft room AND has missed 2+ picks in a row, they are on autopilot.
    -- Bypasses the 90 seconds wait to make the pick instantly.
    -- Otherwise, enforce the standard 90 seconds timeout.
    IF NOT (v_consecutive_autopicks >= 2 AND v_is_in_room = FALSE) THEN
      IF NOW() - v_latest_picked_at < INTERVAL '90 seconds' THEN
        CONTINUE;  -- Timer hasn't expired yet
      END IF;
    END IF;

    -- 1. Try to pick from team's draft queue
    SELECT dq.player_id INTO v_best_candidate
    FROM public.draft_queues dq
    JOIN public.teams t ON t.user_id = dq.user_id AND t.league_id = dq.league_id
    WHERE t.id = v_current_team_id
      AND NOT EXISTS (
        SELECT 1 FROM draft_picks dp
        WHERE dp.league_id = draft_record.league_id AND dp.player_id = dq.player_id
      )
    ORDER BY dq.rank ASC
    LIMIT 1;

    -- 2. Fall back to positional need + market value/stats composite score if queue is empty or exhausted
    IF v_best_candidate IS NULL THEN
      -- Get player IDs already drafted by this team for positional analysis
      SELECT ARRAY_AGG(player_id) INTO v_team_pick_ids
      FROM draft_picks
      WHERE league_id = draft_record.league_id AND team_id = v_current_team_id;

      -- Build position counts for the team
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

      -- Find best available player with positional intelligence, scoring
      -- value/stats as percentile ranks within the candidate pool so
      -- market_value (0-150ish), total_points (0-250ish) and ppg (0-8ish)
      -- combine on a comparable 0-100 scale.
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
          ORDER BY p.market_value DESC
          LIMIT 300
        ) c
      LOOP
        -- Determine positional category (LWB/RWB count as DEF)
        v_category := CASE
          WHEN v_player_rec.primary_position = 'GK' THEN 'GK'
          WHEN v_player_rec.primary_position IN ('CB', 'LB', 'RB', 'LWB', 'RWB') THEN 'DEF'
          WHEN v_player_rec.primary_position IN ('DM', 'CM', 'AM') THEN 'MID'
          ELSE 'FWD'
        END;

        -- Calculate positional need score
        v_need_score := CASE
          -- GK: max 2; empty-roster need escalates with picks_made (not a flat 90)
          WHEN v_category = 'GK' AND COALESCE((v_team_position_counts->>'GK')::INT, 0) >= 2 THEN 0
          WHEN v_category = 'GK' AND COALESCE((v_team_position_counts->>'GK')::INT, 0) = 0 THEN
            LEAST(90, 25 + v_picks_made * 8)
          WHEN v_category = 'GK' THEN 20
          -- DEF: cap at ~33% of roster
          WHEN v_category = 'DEF' AND (
            COALESCE((v_team_position_counts->>'CB')::INT, 0) +
            COALESCE((v_team_position_counts->>'LB')::INT, 0) +
            COALESCE((v_team_position_counts->>'RB')::INT, 0) +
            COALESCE((v_team_position_counts->>'LWB')::INT, 0) +
            COALESCE((v_team_position_counts->>'RWB')::INT, 0)
          ) >= CEIL(draft_record.roster_size * 0.33) THEN 0
          -- MID: cap at ~33% of roster
          WHEN v_category = 'MID' AND (
            COALESCE((v_team_position_counts->>'DM')::INT, 0) +
            COALESCE((v_team_position_counts->>'CM')::INT, 0) +
            COALESCE((v_team_position_counts->>'AM')::INT, 0)
          ) >= CEIL(draft_record.roster_size * 0.33) THEN 0
          -- FWD: cap at ~27% of roster
          WHEN v_category = 'FWD' AND (
            COALESCE((v_team_position_counts->>'LW')::INT, 0) +
            COALESCE((v_team_position_counts->>'RW')::INT, 0) +
            COALESCE((v_team_position_counts->>'ST')::INT, 0)
          ) >= CEIL(draft_record.roster_size * 0.27) THEN 0
          -- Default need based on how few of this position we have
          ELSE GREATEST(10, 80 - COALESCE((v_team_position_counts->>v_player_rec.primary_position::TEXT)::INT, 0) * 25)
        END;

        -- Skip if hard-capped (need score 0)
        IF v_need_score = 0 THEN
          CONTINUE;
        END IF;

        -- Quality: 55% market value percentile + 45% stats percentile
        v_quality_score := 0.55 * (COALESCE(v_player_rec.value_pct, 0) * 100)
          + 0.45 * (((COALESCE(v_player_rec.points_pct, 0) + COALESCE(v_player_rec.ppg_pct, 0)) / 2.0) * 100);

        -- Composite: need * need_weight + quality * quality_weight
        IF (v_need_score * v_need_weight + v_quality_score * v_quality_weight) > v_best_score THEN
          v_best_score := v_need_score * v_need_weight + v_quality_score * v_quality_weight;
          v_best_candidate := v_player_rec.id;
        END IF;
      END LOOP;
    END IF;

    -- Fallback: if all positions are capped, just pick highest value
    IF v_best_candidate IS NULL THEN
      SELECT p.id INTO v_best_candidate
      FROM players p
      WHERE p.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM draft_picks dp
          WHERE dp.league_id = draft_record.league_id AND dp.player_id = p.id
        )
      ORDER BY p.market_value DESC
      LIMIT 1;
    END IF;

    IF v_best_candidate IS NULL THEN
      CONTINUE;  -- No players available at all
    END IF;

    -- Insert the auto-pick (unique constraint handles race conditions)
    BEGIN
      INSERT INTO draft_picks (league_id, team_id, player_id, round, pick)
      VALUES (draft_record.league_id, v_current_team_id, v_best_candidate, v_round, v_pick_number);

      INSERT INTO roster_entries (team_id, player_id, status, acquisition_type)
      VALUES (v_current_team_id, v_best_candidate, 'bench', 'draft');

      -- Increment consecutive autopicks for this team
      UPDATE teams
      SET consecutive_autopicks = consecutive_autopicks + 1
      WHERE id = v_current_team_id;

      -- Check if draft is now complete
      IF v_pick_number >= v_total_picks THEN
        UPDATE leagues SET status = 'active' WHERE id = draft_record.league_id;
      END IF;
    EXCEPTION
      WHEN unique_violation THEN
        -- Another process already made this pick, skip
        NULL;
    END;
  END LOOP;
END;
$$;

-- This SECURITY DEFINER function's EXECUTE grant was revoked from PUBLIC/anon/authenticated
-- in migration 050; CREATE OR REPLACE preserves existing grants, but re-assert
-- the lockdown explicitly in case this is ever run standalone.
REVOKE EXECUTE ON FUNCTION public.auto_pick_expired_drafts() FROM PUBLIC, anon, authenticated;
