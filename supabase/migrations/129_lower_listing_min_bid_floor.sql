-- ============================================================
-- Migration 129: Lower the listing minimum-bid floor from 80% to 60%
-- ============================================================
-- 80% priced manager listings out of the market relative to the free-agent
-- floor (50%, migration 095) -- nobody pays 80% of market value to a rival
-- when the equivalent free agent costs 50%. 60% keeps a listing meaningfully
-- above the free-agent floor (a rostered player with an owner asking for him
-- isn't the same as an unclaimed free agent) while making manager listings
-- actually sellable.

CREATE OR REPLACE FUNCTION public.enforce_listing_min_bid_floor()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_mv    NUMERIC;
  v_floor INT;
BEGIN
  -- Only validate a min_bid that is being set or changed.
  IF TG_OP = 'UPDATE' AND NEW.min_bid IS NOT DISTINCT FROM OLD.min_bid THEN
    RETURN NEW;
  END IF;

  SELECT market_value INTO v_mv FROM public.players WHERE id = NEW.player_id;

  -- No valuation on record: quarantined, not waved through. A null value
  -- means "not priced yet", not "worthless" -- see migration 100's comment.
  IF v_mv IS NULL THEN
    RAISE EXCEPTION
      'This player has not been priced by Transfermarkt yet and cannot be listed for sale.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_mv <= 0 THEN
    RETURN NEW;
  END IF;

  v_floor := FLOOR(v_mv * 0.6);

  IF NEW.min_bid < v_floor THEN
    RAISE EXCEPTION
      'Minimum bid must be at least €%m — 60%% of this player''s €%m market value.',
      v_floor, ROUND(v_mv)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
