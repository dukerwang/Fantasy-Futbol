-- Gaffa — Migration 081: remove the orphaned 2-argument auction resolver
--
-- The database carries two overloads of resolve_single_player_auction_rpc:
--
--   resolve_single_player_auction_rpc(uuid, uuid, integer[])  <- current, 076
--   resolve_single_player_auction_rpc(uuid, uuid)             <- orphan
--
-- No migration in this repo ever created the 2-argument form. 052, 059, 062 and
-- 076 all declare (uuid, uuid, int[]), so the orphan predates or bypasses the
-- migration history — presumably a hand-run statement during early development.
-- Its body is the pre-059 logic: no sale-listing detection, no seller payout, no
-- rebate suppression. It is the exact bug 076 exists to fix, still callable.
--
-- Two reasons to drop it rather than leave it:
--
--   1. SECURITY. Every REVOKE EXECUTE in 052/059/062/076 names the THREE-argument
--      signature. The orphan therefore still carries PostgreSQL's default grant
--      (EXECUTE to PUBLIC) unless it was revoked by hand. It is SECURITY DEFINER
--      and it mutates roster_entries, teams.faab_budget and transactions — so an
--      authenticated user could invoke roster and budget changes directly through
--      PostgREST, running the broken pre-059 body.
--
--   2. AMBIGUITY. Overloads that differ only by a trailing argument are a standing
--      trap for anything calling by name. The one caller today
--      (src/app/api/cron/process-auctions/route.ts:128) passes three named
--      parameters and binds correctly, but nothing enforces that.
--
-- Confirmed unused before writing this: grep over src/, scripts/ and scratch/
-- finds exactly one call site, and it passes p_locked_pl_team_ids.

-- ── Check what the orphan can currently do (informational) ───
DO $$
DECLARE
  v_acl TEXT;
BEGIN
  SELECT COALESCE(array_to_string(p.proacl, ', '), 'DEFAULT (EXECUTE to PUBLIC)')
  INTO v_acl
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'resolve_single_player_auction_rpc'
    AND p.pronargs = 2;

  IF v_acl IS NULL THEN
    RAISE NOTICE 'No 2-argument overload found — nothing to drop.';
  ELSE
    RAISE NOTICE 'Dropping 2-arg overload. Its privileges were: %', v_acl;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.resolve_single_player_auction_rpc(uuid, uuid);

-- Belt and braces on the surviving signature: 076 already revoked this, but the
-- orphan proves a REVOKE can be missed when a signature changes.
REVOKE EXECUTE ON FUNCTION public.resolve_single_player_auction_rpc(uuid, uuid, int[])
  FROM PUBLIC, anon, authenticated;


-- ============================================================
-- POST-APPLY CHECK — expect exactly ONE row, ending in "integer[])",
-- with proacl showing no grant to anon/authenticated.
-- ============================================================
--
--   SELECT p.oid::regprocedure AS signature,
--          COALESCE(array_to_string(p.proacl, ', '), 'DEFAULT (EXECUTE to PUBLIC)') AS privileges,
--          p.prosrc LIKE '%v_is_sale_listing%' AS has_sale_logic
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.proname = 'resolve_single_player_auction_rpc';
--
-- While you are here, the same class of orphan is worth sweeping for generally —
-- any SECURITY DEFINER function still holding a default PUBLIC grant:
--
--   SELECT p.oid::regprocedure AS signature, p.prosecdef AS security_definer
--     FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
--    WHERE n.nspname = 'public' AND p.prosecdef AND p.proacl IS NULL
--    ORDER BY 1;
