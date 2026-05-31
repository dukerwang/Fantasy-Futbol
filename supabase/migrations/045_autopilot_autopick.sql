-- Migration 045: Add autopilot (instant auto-pick) mode for inactive managers
-- If a user misses 2 picks in a row and is NOT in the draft room, they are put on autopilot.
-- Autopilot immediately auto-picks for them when their turn arrives, rather than waiting the 90 seconds timeout.

-- 1. Add autopilot tracking columns to teams table (if not already added)
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS is_in_draft_room BOOLEAN DEFAULT FALSE NOT NULL;
ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS consecutive_autopicks INTEGER DEFAULT 0 NOT NULL;

-- 2. Update auto-pick database engine to support instant auto-picks
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
  v_best_player_id UUID;
  v_round INT;
  v_team_position_counts JSONB;
  v_category TEXT;
  v_need_score NUMERIC;
  v_best_score NUMERIC;
  v_best_candidate UUID;
  v_player_rec RECORD;
  v_team_pick_ids UUID[];
  -- Autopilot variables
  v_is_in_room BOOLEAN;
  v_consecutive_autopicks INT;
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
    SELECT id, is_in_draft_room, consecutive_autopicks 
    INTO v_current_team_id, v_is_in_room, v_consecutive_autopicks
    FROM teams
    WHERE league_id = draft_record.league_id AND draft_order = v_draft_order_slot;

    IF v_current_team_id IS NULL THEN
      CONTINUE;  -- Skip if we can't determine the team
    END IF;

    -- If the team is NOT in the draft room AND has missed 2+ picks in a row, they are on autopilot.
    -- Bypasses the 90 seconds wait to make the pick instantly.
    -- Otherwise, enforce the standard 90 seconds timeout.
    IF NOT (v_consecutive_autopicks >= 2 AND v_is_in_room = FALSE) THEN
      IF NOW() - v_latest_picked_at < INTERVAL '90 seconds' THEN
        CONTINUE;  -- Timer hasn't expired yet
      END IF;
    END IF;

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

    -- Find best available player with positional intelligence
    v_best_score := -1;
    v_best_candidate := NULL;

    FOR v_player_rec IN
      SELECT p.id, p.primary_position, p.market_value
      FROM players p
      WHERE p.is_active = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM draft_picks dp
          WHERE dp.league_id = draft_record.league_id AND dp.player_id = p.id
        )
      ORDER BY p.market_value DESC
      LIMIT 300
    LOOP
      -- Determine positional category
      v_category := CASE
        WHEN v_player_rec.primary_position = 'GK' THEN 'GK'
        WHEN v_player_rec.primary_position IN ('CB', 'LB', 'RB') THEN 'DEF'
        WHEN v_player_rec.primary_position IN ('DM', 'CM', 'AM') THEN 'MID'
        ELSE 'FWD'
      END;

      -- Calculate positional need score
      v_need_score := CASE
        -- GK: max 2 on roster
        WHEN v_category = 'GK' AND COALESCE((v_team_position_counts->>'GK')::INT, 0) >= 2 THEN 0
        WHEN v_category = 'GK' AND COALESCE((v_team_position_counts->>'GK')::INT, 0) = 0 THEN 90
        WHEN v_category = 'GK' THEN 20
        -- DEF: cap at ~33% of roster
        WHEN v_category = 'DEF' AND (
          COALESCE((v_team_position_counts->>'CB')::INT, 0) +
          COALESCE((v_team_position_counts->>'LB')::INT, 0) +
          COALESCE((v_team_position_counts->>'RB')::INT, 0)
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

      -- Composite: need * 0.6 + value * 0.4 (value based on market_value directly)
      IF (v_need_score * 0.6 + v_player_rec.market_value * 0.4) > v_best_score THEN
        v_best_score := v_need_score * 0.6 + v_player_rec.market_value * 0.4;
        v_best_candidate := v_player_rec.id;
      END IF;
    END LOOP;

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
