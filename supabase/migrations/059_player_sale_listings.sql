-- ============================================================
-- Migration 059: Player Sale Listings System
-- Replaces the trade block flag with a richer manager-led sale
-- and auction listing system.
-- ============================================================

-- ── 1. Create Listings Table ────────────────────────────────

CREATE TABLE IF NOT EXISTS public.player_sale_listings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id           UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  seller_team_id      UUID NOT NULL REFERENCES public.teams(id) ON DELETE CASCADE,
  player_id           UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  min_bid             INTEGER NOT NULL DEFAULT 0,
  buy_now_price       INTEGER,
  status              TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'active', 'sold', 'expired', 'cancelled')),
  auction_expires_at  TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 2. Create Indexes ────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_player_sale_listings_league_status
  ON public.player_sale_listings (league_id, status);

CREATE INDEX IF NOT EXISTS idx_player_sale_listings_player_status
  ON public.player_sale_listings (player_id, status);

CREATE INDEX IF NOT EXISTS idx_player_sale_listings_seller
  ON public.player_sale_listings (seller_team_id, status);

-- Enforce only one active listing per player in a league
CREATE UNIQUE INDEX IF NOT EXISTS idx_player_sale_listings_one_active
  ON public.player_sale_listings (league_id, player_id)
  WHERE status IN ('pending', 'active');

-- ── 3. Link Waiver Claims to listings ───────────────────────

ALTER TABLE public.waiver_claims
  ADD COLUMN IF NOT EXISTS sale_listing_id UUID
  REFERENCES public.player_sale_listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_waiver_claims_sale_listing
  ON public.waiver_claims (sale_listing_id)
  WHERE sale_listing_id IS NOT NULL;

-- ── 4. Extend Transaction Type Enum ──────────────────────────

ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'sale_proceeds';

-- ── 5. Enable RLS Policies ───────────────────────────────────

ALTER TABLE public.player_sale_listings ENABLE ROW LEVEL SECURITY;

-- Allow league members to view listings
CREATE POLICY "league_members_view_listings"
  ON public.player_sale_listings FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.league_id = player_sale_listings.league_id
        AND t.user_id = auth.uid()
    )
  );

-- ── 6. Update resolve_single_player_auction_rpc ──────────────

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
  
  -- Seller listings variables
  v_sale_listing_id UUID := NULL;
  v_seller_team_id UUID := NULL;
  v_is_sale_listing BOOLEAN := FALSE;
BEGIN
  -- A. Fetch and lock league settings
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

  -- B. Fetch and lock player details
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

  -- C. Detect active seller listing for this player
  SELECT id, seller_team_id
  INTO v_sale_listing_id, v_seller_team_id
  FROM public.player_sale_listings
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND status = 'active';

  IF FOUND THEN
    v_is_sale_listing := TRUE;
  END IF;

  -- D. Lock all pending claims for this player in this league
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
    -- Block seller from bidding on their own listing
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
      IF r.drop_player_id IS NOT NULL THEN
        SELECT p.name, p.market_value, p.pl_team_id, re.status
        INTO v_drop_player_name_raw, v_drop_player_mv, v_drop_player_pl_team_id, v_drop_player_status
        FROM public.players p
        LEFT JOIN public.roster_entries re ON re.player_id = p.id AND re.team_id = r.team_id
        WHERE p.id = r.drop_player_id;

        IF FOUND THEN
          v_severance_fee := FLOOR(COALESCE(v_drop_player_mv, 0) * 0.1);
          
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

  -- E. Execute changes based on winner
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

    -- If this is a seller-initiated auction, delete the player from the seller's roster first
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

    -- Deduct total cost (bid + severance) from winner
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

    -- Credit the seller and log seller transaction if this is a player sale
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

    -- F. Calculate and award Scout's Rebate (Finder's Fee) — ONLY for system-seed auctions
    IF NOT v_is_sale_listing THEN
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
      'losing_teams', COALESCE(v_losing_teams, '[]'::JSONB),
      'sale_listing_id', v_sale_listing_id,
      'seller_team_id', v_seller_team_id
    );

  ELSE
    -- No winner found: reject all claims
    UPDATE public.waiver_claims
    SET status = 'rejected'
    WHERE league_id = p_league_id
      AND player_id = p_player_id;

    -- Mark listing as expired if this is a player sale
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
