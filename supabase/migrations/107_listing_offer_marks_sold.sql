-- Accepting a negotiated offer against a listing (trade_proposals.sale_listing_id)
-- previously left that listing at 'cancelled' — indistinguishable from a listing
-- the seller withdrew, or one made moot by an unrelated trade. It didn't fall
-- through, it sold. Only the listing the accepted trade is actually fulfilling
-- (NEW.sale_listing_id) now flips to 'sold'; any other pending listing on the
-- same players (e.g. rendered moot by an unrelated player-for-player trade)
-- still becomes 'cancelled', exactly as before.

CREATE OR REPLACE FUNCTION public.guard_trade_against_listings()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_players UUID[];
  v_blocked TEXT;
BEGIN
  IF NEW.status NOT IN ('accepted', 'accepted_deferred')
     OR OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  v_players := COALESCE(NEW.offered_players, '{}'::UUID[])
            || COALESCE(NEW.requested_players, '{}'::UUID[]);

  IF array_length(v_players, 1) IS NULL THEN
    RETURN NEW;
  END IF;

  -- Bidding has started on someone in this deal: the auction owns him now.
  SELECT string_agg(p.name, ', ')
  INTO v_blocked
  FROM public.player_sale_listings l
  JOIN public.players p ON p.id = l.player_id
  WHERE l.league_id = NEW.league_id
    AND l.status = 'active'
    AND l.player_id = ANY(v_players);

  IF v_blocked IS NOT NULL THEN
    RAISE EXCEPTION
      'Cannot complete this trade: bidding is live on %. The auction must finish first.', v_blocked
      USING ERRCODE = 'check_violation';
  END IF;

  -- Quiet listings for traded players are withdrawn — the player has moved, so
  -- the seller is no longer his owner. Their anchors go with them, or the cron
  -- would later resolve an auction for a player who has already changed club.
  UPDATE public.waiver_claims
  SET status = 'rejected'
  WHERE league_id = NEW.league_id
    AND player_id = ANY(v_players)
    AND is_auction = TRUE
    AND status = 'pending'
    AND sale_listing_id IN (
      SELECT id FROM public.player_sale_listings
      WHERE league_id = NEW.league_id
        AND status = 'pending'
        AND player_id = ANY(v_players)
    );

  -- The listing this trade fulfils sold; any other pending listing on these
  -- players is now moot and withdrawn.
  IF NEW.sale_listing_id IS NOT NULL THEN
    UPDATE public.player_sale_listings
    SET status = 'sold', updated_at = NOW()
    WHERE id = NEW.sale_listing_id
      AND status = 'pending';
  END IF;

  UPDATE public.player_sale_listings
  SET status = 'cancelled', updated_at = NOW()
  WHERE league_id = NEW.league_id
    AND status = 'pending'
    AND player_id = ANY(v_players)
    AND id IS DISTINCT FROM NEW.sale_listing_id;

  RETURN NEW;
END;
$$;
