-- Gaffa — Migration 076: restore player-sale resolution
--
-- Migration 059 taught `resolve_single_player_auction_rpc` about manager-to-
-- manager sales. Migration 062 then raised the severance rate with a
-- CREATE OR REPLACE whose body was derived from the pre-059 version, silently
-- deleting every line 059 had added. 062 is the head definition and contains no
-- reference to `player_sale_listings` at all.
--
-- What that regression does to a listed player whose auction resolves:
--
--   * The buyer gets a `roster_entries` row and the SELLER KEEPS THEIRS. The
--     unique constraint is (player_id, team_id) — 001_initial_schema.sql:199 —
--     not league-wide, so the player legitimately sits on two rosters and scores
--     for both.
--   * The seller is never paid: no `faab_budget` credit, no `sale_proceeds`
--     transaction.
--   * The listing is never marked 'sold', so it stays 'active' forever, which
--     permanently blocks that player from trades via the active-listing guard in
--     src/app/api/leagues/[leagueId]/trades/route.ts.
--   * A Scout's Rebate is paid to the "initiator" of what is actually a private
--     sale — minting budget out of nothing.
--   * The RPC never returns `sale_listing_id`, so the "Player Sold!" seller
--     notification in /api/cron/process-auctions is dead code that never fires.
--
-- This migration re-grafts 059's seller logic onto 062's body. 062's body is the
-- base on purpose: it carries the current severance rate — GREATEST(2, 20%) —
-- and it fixes a bug of 059's own. 059 deleted the dropped player with
-- `WHERE league_id = p_league_id AND team_id = ... ` but `roster_entries` has no
-- `league_id` column, so 059's drop path raised at runtime for any winning bid
-- that nominated a drop. Only the two-column form below is correct.
--
-- Behavioural note kept from 059: the Scout's Rebate is a finder's fee for
-- flushing a free agent out of the wild. On a manager-to-manager sale there is
-- nothing to find — the seller advertised the player — and the money would come
-- from nowhere, so the rebate is suppressed for listings.
--
-- ⚠️ RUN THE AUDIT AT THE BOTTOM OF THIS FILE BEFORE DEPLOYING ANY CODE THAT
-- DEPENDS ON IT. Rows already corrupted by the regression are not repaired here:
-- repair moves money and deletes roster entries, and it needs eyes on it.

-- The enum value 059 added; harmless if 059 already ran.
ALTER TYPE public.transaction_type ADD VALUE IF NOT EXISTS 'sale_proceeds';


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
  v_winner_status public.roster_status := 'bench';
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

  -- Sale-listing state (restored from 059)
  v_sale_listing_id UUID := NULL;
  v_seller_team_id UUID := NULL;
  v_seller_team_name TEXT := '';
  v_is_sale_listing BOOLEAN := FALSE;
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

      -- Seed summer/waiver auction for the dropped player
      IF v_is_big_transfer THEN
        v_auction_expiry := NOW() + INTERVAL '96 hours';
      ELSE
        v_auction_expiry := NOW() + INTERVAL '48 hours';
      END IF;

      INSERT INTO public.waiver_claims (
        league_id, team_id, player_id, faab_bid, priority, status, gameweek, is_auction,
        expires_at, market_value_at_auction
      ) VALUES (
        p_league_id, NULL, v_winner_claim.drop_player_id, 0, 999, 'pending', 0, TRUE,
        v_auction_expiry,
        -- Reference price for the auction premium (migration 070). This anchor
        -- was the one creation path that never recorded it.
        (SELECT NULLIF(COALESCE(market_value, 0), 0)
           FROM public.players WHERE id = v_winner_claim.drop_player_id)
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

    -- 5. Scout's Rebate (finder's fee) — system auctions ONLY.
    -- RESTORED (059): on a manager-to-manager sale there is nothing to "find";
    -- the seller advertised the player. Paying it here would also mint budget
    -- that no team paid, on top of the buyer→seller transfer just made.
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


-- ============================================================
-- AUDIT — run this BEFORE trusting the fix. Repair by hand.
-- ============================================================
--
-- Listings whose auction already resolved while the regression was live. Each
-- row is a sale where the buyer was given the player but the seller was neither
-- paid nor relieved of him.
--
--   SELECT l.id              AS listing_id,
--          l.player_id,
--          p.name            AS player_name,
--          st.team_name      AS seller,
--          wt.team_name      AS winner,
--          wc.faab_bid       AS sale_price,
--          EXISTS (SELECT 1 FROM public.roster_entries re
--                   WHERE re.team_id = l.seller_team_id
--                     AND re.player_id = l.player_id)  AS seller_still_has_player,
--          EXISTS (SELECT 1 FROM public.transactions t
--                   WHERE t.type = 'sale_proceeds'
--                     AND t.team_id = l.seller_team_id
--                     AND t.player_id = l.player_id)   AS seller_was_paid
--     FROM public.player_sale_listings l
--     JOIN public.waiver_claims wc
--       ON wc.sale_listing_id = l.id AND wc.status = 'approved'
--     JOIN public.players p  ON p.id  = l.player_id
--     JOIN public.teams   st ON st.id = l.seller_team_id
--     JOIN public.teams   wt ON wt.id = wc.team_id
--    WHERE l.status = 'active';
--
-- Per affected row, and ONLY after confirming the numbers:
--   1. DELETE FROM roster_entries WHERE team_id = <seller> AND player_id = <player>;
--   2. UPDATE teams SET faab_budget = faab_budget + <sale_price> WHERE id = <seller>;
--   3. INSERT the missing 'sale_proceeds' transaction.
--   4. Claw back any 'rebate' transaction wrongly paid on this sale:
--        SELECT * FROM transactions
--         WHERE type = 'rebate' AND player_id = <player> AND created_at >= <resolution time>;
--      then reverse the faab_budget credit and delete the row.
--   5. UPDATE player_sale_listings SET status = 'sold', updated_at = NOW() WHERE id = <listing>;
--
-- Also worth checking for the same double-roster symptom arriving by any other
-- route — this query is independent of the regression and should return zero:
--
--   SELECT re.player_id, p.name, COUNT(*) AS teams_holding
--     FROM public.roster_entries re
--     JOIN public.teams t   ON t.id = re.team_id
--     JOIN public.players p ON p.id = re.player_id
--    GROUP BY t.league_id, re.player_id, p.name
--   HAVING COUNT(*) > 1;
