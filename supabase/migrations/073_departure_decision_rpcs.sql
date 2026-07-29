-- Gaffa — Migration 073: transactional resolution of departure decisions
--
-- Each action moves money and mutates a roster, so each is a single locked
-- transaction rather than a sequence of client calls that can half-apply.
--
-- All three are idempotent by status check under FOR UPDATE: a decision that
-- has already been resolved returns zero rows instead of paying twice. This is
-- the per-event guard that `process_player_transfer_out_rpc` lacked — that one
-- keys idempotency on (league, team, player) with no notion of WHICH departure,
-- so a re-signed player leaving a second time silently paid his owner nothing.
-- Decisions replace that check entirely for the paths that go through here.

-- Requires migration 072 to have been COMMITTED first: reinstate_departure_rpc
-- writes the `retained_return` acquisition_type added there, and Postgres
-- refuses to use an enum value in the same transaction that adds it.

-- ── RELEASE ──────────────────────────────────────────────────────────────────
-- Take the compensation. Pays the snapshotted offer, not a freshly computed
-- figure: the manager decided against a number they were shown, and
-- players.market_value may have moved since.
CREATE OR REPLACE FUNCTION public.resolve_departure_release_rpc(
  p_decision_id UUID
)
RETURNS TABLE (
  team_id UUID,
  team_name TEXT,
  league_id UUID,
  player_id UUID,
  player_name TEXT,
  previous_faab INT,
  new_faab INT,
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

  DELETE FROM public.roster_entries
  WHERE team_id = d.team_id AND player_id = d.player_id;

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

-- ── RETAIN ───────────────────────────────────────────────────────────────────
-- Forfeit the compensation, keep the rights. The slot check lives inside the
-- lock because it is the only thing stopping a manager from retaining every
-- departure via concurrent requests.
CREATE OR REPLACE FUNCTION public.retain_departure_rpc(
  p_decision_id UUID
)
RETURNS TABLE (
  team_id UUID,
  player_id UUID,
  slots_used INT,
  slots_total INT
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
  DELETE FROM public.roster_entries
  WHERE team_id = d.team_id AND player_id = d.player_id;

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

-- ── REINSTATE ────────────────────────────────────────────────────────────────
-- A retained player is back in the Premier League and his rights holder is
-- claiming him. Requires an open roster spot: freeing one is the manager's job
-- during the return window, via the ordinary drop flow which charges its own
-- severance. Embedding a drop here would let a reinstatement quietly bypass it.
CREATE OR REPLACE FUNCTION public.reinstate_departure_rpc(
  p_decision_id UUID
)
RETURNS TABLE (
  team_id UUID,
  player_id UUID,
  roster_count INT,
  roster_size INT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  d            RECORD;
  v_size       INT;
  v_count      INT;
BEGIN
  SELECT * INTO d
  FROM public.departure_decisions
  WHERE id = p_decision_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Departure decision not found: %', p_decision_id;
  END IF;

  IF d.status <> 'return_pending' THEN
    RETURN;
  END IF;

  SELECT COALESCE(l.roster_size, 20) INTO v_size
  FROM public.leagues l
  WHERE l.id = d.league_id;

  -- Mirrors the exclusion list used by the auction, IR and taxi paths: players
  -- parked outside the active squad do not consume a roster place.
  SELECT COUNT(*) INTO v_count
  FROM public.roster_entries re
  WHERE re.team_id = d.team_id
    AND re.status NOT IN ('ir', 'taxi', 'loan_in');

  IF v_count >= v_size THEN
    RAISE EXCEPTION 'ROSTER_FULL: % of % roster places used', v_count, v_size;
  END IF;

  INSERT INTO public.roster_entries (team_id, player_id, status, acquisition_type, acquisition_value, acquired_at)
  VALUES (d.team_id, d.player_id, 'bench', 'retained_return', 0, NOW())
  ON CONFLICT (player_id, team_id) DO NOTHING;

  UPDATE public.departure_decisions
  SET status = 'returned',
      resolved_at = NOW(),
      updated_at = NOW()
  WHERE id = p_decision_id;

  team_id := d.team_id;
  player_id := d.player_id;
  roster_count := v_count + 1;
  roster_size := v_size;
  RETURN NEXT;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_departure_release_rpc(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.retain_departure_rpc(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.reinstate_departure_rpc(uuid) FROM PUBLIC, anon, authenticated;
