-- Gaffa — Migration 117: proactive academy routing on auction bids
--
-- Academy routing has only ever existed as a fallback computed fresh at
-- resolution time: resolve_single_player_auction_rpc only tries the academy
-- when the active roster is ALREADY full and no drop was nominated. If the
-- roster has room at the exact moment one specific auction resolves, the
-- winner always lands on bench — even for a U21 prospect the manager would
-- rather stash in the academy.
--
-- This produced a real incident: two auctions resolved seconds apart. The
-- first (a U21 prospect) resolved while the roster still had a free slot, so
-- he landed on bench (academy never considered — the roster wasn't full
-- yet), consuming the last slot. The second auction then resolved into a now-
-- full roster with no drop nominated, and lost.
--
-- Fix: let a manager mark a bid `send_to_academy` at bid time. The resolver
-- honors that request first, regardless of active-roster fullness, re-
-- checking eligibility (age, academy capacity) fresh at resolution time since
-- it can be minutes or hours after the bid was placed. If academy space is
-- gone by then, it falls back to ordinary bench placement (not a hard
-- failure) when the active roster has room.
--
-- See docs/superpowers/specs/2026-08-07-proactive-academy-routing-design.md

ALTER TABLE public.waiver_claims
  ADD COLUMN IF NOT EXISTS send_to_academy BOOLEAN NOT NULL DEFAULT FALSE;

-- ── place_auction_bid_rpc ────────────────────────────────────────────────────
-- Adds p_send_to_academy, stored on both the initial insert and the
-- update-on-raise path, same as p_drop_player_id already is. Rejects the call
-- if both a drop and academy routing are requested on the same bid — a
-- manager is choosing one outcome for this bid, not stacking two.
CREATE OR REPLACE FUNCTION public.place_auction_bid_rpc(
  p_league_id UUID,
  p_team_id UUID,
  p_player_id UUID,
  p_drop_player_id UUID,
  p_bid_amount INT,
  p_expires_at TIMESTAMPTZ,
  p_now TIMESTAMPTZ,
  p_expect_sale_listing_id UUID DEFAULT NULL,
  p_send_to_academy BOOLEAN DEFAULT FALSE
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_system_seed_id UUID;
  v_highest_team_id UUID;
  v_highest_bid INT := 0;
  v_my_claim_id UUID;
  v_my_current_bid INT := 0;
  v_prev_highest_team_id UUID := NULL;
  v_prev_highest_bid INT := 0;
  v_prev_highest_team_name TEXT := '';
  v_prev_highest_user_id UUID := NULL;
  v_prev_highest_email TEXT := '';

  v_listing RECORD;
  v_is_listing BOOLEAN := FALSE;
  v_is_buy_now BOOLEAN := FALSE;
  v_effective_expiry TIMESTAMPTZ;
  v_market_value NUMERIC;
  v_cancelled_trades INT := 0;
BEGIN
  -- NEW (117): mutually exclusive — a bid nominates a drop OR requests
  -- academy routing, never both.
  IF p_drop_player_id IS NOT NULL AND p_send_to_academy THEN
    RETURN jsonb_build_object('success', false,
      'error', 'Cannot nominate a drop player and request academy routing on the same bid.');
  END IF;

  -- 0. Resolve which kind of auction this is. Locked, so a concurrent cancel or
  --    price edit cannot change the terms underneath this bid.
  SELECT l.id, l.seller_team_id, l.min_bid, l.buy_now_price, l.status
  INTO v_listing
  FROM public.player_sale_listings l
  WHERE l.league_id = p_league_id
    AND l.player_id = p_player_id
    AND l.status IN ('pending', 'active')
  FOR UPDATE;

  v_is_listing := FOUND;

  IF p_expect_sale_listing_id IS NOT NULL
     AND (NOT v_is_listing OR v_listing.id <> p_expect_sale_listing_id) THEN
    RETURN jsonb_build_object('success', false,
      'error', 'This listing is no longer available. Refresh and try again.');
  END IF;

  IF v_is_listing THEN
    -- A seller cannot buy back their own listing.
    IF v_listing.seller_team_id = p_team_id THEN
      RETURN jsonb_build_object('success', false,
        'error', 'You cannot bid on your own listing.');
    END IF;

    IF v_listing.min_bid IS NULL THEN
      -- No auction floor: this listing is either release-clause-only or
      -- negotiation-only. Either way, the ONLY bid Postgres will accept here is
      -- one that clears the clause outright — anything else, including a bid
      -- amount of 0, is rejected. `< NULL` would silently never be TRUE, which
      -- is why this can't just fall through to the ordinary floor check below.
      IF v_listing.buy_now_price IS NULL OR p_bid_amount < v_listing.buy_now_price THEN
        RETURN jsonb_build_object('success', false,
          'error', 'This player is not open to auction bids. Pay the release clause in full, or send an Offer to negotiate instead.');
      END IF;
    ELSIF p_bid_amount < v_listing.min_bid THEN
      RETURN jsonb_build_object('success', false,
        'error', 'Bid must be at least the minimum of €' || v_listing.min_bid || 'm.');
    END IF;
  ELSE
    -- FREE-AGENT GUARD. No listing means this must be an unowned player. Without
    -- this, a bid on a rostered player seeds an auction for someone else's
    -- signing and the resolver duplicates him across two rosters.
    IF EXISTS (
      SELECT 1
      FROM public.roster_entries re
      JOIN public.teams t ON t.id = re.team_id
      WHERE t.league_id = p_league_id
        AND re.player_id = p_player_id
    ) THEN
      RETURN jsonb_build_object('success', false,
        'error', 'That player is on a club''s roster and is not listed for sale.');
    END IF;
  END IF;

  SELECT market_value INTO v_market_value FROM public.players WHERE id = p_player_id;

  -- 1. Buy Now. A bid at or above the instant price ends the auction now rather
  --    than extending it. Implemented as an immediate expiry so the ordinary
  --    resolver decides the winner — one settlement path, not two. When
  --    min_bid is NULL the gate above already guaranteed p_bid_amount clears
  --    buy_now_price, so this always evaluates TRUE in that case.
  IF v_is_listing
     AND v_listing.buy_now_price IS NOT NULL
     AND p_bid_amount >= v_listing.buy_now_price THEN
    v_is_buy_now := TRUE;
    v_effective_expiry := p_now - INTERVAL '1 second';
  ELSE
    v_effective_expiry := p_expires_at;
  END IF;

  -- 2. Ensure the anchor exists. From migration 080 listings are seeded with one
  --    at creation, so for those this is a no-op; free agents are born here.
  INSERT INTO public.waiver_claims (
    league_id, team_id, player_id, faab_bid, priority, status, gameweek, is_auction,
    expires_at, first_bid_at, last_bid_at, sale_listing_id, market_value_at_auction
  )
  VALUES (
    p_league_id, NULL, p_player_id, 0, 999, 'pending', 0, TRUE,
    v_effective_expiry, p_now, p_now,
    CASE WHEN v_is_listing THEN v_listing.id ELSE NULL END,
    NULLIF(COALESCE(v_market_value, 0), 0)
  )
  ON CONFLICT (league_id, player_id)
    WHERE (team_id IS NULL AND status = 'pending'::public.waiver_claim_status AND is_auction = TRUE)
  DO NOTHING;

  -- 3. Lock the anchor to serialize concurrent bids on this player.
  SELECT id INTO v_system_seed_id
  FROM public.waiver_claims
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id IS NULL
    AND is_auction = TRUE
    AND status = 'pending'
  FOR UPDATE;

  -- 4. Current highest bidder, read before we insert.
  SELECT wc.team_id, wc.faab_bid, t.team_name, t.user_id, u.email
  INTO v_highest_team_id, v_highest_bid, v_prev_highest_team_name, v_prev_highest_user_id, v_prev_highest_email
  FROM public.waiver_claims wc
  JOIN public.teams t ON t.id = wc.team_id
  JOIN public.users u ON u.id = t.user_id
  WHERE wc.league_id = p_league_id
    AND wc.player_id = p_player_id
    AND wc.status = 'pending'
    AND wc.is_auction = TRUE
    AND wc.team_id IS NOT NULL
  ORDER BY wc.faab_bid DESC
  LIMIT 1;

  -- 5. This team's own standing bid.
  SELECT id, faab_bid INTO v_my_claim_id, v_my_current_bid
  FROM public.waiver_claims
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id = p_team_id
    AND status = 'pending'
    AND is_auction = TRUE;

  -- 6. Must beat the field. Skipped for Buy Now, which by construction already
  --    clears any bid the auction could legally hold.
  IF NOT v_is_buy_now THEN
    IF v_highest_team_id IS NOT NULL AND v_highest_team_id <> p_team_id AND p_bid_amount <= v_highest_bid THEN
      RETURN jsonb_build_object('success', false,
        'error', 'Bid must be greater than the current highest bid of €' || v_highest_bid || 'm');
    END IF;

    IF v_my_claim_id IS NOT NULL AND p_bid_amount <= v_my_current_bid THEN
      RETURN jsonb_build_object('success', false,
        'error', 'Your new bid must be greater than your current bid of €' || v_my_current_bid || 'm');
    END IF;
  END IF;

  -- 7. Upsert this team's bid.
  IF v_my_claim_id IS NOT NULL THEN
    UPDATE public.waiver_claims
    SET faab_bid = p_bid_amount,
        drop_player_id = p_drop_player_id,
        send_to_academy = p_send_to_academy,
        expires_at = v_effective_expiry
    WHERE id = v_my_claim_id;
  ELSE
    INSERT INTO public.waiver_claims (
      league_id, team_id, player_id, drop_player_id, faab_bid, priority, status,
      gameweek, expires_at, is_auction, sale_listing_id, send_to_academy
    )
    VALUES (
      p_league_id, p_team_id, p_player_id, p_drop_player_id, p_bid_amount, 999, 'pending',
      0, v_effective_expiry, TRUE,
      CASE WHEN v_is_listing THEN v_listing.id ELSE NULL END,
      p_send_to_academy
    );
  END IF;

  -- 7b. Log this bid as an immutable event. waiver_claims itself only ever
  --     holds this team's CURRENT bid (the upsert above overwrites in place on
  --     a raise) — this is the only durable record that a raise ever happened,
  --     and it's what the Bid history panel now reads (see refresh_auction_state).
  INSERT INTO public.auction_bid_events (anchor_id, league_id, player_id, team_id, amount)
  VALUES (v_system_seed_id, p_league_id, p_player_id, p_team_id, p_bid_amount);

  -- 8. Anchor metadata: the activity timer restarts from this bid.
  UPDATE public.waiver_claims
  SET last_bid_at = p_now,
      expires_at = v_effective_expiry,
      first_bid_at = COALESCE(first_bid_at, p_now)
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id IS NULL
    AND is_auction = TRUE
    AND status = 'pending';

  -- 9. Propagate the expiry to every other standing bid, so the whole group
  --    resolves together.
  UPDATE public.waiver_claims
  SET expires_at = v_effective_expiry
  WHERE league_id = p_league_id
    AND player_id = p_player_id
    AND team_id IS NOT NULL
    AND is_auction = TRUE
    AND status = 'pending';

  -- 10. THE LOCK. First bid on a quiet listing commits the player: the seller
  --     can no longer cancel, and every open negotiation for him dies here — in
  --     this transaction, not in a follow-up statement a concurrent accept could
  --     slip past.
  IF v_is_listing AND v_listing.status = 'pending' THEN
    UPDATE public.player_sale_listings
    SET status = 'active',
        auction_expires_at = v_effective_expiry,
        updated_at = p_now
    WHERE id = v_listing.id;

    WITH cancelled AS (
      UPDATE public.trade_proposals
      SET status = 'cancelled', updated_at = p_now
      WHERE league_id = p_league_id
        AND status = 'pending'
        AND (offered_players @> ARRAY[p_player_id]
             OR requested_players @> ARRAY[p_player_id])
      RETURNING 1
    )
    SELECT COUNT(*) INTO v_cancelled_trades FROM cancelled;

  ELSIF v_is_listing THEN
    UPDATE public.player_sale_listings
    SET auction_expires_at = v_effective_expiry,
        updated_at = p_now
    WHERE id = v_listing.id;
  END IF;

  -- Outbid bookkeeping for the notification the route sends.
  IF v_highest_team_id IS NOT NULL AND v_highest_team_id <> p_team_id THEN
    v_prev_highest_team_id := v_highest_team_id;
    v_prev_highest_bid := v_highest_bid;
  ELSE
    v_prev_highest_team_id := NULL;
    v_prev_highest_bid := 0;
    v_prev_highest_team_name := '';
    v_prev_highest_user_id := NULL;
    v_prev_highest_email := '';
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'is_listing', v_is_listing,
    'sale_listing_id', CASE WHEN v_is_listing THEN v_listing.id ELSE NULL END,
    'seller_team_id', CASE WHEN v_is_listing THEN v_listing.seller_team_id ELSE NULL END,
    -- The route must resolve the auction inline when this is true. Buy Now that
    -- waits on the 10-minute pg_cron sweep is not "instant".
    'is_buy_now', v_is_buy_now,
    'expires_at', v_effective_expiry,
    'cancelled_trade_count', v_cancelled_trades,
    'outbid_team_id', v_prev_highest_team_id,
    'outbid_team_name', v_prev_highest_team_name,
    'outbid_team_user_id', v_prev_highest_user_id,
    'outbid_user_email', v_prev_highest_email,
    'previous_highest_bid', v_prev_highest_bid
  );
END;
$$;

-- ── resolve_single_player_auction_rpc ───────────────────────────────────────
-- Adds the send_to_academy branch: a candidate who requested it gets academy
-- eligibility (age, capacity) re-checked fresh right here, regardless of
-- whether the active roster happens to be full at this exact moment. If the
-- request can no longer be honored, falls back to ordinary bench placement
-- when the active roster has room, rather than failing the win outright.
-- Everything else is unchanged from migration 115.
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
  v_solidarity_recipients JSONB := '[]'::JSONB;
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

  -- Why each non-winning candidate failed, only surfaced when the loop ends
  -- with no winner at all. (Retroactively captured in 115 — see that file's
  -- header.)
  v_rejection_reasons JSONB := '[]'::JSONB;
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
    SELECT wc.id, wc.team_id, wc.drop_player_id, wc.faab_bid, wc.created_at, wc.status, wc.send_to_academy
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
            ELSE
              -- drop player already gone AND active roster still full.
              v_rejection_reasons := v_rejection_reasons || jsonb_build_object(
                'team_id', r.team_id,
                'team_name', v_temp_rec.team_name,
                'user_id', v_temp_rec.user_id,
                'faab_bid', r.faab_bid,
                'reason', 'roster_full'
              );
            END IF;
          END IF;
        ELSIF r.send_to_academy THEN
          -- NEW (117): proactive academy request. Try the academy first,
          -- regardless of whether the active roster happens to be full right
          -- now — re-checked fresh here since academy space can be claimed by
          -- a different auction resolving moments before or after this one.
          SELECT COUNT(1)
          INTO v_academy_count
          FROM public.roster_entries
          WHERE team_id = r.team_id
            AND status = 'taxi';

          v_age := NULL;
          IF v_player_dob IS NOT NULL THEN
            v_age := DATE_PART('year', AGE(v_player_dob));
          END IF;

          IF v_academy_count < v_academy_size AND v_age IS NOT NULL AND v_age <= v_academy_age_limit THEN
            v_winner_team_id := r.team_id;
            v_winner_claim := r;
            v_winner_severance := 0;
            v_drop_player_name := '';
            v_winner_bid := r.faab_bid;
            v_winner_team_name := v_temp_rec.team_name;
            v_winner_user_id := v_temp_rec.user_id;
            v_winner_status := 'taxi';
            EXIT;
          ELSIF v_active_count < v_roster_size THEN
            -- Academy request could not be honored (full, or the player is no
            -- longer age-eligible) — fall back to ordinary bench placement
            -- rather than failing the win outright.
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
            v_rejection_reasons := v_rejection_reasons || jsonb_build_object(
              'team_id', r.team_id,
              'team_name', v_temp_rec.team_name,
              'user_id', v_temp_rec.user_id,
              'faab_bid', r.faab_bid,
              'reason', 'roster_full'
            );
          END IF;
        ELSE
          -- No drop player nominated, no academy request
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

            -- Neither the active roster nor the academy had room (or the
            -- player was too old for the academy fallback).
            IF v_winner_team_id IS NULL THEN
              v_rejection_reasons := v_rejection_reasons || jsonb_build_object(
                'team_id', r.team_id,
                'team_name', v_temp_rec.team_name,
                'user_id', v_temp_rec.user_id,
                'faab_bid', r.faab_bid,
                'reason', 'roster_full'
              );
            END IF;
          END IF;
        END IF;
      ELSE
        -- bid + severance exceeded this bidder's club balance.
        v_rejection_reasons := v_rejection_reasons || jsonb_build_object(
          'team_id', r.team_id,
          'team_name', v_temp_rec.team_name,
          'user_id', v_temp_rec.user_id,
          'faab_bid', r.faab_bid,
          'reason', 'insufficient_budget'
        );
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
      WHERE team_id = v_winner_team_id
        AND player_id = v_winner_claim.drop_player_id;

      v_auction_expiry := NOW() + INTERVAL '72 hours';

      INSERT INTO public.waiver_claims (
        league_id, team_id, player_id, faab_bid, priority, status, gameweek, is_auction, expires_at, opens_at
      ) VALUES (
        p_league_id, NULL, v_winner_claim.drop_player_id, 0, 999, 'pending', 0, TRUE, v_auction_expiry, NULL
      );

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

    IF v_is_sale_listing THEN
      DELETE FROM public.roster_entries
      WHERE team_id = v_seller_team_id
        AND player_id = p_player_id;
    END IF;

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

    UPDATE public.teams
    SET faab_budget = faab_budget - (v_winner_bid + v_winner_severance),
        updated_at = NOW()
    WHERE id = v_winner_team_id;

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

      -- Pay every other club its equal share, and record who was actually
      -- paid (team_id, team_name, user_id) so the caller can notify them
      -- individually without a second query that could disagree with what
      -- was just written.
      IF v_solidarity_per_club > 0 THEN
        FOR s IN
          SELECT t.id, t.team_name, t.user_id
          FROM public.teams t
          WHERE t.league_id = p_league_id
            AND t.id <> v_winner_team_id
            AND (NOT v_has_scout OR t.id <> v_initiator_team_id)
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

          v_solidarity_recipients := v_solidarity_recipients || jsonb_build_object(
            'team_id', s.id,
            'team_name', s.team_name,
            'user_id', s.user_id
          );
        END LOOP;
      END IF;
    END IF;

    UPDATE public.waiver_claims
    SET status = 'approved',
        expires_at = NOW()
    WHERE id = v_winner_claim.id;

    UPDATE public.waiver_claims
    SET status = 'rejected'
    WHERE league_id = p_league_id
      AND player_id = p_player_id
      AND id <> v_winner_claim.id;

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
      'scout_user_id', CASE WHEN v_scout_team_id IS NOT NULL THEN v_initiator_user_id ELSE NULL END,
      'scout_team_name', CASE WHEN v_scout_team_id IS NOT NULL THEN v_initiator_team_name ELSE NULL END,
      'solidarity_per_club', v_solidarity_per_club,
      'solidarity_club_count', v_other_club_count,
      'solidarity_recipients', v_solidarity_recipients,
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
      'seller_team_id', v_seller_team_id,
      'rejected_claims', v_rejection_reasons
    );
  END IF;

  RETURN v_result;
END;
$$;
