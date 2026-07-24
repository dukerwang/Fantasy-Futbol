-- Gaffa — Migration 066: let transfer-out compensation run during the offseason
--
-- `process_player_transfer_out_rpc` only paid out to teams whose league was
-- `status = 'active'`. Season Kickoff calls it while the league is still
-- `offseason` (it only flips to active at the very end), so the loop matched
-- zero rows: no FAAB credited, no roster entries removed, no transactions
-- written — relegation compensation was a silent no-op every single time.
--
-- Widening to ('active', 'offseason') is the whole fix. Leagues in 'setup' or
-- 'drafting' are still excluded: they have no meaningful roster economy yet.

CREATE OR REPLACE FUNCTION public.process_player_transfer_out_rpc(
  p_player_id UUID,
  p_compensation_rate NUMERIC
)
RETURNS TABLE (
  team_id UUID,
  team_name TEXT,
  league_id UUID,
  previous_faab INT,
  new_faab INT,
  compensation NUMERIC
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_market_value NUMERIC;
  v_compensation NUMERIC;
  v_player_name TEXT;
  r RECORD;
BEGIN
  -- 1. Fetch player details and lock row for update
  SELECT name, market_value
  INTO v_player_name, v_market_value
  FROM public.players
  WHERE id = p_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Player not found: %', p_player_id;
  END IF;

  -- Calculate compensation
  IF v_market_value IS NULL OR v_market_value <= 0 THEN
    v_compensation := 0;
  ELSE
    v_compensation := ROUND(v_market_value * p_compensation_rate, 2);
  END IF;

  -- 2. Mark player as inactive
  UPDATE public.players
  SET is_active = FALSE,
      updated_at = NOW()
  WHERE id = p_player_id;

  -- 3. Loop over roster entries for active/offseason leagues and lock affected teams
  FOR r IN
    SELECT re.id AS entry_id, t.id AS t_id, t.team_name AS t_name, t.faab_budget AS t_faab, t.league_id AS l_id
    FROM public.roster_entries re
    JOIN public.teams t ON t.id = re.team_id
    JOIN public.leagues l ON l.id = t.league_id
    WHERE re.player_id = p_player_id
      AND l.status IN ('active', 'offseason')
    FOR UPDATE OF t
  LOOP
    -- Idempotency check: verify if transfer_compensation transaction already recorded for this player and team
    IF EXISTS (
      SELECT 1 FROM public.transactions tx
      WHERE tx.league_id = r.l_id
        AND tx.team_id = r.t_id
        AND tx.player_id = p_player_id
        AND tx.type = 'transfer_compensation'
    ) THEN
      -- Already processed for this team, just delete the roster entry if it still exists
      DELETE FROM public.roster_entries WHERE id = r.entry_id;
      CONTINUE;
    END IF;

    -- Credit FAAB budget
    UPDATE public.teams
    SET faab_budget = faab_budget + COALESCE(v_compensation, 0)::INT,
        updated_at = NOW()
    WHERE id = r.t_id;

    -- Delete roster entry
    DELETE FROM public.roster_entries WHERE id = r.entry_id;

    -- Record transaction
    INSERT INTO public.transactions (
      league_id,
      team_id,
      player_id,
      type,
      compensation_amount,
      notes,
      processed_at,
      created_at
    ) VALUES (
      r.l_id,
      r.t_id,
      p_player_id,
      'transfer_compensation',
      v_compensation,
      v_player_name || ' transferred out of PL. Compensation = €' || v_compensation || 'm (' || (p_compensation_rate * 100)::INT || '% of €' || v_market_value || 'm market value).',
      NOW(),
      NOW()
    );

    -- Return row
    team_id := r.t_id;
    team_name := r.t_name;
    league_id := r.l_id;
    previous_faab := r.t_faab;
    new_faab := r.t_faab + COALESCE(v_compensation, 0)::INT;
    compensation := v_compensation;
    RETURN NEXT;
  END LOOP;

  RETURN;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.process_player_transfer_out_rpc(uuid, numeric) FROM PUBLIC, anon, authenticated;
