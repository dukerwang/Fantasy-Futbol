-- Gaffa — Migration 071: price transfer-out compensation per league
--
-- `process_player_transfer_out_rpc` took a single `p_compensation_rate` and
-- applied it to every league that rosters the player. Now that the rate is
-- league config (migration 069) that is wrong twice over:
--
--   1. The RPC loops over every league rostering the departed player. One rate
--      for all of them means league B is paid at league A's rate, decided by
--      whichever league happened to trigger the call.
--   2. The manual transfer-out path (executeDrop) reads the league's configured
--      rate, while the relegation sweep passes the TypeScript constant. Set a
--      league to anything other than the default and the same real-world event
--      pays two different amounts again — the exact bug 069 set out to kill.
--
-- The rate is now resolved inside the loop, per league. `p_compensation_rate`
-- is kept as the signature (callers are unchanged) but demoted to a fallback
-- for leagues whose column is somehow NULL.
--
-- Compensation is computed per league, so the returned `compensation` column is
-- now per-row rather than a single figure for the whole call. Callers that
-- reported one number for every affected team should read it off each row.

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
  v_rate NUMERIC;
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

  -- 2. Mark player as inactive
  UPDATE public.players
  SET is_active = FALSE,
      updated_at = NOW()
  WHERE id = p_player_id;

  -- 3. Loop over roster entries for active/offseason leagues and lock affected teams
  FOR r IN
    SELECT re.id AS entry_id,
           t.id AS t_id,
           t.team_name AS t_name,
           t.faab_budget AS t_faab,
           t.league_id AS l_id,
           l.departure_compensation_rate AS l_rate
    FROM public.roster_entries re
    JOIN public.teams t ON t.id = re.team_id
    JOIN public.leagues l ON l.id = t.league_id
    WHERE re.player_id = p_player_id
      AND l.status IN ('active', 'offseason')
    FOR UPDATE OF t
  LOOP
    -- Each league pays at its own configured rate.
    v_rate := COALESCE(r.l_rate, p_compensation_rate);

    IF v_market_value IS NULL OR v_market_value <= 0 THEN
      v_compensation := 0;
    ELSE
      v_compensation := ROUND(v_market_value * v_rate, 2);
    END IF;

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
      v_player_name || ' transferred out of PL. Compensation = €' || v_compensation || 'm (' || (v_rate * 100)::INT || '% of €' || v_market_value || 'm market value).',
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
