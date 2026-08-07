-- Gaffa — Migration 118: drop the stale place_auction_bid_rpc overload left by 117
--
-- CREATE OR REPLACE does not replace a function when the parameter list
-- changes shape — Postgres treats a new parameter as a different signature
-- and creates a second overload instead. Migration 117 added
-- p_send_to_academy to place_auction_bid_rpc, which left the pre-117
-- 8-argument version alongside the new 9-argument one.
--
-- This is a real hazard, not just clutter: PostgREST resolves an rpc() call
-- by matching the JSON keys sent against a function's argument names, so any
-- caller not sending p_send_to_academy (a stale client bundle, a cached
-- PostgREST schema) could silently resolve to the old overload and skip the
-- 117 mutual-exclusivity check and column write entirely.

DROP FUNCTION IF EXISTS public.place_auction_bid_rpc(
  uuid, uuid, uuid, uuid, integer, timestamptz, timestamptz, uuid
);
