-- Gaffa — verification after 080 + 081 + constraint validation
--
-- One query, one grid. Same format as before: anything not PASS is explained.
--
-- Note this script pins the resolver lookup with pronargs = 3 rather than
-- LIMIT 1. The earlier script's LIMIT 1 had no ORDER BY and silently read the
-- orphaned 2-argument overload, which is what produced the false Section A
-- failures. 081 drops that orphan, but the pin stays so the check cannot lie again.

WITH
fn AS (
  SELECT p.prosrc, p.proacl
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'resolve_single_player_auction_rpc'
    AND p.pronargs = 3
),
r AS (

-- ── 081: the orphan is gone, the survivor is locked down ────
SELECT 1 AS ord, 'F · 081' AS section, 'Resolver overloads remaining' AS check_name,
  (SELECT COUNT(*)::text FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname='public' AND p.proname='resolve_single_player_auction_rpc') AS result,
  '1' AS expected,
  'The 2-arg orphan carried the pre-059 broken body.' AS notes
UNION ALL SELECT 2, 'F · 081', 'Survivor has the 076 sale logic',
  COALESCE((SELECT (prosrc LIKE '%v_is_sale_listing%')::text FROM fn), 'MISSING'), 'true', ''
UNION ALL SELECT 3, 'F · 081', 'Resolver not callable by anon/authenticated',
  COALESCE((SELECT (proacl IS NOT NULL
                    AND array_to_string(proacl, ',') NOT LIKE '%anon=%'
                    AND array_to_string(proacl, ',') NOT LIKE '%authenticated=%')::text
            FROM fn), 'MISSING'), 'true',
  'false here means a client could invoke roster/budget changes directly.'

-- ── 077: constraints now enforcing ──────────────────────────
UNION ALL SELECT 10, 'C · 077', 'Gate constraints VALIDATED',
  (SELECT COUNT(*)::text FROM pg_constraint
    WHERE conrelid='public.player_sale_listings'::regclass
      AND conname IN ('player_sale_listings_buy_now_gt_min',
                      'player_sale_listings_ask_requires_price',
                      'player_sale_listings_gate_order')
      AND convalidated), '3', 'Was 0 before; should now be 3.'

-- ── 080: every listing is an auction ────────────────────────
UNION ALL SELECT 20, 'G · 080', 'Anchor-seed trigger installed',
  (SELECT COUNT(*)::text FROM pg_trigger
    WHERE tgrelid='public.player_sale_listings'::regclass
      AND tgname='trg_seed_listing_auction_anchor'), '1', ''
UNION ALL SELECT 21, 'G · 080', 'Withdraw trigger installed',
  (SELECT COUNT(*)::text FROM pg_trigger
    WHERE tgrelid='public.player_sale_listings'::regclass
      AND tgname='trg_withdraw_listing_auction_anchor'), '1', ''
UNION ALL SELECT 22, 'G · 080', 'Open listings with NO anchor',
  (SELECT COUNT(*)::text FROM public.player_sale_listings l
    WHERE l.status IN ('pending','active')
      AND NOT EXISTS (SELECT 1 FROM public.waiver_claims wc
                       WHERE wc.sale_listing_id = l.id AND wc.team_id IS NULL
                         AND wc.is_auction AND wc.status='pending')), '0',
  'Backfill gap — these listings would show no auction and no clock.'
UNION ALL SELECT 23, 'G · 080', 'Open listings missing from the board',
  (SELECT COUNT(*)::text FROM public.player_sale_listings l
    WHERE l.status IN ('pending','active')
      AND NOT EXISTS (SELECT 1 FROM public.auction_state a
                       WHERE a.league_id=l.league_id AND a.player_id=l.player_id
                         AND a.status='live' AND a.kind='listing')), '0', ''
UNION ALL SELECT 24, 'G · 080', 'Anchors outliving a closed listing',
  (SELECT COUNT(*)::text FROM public.waiver_claims wc
     JOIN public.player_sale_listings l ON l.id = wc.sale_listing_id
    WHERE wc.status='pending' AND wc.is_auction AND wc.team_id IS NULL
      AND l.status NOT IN ('pending','active')), '0',
  'Would resolve an auction for a player already moved.'

-- ── H. Board health — is 172 a real number? ─────────────────
UNION ALL SELECT 30, 'H · HEALTH', 'Open listings (info)',
  (SELECT COUNT(*)::text FROM public.player_sale_listings
    WHERE status IN ('pending','active')), 'info', ''
UNION ALL SELECT 31, 'H · HEALTH', 'Live auctions · free agent (info)',
  (SELECT COUNT(*)::text FROM public.auction_state
    WHERE status='live' AND kind='free_agent'), 'info', ''
UNION ALL SELECT 32, 'H · HEALTH', 'Live auctions · listing (info)',
  (SELECT COUNT(*)::text FROM public.auction_state
    WHERE status='live' AND kind='listing'), 'info', ''
UNION ALL SELECT 33, 'H · HEALTH', '>> Live auctions ALREADY EXPIRED',
  (SELECT COUNT(*)::text FROM public.auction_state
    WHERE status='live' AND expires_at < NOW()), '0',
  'Past their clock but unresolved. Non-zero = the process-auctions cron is not running.'
UNION ALL SELECT 34, 'H · HEALTH', 'Oldest unresolved auction, days overdue (info)',
  COALESCE((SELECT ROUND(EXTRACT(EPOCH FROM (NOW() - MIN(expires_at)))/86400)::text
            FROM public.auction_state WHERE status='live' AND expires_at < NOW()), 'none'),
  'info', 'If this is large, auctions have been piling up unresolved for a while.'
UNION ALL SELECT 35, 'H · HEALTH', 'Live auctions with zero bids (info)',
  (SELECT COUNT(*)::text FROM public.auction_state
    WHERE status='live' AND bid_count = 0), 'info',
  'System-seeded auctions nobody has bid on. Large here is normal after a sync.'
)
SELECT section, check_name, result,
  CASE WHEN expected='info' THEN '—'
       WHEN result=expected THEN 'PASS'
       ELSE '*** FAIL ***' END AS status,
  notes
FROM r
ORDER BY ord;
