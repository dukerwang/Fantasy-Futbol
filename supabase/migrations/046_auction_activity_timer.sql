-- ============================================================
-- Migration 046: Activity-Based Auction Timer
--
-- Adds two new columns to waiver_claims to track bidding activity.
-- These are stored on the system-seed (team_id IS NULL) anchor row
-- for each pending auction and drive the new activity-based expiry formula:
--
--   expires_at = min(
--     first_bid_at + MAX_DURATION,
--     max(first_bid_at + 24hr, last_bid_at + 12hr)
--   )
--
-- This replaces the old fixed 48hr / 96hr + 1hr anti-snipe model.
-- A bid placed at 3am can no longer close at 4am — minimum 12hr window
-- always applies after MIN_DURATION (24hr) has elapsed.
-- ============================================================

-- Add new timing columns. Both are nullable because:
--   • System-seed rows start with NULL (no real bids placed yet).
--   • Real bid rows (team_id IS NOT NULL) never use these columns.
ALTER TABLE public.waiver_claims
  ADD COLUMN IF NOT EXISTS first_bid_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_bid_at  TIMESTAMPTZ;

-- Partial index to speed up monitoring/admin queries on active auction headers.
CREATE INDEX IF NOT EXISTS idx_waiver_claims_last_bid_at
  ON public.waiver_claims (last_bid_at)
  WHERE team_id IS NULL AND status = 'pending' AND is_auction = TRUE;

-- Column documentation
COMMENT ON COLUMN public.waiver_claims.first_bid_at IS
  'Timestamp of the first real (non-system-seed) bid placed on this auction. '
  'Set once when the first real bid arrives; never updated after that. '
  'Only populated on the system-seed (team_id IS NULL) anchor row.';

COMMENT ON COLUMN public.waiver_claims.last_bid_at IS
  'Timestamp of the most recently placed bid for this auction group. '
  'Updated on every bid. Only populated on the system-seed anchor row.';
