-- ============================================================
-- Migration 100: Quarantine unpriced players from sale listings
-- ============================================================
-- 077_listing_gates.sql's enforce_listing_min_bid_floor() deliberately lets a
-- null-market_value listing through: "not a collusion risk worth blocking a
-- listing over." That reasoning held when the only source of a null value was
-- old, unmatched data. It no longer holds now that syncPlayers.ts inserts every
-- brand-new signing with market_value: null on purpose (see that file's
-- comment) -- a null value today usually means "not priced yet," specifically
-- including exactly the high-profile new arrivals a floor exists to protect.
--
-- Letting a listing exist at all for an unpriced player means it can be sold
-- for whatever the seller asks, with nothing to anchor a floor against.
-- Quarantine instead: block the listing outright until a real value lands
-- (same day, via the daily Transfermarkt gap-sync -- see
-- scripts/run_transfermarkt_gaps.sh).

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
  -- means "not priced yet", not "worthless" -- see migration comment above.
  IF v_mv IS NULL THEN
    RAISE EXCEPTION
      'This player has not been priced by Transfermarkt yet and cannot be listed for sale.'
      USING ERRCODE = 'check_violation';
  END IF;

  IF v_mv <= 0 THEN
    RETURN NEW;
  END IF;

  v_floor := FLOOR(v_mv * 0.8);

  IF NEW.min_bid < v_floor THEN
    RAISE EXCEPTION
      'Minimum bid must be at least €%m — 80%% of this player''s €%m market value.',
      v_floor, ROUND(v_mv)
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;
