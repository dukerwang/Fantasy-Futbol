-- Gaffa — Migration 126: surface who's on the clock next from make_draft_pick_rpc
--
-- The route that records a human pick (POST /api/leagues/[leagueId]/draft/pick)
-- broadcasts the new pick over Supabase Realtime, but nothing tells the NEXT
-- drafter it's their turn unless they already have the Draft Room open. The
-- postmortem on the first live draft (2026-08-05) traced real autodraft
-- escalation to exactly this: a manager not watching the room misses their
-- window and the clock burns down to auto-pick.
--
-- make_draft_pick_rpc already derives v_num_teams, v_total_picks and
-- v_pick_number under the per-league advisory lock — computing one more
-- snake_draft_order() call for pick_number + 1 and returning who holds that
-- slot costs nothing extra and lets the route fire a "you're on the clock"
-- notification off the authoritative result instead of a second, racy query.
-- NULL when the draft just completed (no next pick). Same body as 108/117
-- otherwise — only the tail end (next-team lookup + return payload) changes.

CREATE OR REPLACE FUNCTION public.make_draft_pick_rpc(
  p_league_id UUID,
  p_player_id UUID,
  p_user_id   UUID DEFAULT NULL,
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

  v_next_pick_number INT;
  v_next_round        INT;
  v_next_slot          INT;
  v_next_team_id        UUID;
  v_next_team_user_id   UUID;
  v_next_team_name      TEXT;
BEGIN
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
  ELSE
    -- Who's on the clock for the pick that just opened up.
    v_next_pick_number := v_pick_number + 1;
    v_next_slot        := public.snake_draft_order(v_next_pick_number, v_num_teams);
    v_next_round        := CEIL(v_next_pick_number::NUMERIC / v_num_teams);

    SELECT id, user_id, team_name INTO v_next_team_id, v_next_team_user_id, v_next_team_name
    FROM public.teams
    WHERE league_id = p_league_id AND draft_order = v_next_slot;
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
    'is_complete', v_is_complete,
    'next_pick_number', v_next_pick_number,
    'next_round', v_next_round,
    'next_team_id', v_next_team_id,
    'next_team_user_id', v_next_team_user_id,
    'next_team_name', v_next_team_name
  );
END;
$$;

REVOKE EXECUTE ON FUNCTION public.make_draft_pick_rpc(uuid, uuid, uuid, int)
  FROM PUBLIC, anon, authenticated;
