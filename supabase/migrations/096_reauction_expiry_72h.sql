-- ============================================================
-- Migration 096: One 72h window for the dropped-player re-auction
-- ============================================================
-- The resolver stamped its own 48h/96h expiry on the auction it opens for a
-- dropped player, using a 40 threshold, while executeDrop.ts used 48h/96h with
-- a 50 threshold and seedHighValueAuctions used a flat 48h. Deleting the timer's
-- hard ceiling removed the reason for any of it: every auction now runs a single
-- 72h pre-first-bid window and then a decaying inactivity timeout.
--
-- opens_at is set NULL explicitly: a re-auctioned drop opens immediately. Only
-- season kickoff staggers releases.
--
-- Copied from 093_solidarity_on_auctions.sql (which has the solidarity block).
-- The solidarity logic is preserved intact; only the expiry block changes.
--
-- See docs/superpowers/specs/2026-07-30-transfer-market-pricing-design.md

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_enum
    WHERE enumlabel = 'solidarity_payment'
      AND enumtypid = 'public.transaction_type'::regtype
  ) THEN
    ALTER TYPE public.transaction_type ADD VALUE 'solidarity_payment';
  END IF;
END $$;

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
  v_winner_claim RECORD;
  v_winner_team_id UUID := NULL;
  v_winner_team_name TEXT := '';
  v_winner_user_id UUID := NULL;
  v_winner_bid INT := 0;
  v_winner_severance INT := 0;
  v_winner_status public.roster_status := 'bench';
  v_drop_player_name TEXT := '';
  v_initiator_team_id UUID := NULL;
  v_initiator_team_name TEXT := '';
  v_initiator_user_id UUID := NULL;
  v_solidarity_share NUMERIC := 0.20;
  v_scout_share NUMERIC := 0.50;
  v_pool INT := 0;
  v_scout_amount INT := 0;
  v_scout_team_id UUID := NULL;
  v_total_clubs INT := 0;
  v_other_club_count INT := 0;
  v_solidarity_per_club INT := 0;
  v_has_scout BOOLEAN := FALSE;
  s RECORD;
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

  -- Sale-listing state (restored from 059)
  v_sale_listing_id UUID := NULL;
  v_seller_team_id UUID := NULL;
  v_seller_team_name TEXT := '';
  v_is_sale_listing BOOLEAN := FALSE;
BEGIN
  -- 1. Fetch and lock league settings
  SELECT roster_size, taxi_size, taxi_age_limit, solidarity_share, scout_share
  INTO v_roster_size, v_academy_size, v_academy_age_limit, v_solidarity_share, v_scout_share
  FROM public.leagues
  WHERE id = p_league_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'League not found');
  END IF;

  v_roster_size := COALESCE(v_roster_size, 20);
  v_academy_size := COALESCE(v_academy_size, 3);
  v_academy_age_limit := COALESCE(v_academy_age_limit, 21);
  v_solidarity_share := COALESCE(v_solidarity_share, 0.20);
  v_scout_share := COALESCE(v_scout_share, 0.50);

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

  -- 2b. RESTORED (059): detect an active seller listing for this player.
  -- Locked so a concurrent cancel/edit cannot change the terms mid-resolution.
  SELECT l.id, l.seller_team_id
  INTO v_sale_listing_id, v_seller_team_id
  FROM public.player_sale_listings l
  WHERE l.league_id = p_league_id
    AND l.player_id = p_player_id
    AND l.status = 'active'
  FOR UPDATE;

  IF FOUND THEN
    v_is_sale_listing := TRUE;
    SELECT team_name INTO v_seller_team_name FROM public.teams WHERE id = v_seller_team_id;
  END IF;

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
    -- RESTORED (059): a seller cannot win back their own listing. Without this
    -- the seller could bid, win, pay themselves, and freeze out real buyers.
    IF v_is_sale_listing AND r.team_id = v_seller_team_id THEN
      CONTINUE;
    END IF;

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
      -- NB: roster_entries has no league_id column (001_initial_schema.sql:191).
      -- 059 filtered on one here and raised at runtime; team_id + player_id is
      -- already unique, so these two columns are both necessary and sufficient.
      DELETE FROM public.roster_entries
      WHERE team_id = v_winner_team_id
        AND player_id = v_winner_claim.drop_player_id;

      -- Seed re-auction for the dropped player.
      -- Single 72h window: market value no longer affects duration; the old
      -- 48h/96h split used a threshold of 40 while executeDrop.ts used 50.
      -- opens_at is NULL: a drop opens immediately, only kickoff staggers waves.
      v_auction_expiry := NOW() + INTERVAL '72 hours';

      INSERT INTO public.waiver_claims (
        league_id, team_id, player_id, faab_bid, priority, status, gameweek, is_auction, expires_at, opens_at
      ) VALUES (
        p_league_id, NULL, v_winner_claim.drop_player_id, 0, 999, 'pending', 0, TRUE, v_auction_expiry, NULL
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

    -- RESTORED (059): on a sale, the player leaves the seller's roster BEFORE
    -- joining the buyer's. Skipping this is what let one player sit on two
    -- rosters at once — roster_entries is unique on (player_id, team_id), which
    -- does not stop the same player existing under two different teams.
    IF v_is_sale_listing THEN
      DELETE FROM public.roster_entries
      WHERE team_id = v_seller_team_id
        AND player_id = p_player_id;
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
      CASE WHEN v_is_sale_listing
        THEN 'Signed ' || v_player_name || ' from ' || COALESCE(v_seller_team_name, 'another club') || ' for €' || v_winner_bid || 'm'
        ELSE 'Won auction for ' || v_player_name || ' with €' || v_winner_bid || 'm bid'
      END
      || CASE WHEN v_winner_severance > 0 THEN ' (+ €' || v_winner_severance || 'm drop severance)' ELSE '' END
      || CASE WHEN v_winner_status = 'taxi' THEN ' -> academy' ELSE '' END,
      NOW(),
      NOW()
    );

    -- RESTORED (059): pay the seller and close the listing.
    IF v_is_sale_listing THEN
      UPDATE public.teams
      SET faab_budget = faab_budget + v_winner_bid,
          updated_at = NOW()
      WHERE id = v_seller_team_id;

      UPDATE public.player_sale_listings
      SET status = 'sold',
          updated_at = NOW()
      WHERE id = v_sale_listing_id;

      INSERT INTO public.transactions (
        league_id, team_id, player_id, type, faab_bid, notes, processed_at, created_at
      ) VALUES (
        p_league_id,
        v_seller_team_id,
        p_player_id,
        'sale_proceeds',
        v_winner_bid,
        'Sale proceeds: received €' || v_winner_bid || 'm from ' || v_winner_team_name || ' for ' || v_player_name,
        NOW(),
        NOW()
      );
    END IF;

    -- 5. Recirculate part of the winning bid (Scout's Fee + Solidarity)
    -- System auctions ONLY. On a manager-to-manager sale the bid is paid to
    -- the seller (above), so there is nothing burned to recirculate — and
    -- paying solidarity here would mint budget nobody paid.
    IF NOT v_is_sale_listing THEN
      -- The initiator is the earliest MANAGER bid on this player (team_id IS NOT
      -- NULL excludes the system-seeded anchor row). No initiator, or an
      -- initiator who went on to win, means no Scout's Fee — the whole pool then
      -- splits equally among the other clubs. A Buy Now with no prior manager
      -- bid takes that same path.
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

      v_has_scout := (v_initiator_team_id IS NOT NULL AND v_initiator_team_id <> v_winner_team_id);

      SELECT COUNT(1) INTO v_total_clubs FROM public.teams WHERE league_id = p_league_id;

      v_pool := FLOOR(v_winner_bid * v_solidarity_share);
      IF v_has_scout THEN
        v_scout_amount := FLOOR(v_pool * v_scout_share);
        v_other_club_count := GREATEST(0, v_total_clubs - 2);
      ELSE
        v_scout_amount := 0;
        v_other_club_count := GREATEST(0, v_total_clubs - 1);
      END IF;

      IF v_other_club_count > 0 THEN
        v_solidarity_per_club := FLOOR((v_pool - v_scout_amount) / v_other_club_count);
      ELSE
        v_solidarity_per_club := 0;
      END IF;

      -- Pay the scout.
      IF v_has_scout AND v_scout_amount > 0 THEN
        v_scout_team_id := v_initiator_team_id;

        UPDATE public.teams
        SET faab_budget = faab_budget + v_scout_amount,
            updated_at = NOW()
        WHERE id = v_scout_team_id;

        INSERT INTO public.transactions (
          league_id, team_id, player_id, type, faab_bid, notes, processed_at, created_at
        ) VALUES (
          p_league_id,
          v_scout_team_id,
          p_player_id,
          'rebate',
          v_scout_amount,
          'Scout''s fee: opened the auction for ' || v_player_name ||
            ' (10% of the €' || v_winner_bid || 'm winning bid)',
          NOW(),
          NOW()
        );
      END IF;

      -- Pay every other club its equal share. Excludes the winner always, and
      -- the scout when one was paid above.
      IF v_solidarity_per_club > 0 THEN
        FOR s IN
          SELECT id FROM public.teams
          WHERE league_id = p_league_id
            AND id <> v_winner_team_id
            AND (NOT v_has_scout OR id <> v_initiator_team_id)
        LOOP
          UPDATE public.teams
          SET faab_budget = faab_budget + v_solidarity_per_club,
              updated_at = NOW()
          WHERE id = s.id;

          INSERT INTO public.transactions (
            league_id, team_id, player_id, type, faab_bid, notes, processed_at, created_at
          ) VALUES (
            p_league_id,
            s.id,
            p_player_id,
            'solidarity_payment',
            v_solidarity_per_club,
            'Solidarity payment from the €' || v_winner_bid || 'm signing of ' || v_player_name,
            NOW(),
            NOW()
          );
        END LOOP;
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
      'scout_amount', v_scout_amount,
      'scout_team_id', v_scout_team_id,
      'solidarity_per_club', v_solidarity_per_club,
      'solidarity_club_count', v_other_club_count,
      'losing_teams', COALESCE(v_losing_teams, '[]'::JSONB),
      -- RESTORED (059): /api/cron/process-auctions reads these to send the
      -- "Player Sold!" notification and email to the seller.
      'sale_listing_id', v_sale_listing_id,
      'seller_team_id', v_seller_team_id
    );

  ELSE
    -- No winner found: reject all claims
    UPDATE public.waiver_claims
    SET status = 'rejected'
    WHERE league_id = p_league_id
      AND player_id = p_player_id;

    -- RESTORED (059): release the player rather than leaving the listing
    -- 'active' forever, which would keep blocking trades for him indefinitely.
    IF v_is_sale_listing THEN
      UPDATE public.player_sale_listings
      SET status = 'expired',
          updated_at = NOW()
      WHERE id = v_sale_listing_id;
    END IF;

    v_result := jsonb_build_object(
      'success', true,
      'won', false,
      'sale_listing_id', v_sale_listing_id,
      'seller_team_id', v_seller_team_id
    );
  END IF;

  RETURN v_result;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.resolve_single_player_auction_rpc(uuid, uuid, int[]) FROM PUBLIC, anon, authenticated;
