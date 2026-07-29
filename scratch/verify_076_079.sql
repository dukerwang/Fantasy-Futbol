-- Gaffa — verification for migrations 076-079
--
-- The Supabase SQL editor only renders the result of the LAST statement in a
-- script, so a file of separate SELECTs shows you exactly one answer. This is
-- one single query: select all of it, Run, read the grid.
--
-- Every row has a STATUS. Anything not 'PASS' is explained in the notes column.
-- Section B rows are the ones that matter most — they are live data damage, not
-- migration bookkeeping.

WITH
fn AS (
  SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'resolve_single_player_auction_rpc'
  LIMIT 1
),
bidfn AS (
  SELECT prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'place_auction_bid_rpc'
  LIMIT 1
),
r AS (

-- ── A. Did 076 actually replace the broken resolver? ────────
SELECT 1 AS ord, 'A · 076' AS section, 'Sale-listing detection restored' AS check_name,
  COALESCE((SELECT (prosrc LIKE '%v_is_sale_listing%')::text FROM fn), 'FUNCTION MISSING') AS result,
  'true' AS expected,
  'If false, 076 did not take — stop and re-run it.' AS notes
UNION ALL SELECT 2, 'A · 076', 'Seller gets paid (sale_proceeds)',
  COALESCE((SELECT (prosrc LIKE '%sale_proceeds%')::text FROM fn), 'FUNCTION MISSING'), 'true',
  'The seller credit + transaction log.'
UNION ALL SELECT 3, 'A · 076', 'Seller roster entry removed on sale',
  COALESCE((SELECT (prosrc LIKE '%DELETE FROM public.roster_entries%WHERE team_id = v_seller_team_id%')::text FROM fn), 'FUNCTION MISSING'), 'true',
  'This is the line that stops a player sitting on two rosters.'
UNION ALL SELECT 4, 'A · 076', 'Scout''s Rebate suppressed on sales',
  COALESCE((SELECT (prosrc LIKE '%IF NOT v_is_sale_listing%')::text FROM fn), 'FUNCTION MISSING'), 'true',
  'Stops budget being minted on manager-to-manager deals.'
UNION ALL SELECT 5, 'A · 076', 'transaction_type has sale_proceeds',
  (SELECT COUNT(*)::text FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
    WHERE t.typname = 'transaction_type' AND e.enumlabel = 'sale_proceeds'), '1',
  'Enum value the seller payout depends on.'

-- ── B. LIVE DATA DAMAGE from the 062 regression ─────────────
UNION ALL SELECT 10, 'B · AUDIT', '>> Sales corrupted while 062 was live',
  (SELECT COUNT(*)::text
     FROM public.player_sale_listings l
     JOIN public.waiver_claims wc ON wc.sale_listing_id = l.id AND wc.status = 'approved'
    WHERE l.status = 'active'), '0',
  'Each = buyer got the player, seller kept him AND was never paid. Needs manual repair.'
UNION ALL SELECT 11, 'B · AUDIT', '>> Players on two rosters in one league',
  (SELECT COUNT(*)::text FROM (
     SELECT 1 FROM public.roster_entries re JOIN public.teams t ON t.id = re.team_id
      GROUP BY t.league_id, re.player_id HAVING COUNT(*) > 1) d), '0',
  'Should be impossible. Any row here is scoring for two clubs at once.'
UNION ALL SELECT 12, 'B · AUDIT', '>> Rebates wrongly paid on sales',
  (SELECT COUNT(*)::text FROM public.transactions tr
    WHERE tr.type = 'rebate' AND EXISTS (
      SELECT 1 FROM public.waiver_claims wc
       WHERE wc.player_id = tr.player_id AND wc.league_id = tr.league_id
         AND wc.sale_listing_id IS NOT NULL AND wc.status = 'approved')), '0',
  'Budget created from nothing on private sales.'
UNION ALL SELECT 13, 'B · AUDIT', 'Listings stuck active (blocking trades)',
  (SELECT COUNT(*)::text FROM public.player_sale_listings l
    WHERE l.status = 'active'
      AND EXISTS (SELECT 1 FROM public.waiver_claims wc
                   WHERE wc.sale_listing_id = l.id AND wc.status <> 'pending')), '0',
  'Auction settled but listing never closed — player permanently untradeable.'

-- ── C. 077 gates ────────────────────────────────────────────
UNION ALL SELECT 20, 'C · 077', 'Gate columns added',
  (SELECT COUNT(*)::text FROM information_schema.columns
    WHERE table_schema='public' AND table_name='player_sale_listings'
      AND column_name IN ('open_to_trade','open_to_sale','ask_price')), '3', ''
UNION ALL SELECT 21, 'C · 077', 'Gate CHECK constraints present',
  (SELECT COUNT(*)::text FROM pg_constraint
    WHERE conrelid='public.player_sale_listings'::regclass
      AND conname IN ('player_sale_listings_buy_now_gt_min',
                      'player_sale_listings_ask_requires_price',
                      'player_sale_listings_gate_order')), '3', ''
UNION ALL SELECT 22, 'C · 077', 'Constraints VALIDATED (enforcing on old rows)',
  (SELECT COUNT(*)::text FROM pg_constraint
    WHERE conrelid='public.player_sale_listings'::regclass
      AND conname IN ('player_sale_listings_buy_now_gt_min',
                      'player_sale_listings_ask_requires_price',
                      'player_sale_listings_gate_order')
      AND convalidated), '3',
  'Added NOT VALID so the migration could not fail. See rows 25-27, then VALIDATE.'
UNION ALL SELECT 23, 'C · 077', '80%-of-market-value floor trigger',
  (SELECT COUNT(*)::text FROM pg_trigger
    WHERE tgrelid='public.player_sale_listings'::regclass
      AND tgname='trg_listing_min_bid_floor'), '1', ''
UNION ALL SELECT 24, 'C · 077', 'trade_proposals.sale_listing_id',
  (SELECT COUNT(*)::text FROM information_schema.columns
    WHERE table_schema='public' AND table_name='trade_proposals'
      AND column_name='sale_listing_id'), '1', ''
UNION ALL SELECT 25, 'C · 077', 'Proposal RLS tightened (own-or-settled)',
  (SELECT COUNT(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename='trade_proposals'
      AND policyname='Trade proposals: read own or settled'), '1',
  'Must land before Realtime publishes this table.'
UNION ALL SELECT 26, 'C · 077', 'Rows violating buy_now > min_bid',
  (SELECT COUNT(*)::text FROM public.player_sale_listings
    WHERE buy_now_price IS NOT NULL AND buy_now_price <= min_bid), '0',
  'Must be 0 before you VALIDATE the constraints.'
UNION ALL SELECT 27, 'C · 077', 'Rows violating ask/gate ordering',
  (SELECT COUNT(*)::text FROM public.player_sale_listings
    WHERE (open_to_sale AND ask_price IS NULL)
       OR (ask_price IS NOT NULL AND (ask_price < min_bid
           OR (buy_now_price IS NOT NULL AND ask_price >= buy_now_price)))), '0',
  'Must be 0 before you VALIDATE the constraints.'

-- ── D. 078 projection + realtime ────────────────────────────
UNION ALL SELECT 30, 'D · 078', 'auction_state table exists',
  (SELECT COUNT(*)::text FROM information_schema.tables
    WHERE table_schema='public' AND table_name='auction_state'), '1', ''
UNION ALL SELECT 31, 'D · 078', 'Live auctions projected (info, not pass/fail)',
  (SELECT COUNT(*)::text FROM public.auction_state WHERE status='live'), 'info',
  'This is what the new board will show. Compare to what you expect.'
UNION ALL SELECT 32, 'D · 078', 'Open auctions MISSING from projection',
  (SELECT COUNT(*)::text FROM public.waiver_claims wc
    LEFT JOIN public.auction_state a ON a.league_id=wc.league_id AND a.player_id=wc.player_id
   WHERE wc.is_auction AND wc.status='pending' AND wc.team_id IS NULL
     AND (a.player_id IS NULL OR a.status <> 'live')), '0',
  'Backfill gap — board would miss these.'
UNION ALL SELECT 33, 'D · 078', 'Projection high-bid mismatches',
  (SELECT COUNT(*)::text FROM (
     SELECT a.player_id FROM public.auction_state a
       JOIN public.waiver_claims wc ON wc.league_id=a.league_id AND wc.player_id=a.player_id
        AND wc.team_id IS NOT NULL AND wc.is_auction AND wc.status='pending'
      WHERE a.status='live'
      GROUP BY a.player_id, a.highest_bid HAVING a.highest_bid <> MAX(wc.faab_bid)) d), '0', ''
UNION ALL SELECT 34, 'D · 078', 'Projection triggers on waiver_claims',
  (SELECT COUNT(*)::text FROM pg_trigger
    WHERE tgrelid='public.waiver_claims'::regclass
      AND tgname IN ('trg_auction_state_ins','trg_auction_state_upd','trg_auction_state_del')), '3', ''
UNION ALL SELECT 35, 'D · 078', 'Tables on supabase_realtime publication',
  (SELECT COUNT(*)::text FROM pg_publication_tables
    WHERE pubname='supabase_realtime'
      AND tablename IN ('auction_state','player_sale_listings','trade_proposals')), '3',
  'If 0, Realtime is likely not enabled on this project — the DO block skipped it.'
UNION ALL SELECT 36, 'D · 078', 'auction_state write policies (must be none)',
  (SELECT COUNT(*)::text FROM pg_policies
    WHERE schemaname='public' AND tablename='auction_state' AND cmd <> 'SELECT'), '0',
  'Only the SECURITY DEFINER trigger and service role should write.'

-- ── E. 079 unified bid RPC ──────────────────────────────────
UNION ALL SELECT 40, 'E · 079', 'place_auction_bid_rpc overloads',
  (SELECT COUNT(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
    WHERE n.nspname='public' AND p.proname='place_auction_bid_rpc'), '1',
  '2 means the old 7-arg version survived — calls become ambiguous and WILL error.'
UNION ALL SELECT 41, 'E · 079', 'Free-agent guard present',
  COALESCE((SELECT (prosrc LIKE '%is not listed for sale%')::text FROM bidfn), 'FUNCTION MISSING'), 'true',
  'Stops bidding on a rostered player and duplicating him.'
UNION ALL SELECT 42, 'E · 079', 'Buy Now handled in-RPC',
  COALESCE((SELECT (prosrc LIKE '%is_buy_now%')::text FROM bidfn), 'FUNCTION MISSING'), 'true', ''
UNION ALL SELECT 43, 'E · 079', 'Offers cancelled inside bid transaction',
  COALESCE((SELECT (prosrc LIKE '%trade_proposals%')::text FROM bidfn), 'FUNCTION MISSING'), 'true',
  'Closes the double-sale race.'
UNION ALL SELECT 44, 'E · 079', 'Trade-vs-listing guard trigger',
  (SELECT COUNT(*)::text FROM pg_trigger
    WHERE tgrelid='public.trade_proposals'::regclass
      AND tgname='trg_guard_trade_against_listings'), '1', ''
)
SELECT
  section,
  check_name,
  result,
  CASE
    WHEN expected = 'info'   THEN '—'
    WHEN result = expected   THEN 'PASS'
    ELSE '*** FAIL ***'
  END AS status,
  notes
FROM r
ORDER BY ord;
