-- ============================================================
-- Migration 062: Raise severance rate to 20% with €2m minimum
-- ============================================================
-- Updates resolve_single_player_auction_rpc to charge 20% of
-- the dropped player's market value (min €2m) instead of 10%.

CREATE OR REPLACE FUNCTION public.resolve_single_player_auction_rpc(
  p_league_id UUID,
  p_player_id UUID,
  p_locked_pl_team_ids INT[]
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_roster_size INT;
  v_academy_size INT;
  v_academy_age_limit INT;
  v_player_name TEXT;
  v_player_dob DATE;
  v_player_market_value NUMERIC;
  v_player_pl_team_id INT;
  v_is_big_transfer BOOLEAN;
  v_winner_claim RECORD;
  v_winner_team_id UUID := NULL;
  v_winner_team_name TEXT := '';
  v_winner_user_id UUID := NULL;
  v_winner_bid INT := 0;
  v_winner_severance INT := 0;
  v_winner_status TEXT := 'bench';
  v_drop_player_name TEXT := '';
  v_initiator_team_id UUID := NULL;
  v_initiator_team_name TEXT := '';
  v_initiator_user_id UUID := NULL;
  v_rebate_amount INT := 0;
  v_rebate_team_id UUID := NULL;
  v_losing_teams JSONB := '[]'::JSONB;
  r RECORD;
  v_temp_rec RECORD;
  v_severance_fee INT;
  v_active_count INT;
  v_academy_count INT;
  v_age INT;
  v_total_cost INT;
  v_drop_player_mv NUMERIC;
  v_drop_player_name_raw TEXT;
  v_drop_player_pl_team_id INT;
  v_drop_player_status TEXT;
  v_auction_expiry TIMESTAMPTZ;
  v_result JSONB;
BEGIN
  -- 1. Fetch and lock league settings
  SELECT roster_size, taxi_size, taxi_age_limit
  INTO v_roster_size, v_academy_size, v_academy_age_limit
  FROM public.leagues
  WHERE id = p_league_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'League not found');
  END IF;

  v_roster_size := COALESCE(v_roster_size, 20);
  v_academy_size := COALESCE(v_academy_size, 3);
  v_academy_age_limit := COALESCE(v_academy_age_limit, 21);

  -- 2. Fetch and lock player details
  SELECT name, date_of_birth, market_value, pl_team_id
  INTO v_player_name, v_player_dob, v_player_market_value, v_player_pl_team_id
  FROM public.players
  WHERE id = p_player_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Player not found');
  END IF;

  -- Defer entire auction if player's match kicked off
  IF v_player_pl_team_id = ANY(p_locked_pl_team_ids) THEN
    RETURN jsonb_build_object('success', true, 'won', false, 'deferred', true);
  END IF;

  v_is_big_transfer := COALESCE(v_player_market_value, 0) >= 40.0;

  -- 3. Lock all pending claims for this player in this league
  -- Ordered by faab_bid DESC to process highest bidder first
  FOR r IN
    SELECT wc.id, wc.team_id, wc.drop_player_id, wc.faab_bid, wc.created_at, wc.status
    FROM public.waiver_claims wc
    WHERE wc.league_id = p_league_id
      AND wc.player_id = p_player_id
      AND wc.status = 'pending'
      AND wc.is_auction = TRUE
      AND wc.team_id IS NOT NULL
    ORDER BY wc.faab_bid DESC
  LOOP
    -- Lock team row
    SELECT t.faab_budget, t.team_name, t.user_id
    INTO v_temp_rec
    FROM public.teams t
    WHERE t.id = r.team_id
    FOR UPDATE;

    IF FOUND THEN
      v_severance_fee := 0;
      v_drop_player_name_raw := '';

      -- Calculate severance if drop player is nominated
      -- 20% of market value, minimum €2m floor
      IF r.drop_player_id IS NOT NULL THEN
        SELECT p.name, p.market_value, p.pl_team_id, re.status
        INTO v_drop_player_name_raw, v_drop_player_mv, v_drop_player_pl_team_id, v_drop_player_status
        FROM public.players p
        LEFT JOIN public.roster_entries re ON re.player_id = p.id AND re.team_id = r.team_id
        WHERE p.id = r.drop_player_id;

        IF FOUND THEN
          v_severance_fee := GREATEST(2, FLOOR(COALESCE(v_drop_player_mv, 0) * 0.2));

          -- Defer entire auction if drop player of candidate is locked
          IF (v_drop_player_status = 'active' OR v_drop_player_status = 'bench')
             AND v_drop_player_pl_team_id = ANY(p_locked_pl_team_ids) THEN
            RETURN jsonb_build_object('success', true, 'won', false, 'deferred', true);
          END IF;
        END IF;
      END IF;

      v_total_cost := r.faab_bid + v_severance_fee;

      -- Check FAAB
      IF v_temp_rec.faab_budget >= v_total_cost THEN
        -- Check roster capacity
        v_winner_status := 'bench';

        SELECT COUNT(1)
        INTO v_active_count
        FROM public.roster_entries
        WHERE team_id = r.team_id
          AND status NOT IN ('ir', 'taxi');

        IF r.drop_player_id IS NOT NULL THEN
          -- Drop player nominated: check if they are still on the roster
          PERFORM 1
          FROM public.roster_entries
          WHERE team_id = r.team_id
            AND player_id = r.drop_player_id;

          IF FOUND THEN
            -- Valid drop path
            v_winner_team_id := r.team_id;
            v_winner_claim := r;
            v_winner_severance := v_severance_fee;
            v_drop_player_name := v_drop_player_name_raw;
            v_winner_bid := r.faab_bid;
            v_winner_team_name := v_temp_rec.team_name;
            v_winner_user_id := v_temp_rec.user_id;
            EXIT;
          ELSE
            -- Nominated drop player is gone! Check if active roster has space anyway
            IF v_active_count < v_roster_size THEN
              v_winner_team_id := r.team_id;
              v_winner_claim := r;
              v_winner_severance := 0; -- waive severance since drop player is already gone
              v_drop_player_name := '';
              v_winner_bid := r.faab_bid;
              v_winner_team_name := v_temp_rec.team_name;
              v_winner_user_id := v_temp_rec.user_id;
              EXIT;
            END IF;
          END IF;
        ELSE
          -- No drop player nominated
          IF v_active_count < v_roster_size THEN
            v_winner_team_id := r.team_id;
            v_winner_claim := r;
            v_winner_severance := 0;
            v_drop_player_name := '';
            v_winner_bid := r.faab_bid;
            v_winner_team_name := v_temp_rec.team_name;
            v_winner_user_id := v_temp_rec.user_id;
            v_winner_status := 'bench';
            EXIT;
          ELSE
            -- Active roster full: try to route to academy
            SELECT COUNT(1)
            INTO v_academy_count
            FROM public.roster_entries
            WHERE team_id = r.team_id
              AND status = 'taxi';

            IF v_academy_count < v_academy_size AND v_player_dob IS NOT NULL THEN
              v_age := DATE_PART('year', AGE(v_player_dob));
              IF v_age <= v_academy_age_limit THEN
                v_winner_team_id := r.team_id;
                v_winner_claim := r;
                v_winner_severance := 0;
                v_drop_player_name := '';
                v_winner_bid := r.faab_bid;
                v_winner_team_name := v_temp_rec.team_name;
                v_winner_user_id := v_temp_rec.user_id;
                v_winner_status := 'taxi';
                EXIT;
              END IF;
            END IF;
          END IF;
        END IF;
      END IF;
    END IF;
  END LOOP;

  -- 4. Execute changes based on winner
  IF v_winner_team_id IS NOT NULL THEN
    -- A winner was found!

    -- Idempotency check: verify if winner's claim is already approved
    IF EXISTS (
      SELECT 1 FROM public.waiver_claims
      WHERE id = v_winner_claim.id AND status = 'approved'
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Claim already approved');
    END IF;

    -- Drop player if they are still on roster
    IF v_winner_claim.drop_player_id IS NOT NULL AND v_drop_player_name <> '' THEN
      DELETE FROM public.roster_entries
      WHERE league_id = p_league_id
        AND team_id = v_winner_team_id
        AND player_id = v_winner_claim.drop_player_id;

      -- Seed summer/waiver auction for the dropped player
      IF v_is_big_transfer THEN
        v_auction_expiry := NOW() + INTERVAL '96 hours';
      ELSE
        v_auction_expiry := NOW() + INTERVAL '48 hours';
      END IF;

      INSERT INTO public.waiver_claims (
        league_id, team_id, player_id, faab_bid, priority, status, gameweek, is_auction, expires_at
      ) VALUES (
        p_league_id, NULL, v_winner_claim.drop_player_id, 0, 999, 'pending', 0, TRUE, v_auction_expiry
      );

      -- Log drop transaction
      INSERT INTO public.transactions (
        league_id, team_id, player_id, type, compensation_amount, notes, processed_at, created_at
      ) VALUES (
        p_league_id,
        v_winner_team_id,
        v_winner_claim.drop_player_id,
        'drop',
        v_winner_severance,
        'Dropped ' || v_drop_player_name || ' to make room for auction winner: ' || v_player_name || CASE WHEN v_winner_severance > 0 THEN ' (€' || v_winner_severance || 'm severance paid)' ELSE '' END,
        NOW(),
        NOW()
      );
    END IF;

    -- Add won player to roster
    INSERT INTO public.roster_entries (
      team_id, player_id, status, acquisition_type, acquisition_value, acquired_at
    ) VALUES (
      v_winner_team_id,
      p_player_id,
      v_winner_status,
      'waiver',
      v_winner_bid,
      NOW()
    )
    ON CONFLICT (player_id, team_id) DO UPDATE
    SET status = v_winner_status,
        acquisition_type = 'waiver',
        acquisition_value = v_winner_bid,
        acquired_at = NOW();

    -- Deduct total cost (bid + severance)
    UPDATE public.teams
    SET faab_budget = faab_budget - (v_winner_bid + v_winner_severance),
        updated_at = NOW()
    WHERE id = v_winner_team_id;

    -- Log winning transaction
    INSERT INTO public.transactions (
      league_id, team_id, player_id, type, faab_bid, compensation_amount, notes, processed_at, created_at
    ) VALUES (
      p_league_id,
      v_winner_team_id,
      p_player_id,
      'waiver_claim',
      v_winner_bid,
      v_winner_severance,
      'Won auction for ' || v_player_name || ' with €' || v_winner_bid || 'm bid' || CASE WHEN v_winner_severance > 0 THEN ' (+ €' || v_winner_severance || 'm drop severance)' ELSE '' END || CASE WHEN v_winner_status = 'taxi' THEN ' -> academy' ELSE '' END,
      NOW(),
      NOW()
    );

    -- 5. Calculate and award Scout's Rebate (Finder's Fee)
    SELECT wc.team_id, t.team_name, t.user_id
    INTO v_initiator_team_id, v_initiator_team_name, v_initiator_user_id
    FROM public.waiver_claims wc
    JOIN public.teams t ON t.id = wc.team_id
    WHERE wc.league_id = p_league_id
      AND wc.player_id = p_player_id
      AND wc.is_auction = TRUE
      AND wc.team_id IS NOT NULL
    ORDER BY wc.created_at ASC
    LIMIT 1;

    IF FOUND AND v_initiator_team_id IS NOT NULL AND v_initiator_team_id <> v_winner_team_id AND v_winner_bid > 0 THEN
      v_rebate_amount := LEAST(FLOOR(v_winner_bid * 0.2), 5);
      IF v_rebate_amount > 0 THEN
        v_rebate_team_id := v_initiator_team_id;

        UPDATE public.teams
        SET faab_budget = faab_budget + v_rebate_amount,
            updated_at = NOW()
        WHERE id = v_rebate_team_id;

        INSERT INTO public.transactions (
          league_id, team_id, player_id, type, faab_bid, notes, processed_at, created_at
        ) VALUES (
          p_league_id,
          v_rebate_team_id,
          p_player_id,
          'rebate',
          v_rebate_amount,
          'Scout''s rebate: 20% of €' || v_winner_bid || 'm winning bid for ' || v_player_name,
          NOW(),
          NOW()
        );
      END IF;
    END IF;

    -- Update claims statuses
    UPDATE public.waiver_claims
    SET status = 'approved',
        expires_at = NOW()
    WHERE id = v_winner_claim.id;

    UPDATE public.waiver_claims
    SET status = 'rejected'
    WHERE league_id = p_league_id
      AND player_id = p_player_id
      AND id <> v_winner_claim.id;

    -- Build list of losing bidders
    SELECT jsonb_agg(jsonb_build_object(
      'team_id', t.id,
      'team_name', t.team_name,
      'user_id', t.user_id,
      'faab_bid', wc.faab_bid
    ))
    INTO v_losing_teams
    FROM public.waiver_claims wc
    JOIN public.teams t ON t.id = wc.team_id
    WHERE wc.league_id = p_league_id
      AND wc.player_id = p_player_id
      AND wc.id <> v_winner_claim.id
      AND wc.team_id IS NOT NULL;

    v_result := jsonb_build_object(
      'success', true,
      'won', true,
      'winner_claim_id', v_winner_claim.id,
      'winner_team_id', v_winner_team_id,
      'winner_team_name', v_winner_team_name,
      'winner_user_id', v_winner_user_id,
      'winner_bid', v_winner_bid,
      'winner_severance', v_winner_severance,
      'winner_status', v_winner_status,
      'drop_player_name', v_drop_player_name,
      'initiator_team_name', v_initiator_team_name,
      'rebate_amount', v_rebate_amount,
      'rebate_team_id', v_rebate_team_id,
      'losing_teams', COALESCE(v_losing_teams, '[]'::JSONB)
    );

  ELSE
    -- No winner found: reject all claims
    UPDATE public.waiver_claims
    SET status = 'rejected'
    WHERE league_id = p_league_id
      AND player_id = p_player_id;

    v_result := jsonb_build_object(
      'success', true,
      'won', false
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_single_player_auction_rpc(uuid, uuid, int[]) FROM PUBLIC, anon, authenticated;
