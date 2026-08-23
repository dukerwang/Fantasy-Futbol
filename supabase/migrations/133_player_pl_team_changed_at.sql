-- ============================================================
-- Migration 133: Track when a player's PL club last changed
-- ============================================================
--
-- PROBLEM
-- -------
-- The mid-season "high-value arrival" auction sweep (seedHighValueAuctions,
-- reusing findPromotedClubsAndArrivals) is meant to catch players who have
-- just transferred into the Premier League. Instead it flags ANY unowned
-- player with market_value >= EUR50m, transfer or not -- an existing player
-- who simply never got drafted (e.g. L. Yoro, K. Havertz, Murillo,
-- N. Madueke) gets swept into a system auction with no real-world transfer
-- having happened at all.
--
-- FIX
-- ---
-- Give syncPlayersFromFpl somewhere to record "this player's club just
-- changed" so the sweep can require actual transfer evidence instead of
-- treating every unowned expensive player as an arrival. NULL for anyone
-- whose club hasn't changed since this column started being tracked.

ALTER TABLE public.players
  ADD COLUMN IF NOT EXISTS pl_team_changed_at TIMESTAMPTZ;
