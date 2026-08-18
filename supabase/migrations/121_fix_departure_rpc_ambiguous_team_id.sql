-- 121: fix "column reference \"team_id\" is ambiguous" on departure release/retain.
--
-- Both resolve_departure_release_rpc and retain_departure_rpc declare
-- RETURNS TABLE(team_id uuid, player_id uuid, ...) — those output columns
-- become PL/pgSQL variables in scope for the whole function body. Each
-- function's own DELETE FROM roster_entries WHERE team_id = d.team_id AND
-- player_id = d.player_id then referenced the unqualified column names
-- team_id/player_id, which Postgres can no longer resolve unambiguously
-- between the table column and the same-named OUT variable — raising the
-- exact "column reference \"team_id\" is ambiguous" error surfaced trying to
-- release Cristian Romero. Fixed by qualifying the roster_entries columns
-- with an explicit alias.

CREATE OR REPLACE FUNCTION public.resolve_departure_release_rpc(p_decision_id UUID)
RETURNS TABLE(
  team_id UUID,
  team_name TEXT,
  league_id UUID,
  player_id UUID,
  player_name TEXT,
  previous_faab INTEGER,
  new_faab INTEGER,
  compensation NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  d              RECORD;
  v_team         RECORD;
  v_player_name  TEXT;
  v_compensation NUMERIC;
BEGIN
  SELECT * INTO d
  FROM public.departure_decisions
  WHERE id = p_decision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Departure decision not found: %', p_decision_id;
  END IF;

  -- Already resolved — no rows, no second payout.
  IF d.status <> 'pending' THEN
    RETURN;
  END IF;

  SELECT t.id, t.team_name AS name, t.faab_budget
  INTO v_team
  FROM public.teams t
  WHERE t.id = d.team_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Team not found for decision %', p_decision_id;
  END IF;

  SELECT name INTO v_player_name FROM public.players WHERE id = d.player_id;

  v_compensation := COALESCE(d.compensation_offered, 0);

  UPDATE public.teams
  SET faab_budget = faab_budget + v_compensation::INT,
      updated_at = NOW()
  WHERE id = d.team_id;

  DELETE FROM public.roster_entries re
  WHERE re.team_id = d.team_id AND re.player_id = d.player_id;

  INSERT INTO public.transactions (
    league_id, team_id, player_id, type, compensation_amount, notes, processed_at, created_at
  ) VALUES (
    d.league_id, d.team_id, d.player_id, 'transfer_compensation', v_compensation,
    COALESCE(v_player_name, 'Player') || ' released after leaving the Premier League. Compensation = €'
      || v_compensation || 'm.',
    NOW(), NOW()
  );

  UPDATE public.departure_decisions
  SET status = 'released',
      compensation_paid = v_compensation,
      decided_at = COALESCE(decided_at, NOW()),
      resolved_at = NOW(),
      updated_at = NOW()
  WHERE id = p_decision_id;

  team_id := d.team_id;
  team_name := v_team.name;
  league_id := d.league_id;
  player_id := d.player_id;
  player_name := v_player_name;
  previous_faab := v_team.faab_budget;
  new_faab := v_team.faab_budget + v_compensation::INT;
  compensation := v_compensation;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.retain_departure_rpc(p_decision_id UUID)
RETURNS TABLE(
  team_id UUID,
  player_id UUID,
  slots_used INTEGER,
  slots_total INTEGER
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  d           RECORD;
  v_slots     INT;
  v_used      INT;
BEGIN
  SELECT * INTO d
  FROM public.departure_decisions
  WHERE id = p_decision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Departure decision not found: %', p_decision_id;
  END IF;

  IF d.status <> 'pending' THEN
    RETURN;
  END IF;

  SELECT l.retained_slots INTO v_slots
  FROM public.leagues l
  WHERE l.id = d.league_id
  FOR UPDATE;

  SELECT COUNT(*) INTO v_used
  FROM public.departure_decisions dd
  WHERE dd.team_id = d.team_id
    AND dd.status IN ('retained', 'return_pending');

  IF v_used >= COALESCE(v_slots, 0) THEN
    RAISE EXCEPTION 'RETAINED_SLOTS_FULL: % of % retained slots already used', v_used, v_slots;
  END IF;

  -- The player leaves the active roster either way. Retaining keeps the claim,
  -- not the squad place — he is not in the competition and cannot be selected.
  DELETE FROM public.roster_entries re
  WHERE re.team_id = d.team_id AND re.player_id = d.player_id;

  UPDATE public.departure_decisions
  SET status = 'retained',
      compensation_paid = 0,
      decided_at = NOW(),
      updated_at = NOW()
  WHERE id = p_decision_id;

  team_id := d.team_id;
  player_id := d.player_id;
  slots_used := v_used + 1;
  slots_total := COALESCE(v_slots, 0);
  RETURN NEXT;
END;
$$;
