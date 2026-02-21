-- ============================================================
-- Fantasy Futbol — Server-Driven Auto-Pick via pg_cron
--
-- This migration creates a database function that:
-- 1. Identifies drafts where the timer has expired (90s since last pick)
-- 2. Determines which team is on the clock (snake draft order)
-- 3. Selects the best available player using positional AI
-- 4. Inserts the pick and roster entry
-- 5. Completes the draft if all picks are made
--
-- Requires: pg_cron extension (enabled in Supabase Dashboard > Database > Extensions)
-- ============================================================

-- Enable pg_cron if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage so pg_cron can call our function
GRANT USAGE ON SCHEMA cron TO postgres;

-- ============================================================
-- Helper: Snake draft order calculation
-- ============================================================
CREATE OR REPLACE FUNCTION snake_draft_order(pick_number INT, num_teams INT)
RETURNS INT
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  round_num INT;
  pos_in_round INT;
BEGIN
  round_num := (pick_number - 1) / num_teams;  -- 0-indexed round
  pos_in_round := (pick_number - 1) % num_teams;
  IF round_num % 2 = 0 THEN
    RETURN pos_in_round + 1;        -- odd rounds: 1→N
  ELSE
    RETURN num_teams - pos_in_round; -- even rounds: N→1
  END IF;
END;
$$;

-- ============================================================
-- Main auto-pick function
-- Called by pg_cron every 15 seconds
-- ============================================================
CREATE OR REPLACE FUNCTION auto_pick_expired_drafts()
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
BEGIN
  -- Find all leagues currently in 'drafting' status
  FOR draft_record IN
    SELECT l.id AS league_id, l.roster_size
    FROM leagues l
    WHERE l.status = 'drafting'
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

    -- Check if 90 seconds have elapsed since the last pick
    IF NOW() - v_latest_picked_at < INTERVAL '90 seconds' THEN
      CONTINUE;  -- Timer hasn't expired yet
    END IF;

    -- Timer expired! Execute auto-pick
    v_pick_number := v_current_pick_count + 1;
    v_draft_order_slot := snake_draft_order(v_pick_number, v_num_teams);
    v_round := CEIL(v_pick_number::NUMERIC / v_num_teams);

    -- Find the team on the clock
    SELECT id INTO v_current_team_id
    FROM teams
    WHERE league_id = draft_record.league_id AND draft_order = v_draft_order_slot;

    IF v_current_team_id IS NULL THEN
      CONTINUE;  -- Skip if we can't determine the team
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

-- ============================================================
-- Schedule the auto-pick cron job (every 15 seconds)
-- pg_cron minimum interval is 1 minute, so we use 3 offset jobs
-- to achieve ~20 second intervals
-- ============================================================

-- Run at :00 of every minute
SELECT cron.schedule(
  'auto-pick-draft-00',
  '* * * * *',
  'SELECT auto_pick_expired_drafts()'
);

-- Run at :20 of every minute (via pg_sleep offset)
SELECT cron.schedule(
  'auto-pick-draft-20',
  '* * * * *',
  'SELECT pg_sleep(20); SELECT auto_pick_expired_drafts()'
);

-- Run at :40 of every minute (via pg_sleep offset)
SELECT cron.schedule(
  'auto-pick-draft-40',
  '* * * * *',
  'SELECT pg_sleep(40); SELECT auto_pick_expired_drafts()'
);
