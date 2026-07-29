-- Gaffa — diagnose the two failures from verify_076_079.sql
--
-- One query, one grid (the Supabase editor only renders the last statement).
-- Read c1..c5 per topic using the legend below.
--
--   RESOLVER          c1=signature  c2=has_sale_logic  c3=body_len  c4=owner  c5=last_modified_hint
--   DUPLICATE ROSTER  c1=player     c2=club            c3=acquired_via  c4=value  c5=acquired_at
--
-- RESOLVER: expect exactly ONE row. If there are two, the LIMIT 1 in the
-- previous script was reading the wrong overload and 076 is fine — the fix is to
-- drop the stale signature. If there is one row and c2 = false, 076 genuinely
-- did not apply.
--
-- DUPLICATE ROSTER: 2+ rows per player, one per club holding them. c3/c4/c5 say
-- how each club got them, which is what identifies the route in.

SELECT * FROM (

  SELECT 1 AS ord,
         'RESOLVER' AS topic,
         p.oid::regprocedure::text                              AS c1,
         (p.prosrc LIKE '%v_is_sale_listing%')::text            AS c2,
         length(p.prosrc)::text                                 AS c3,
         pg_get_userbyid(p.proowner)::text                      AS c4,
         CASE WHEN p.prosrc LIKE '%RESTORED (059)%'
              THEN 'has 076 markers' ELSE 'no 076 markers' END  AS c5
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = 'resolve_single_player_auction_rpc'

  UNION ALL

  -- Every roster row for any player held by 2+ clubs in the same league.
  SELECT 2,
         'DUPLICATE ROSTER',
         pl.name,
         t.team_name,
         re.acquisition_type::text,
         COALESCE(re.acquisition_value::text, '—'),
         to_char(re.acquired_at, 'YYYY-MM-DD HH24:MI')
  FROM public.roster_entries re
  JOIN public.teams t   ON t.id = re.team_id
  JOIN public.players pl ON pl.id = re.player_id
  WHERE (t.league_id, re.player_id) IN (
    SELECT t2.league_id, re2.player_id
    FROM public.roster_entries re2
    JOIN public.teams t2 ON t2.id = re2.team_id
    GROUP BY t2.league_id, re2.player_id
    HAVING COUNT(*) > 1
  )

  UNION ALL

  -- Any auction/listing history for those same players, to show the route in.
  SELECT 3,
         'CLAIM HISTORY',
         pl.name,
         COALESCE(t.team_name, '(system anchor)'),
         wc.status::text || CASE WHEN wc.sale_listing_id IS NOT NULL
                                 THEN ' · via listing' ELSE ' · free agent' END,
         wc.faab_bid::text,
         to_char(wc.created_at, 'YYYY-MM-DD HH24:MI')
  FROM public.waiver_claims wc
  JOIN public.players pl ON pl.id = wc.player_id
  LEFT JOIN public.teams t ON t.id = wc.team_id
  WHERE wc.is_auction
    AND (wc.league_id, wc.player_id) IN (
      SELECT t2.league_id, re2.player_id
      FROM public.roster_entries re2
      JOIN public.teams t2 ON t2.id = re2.team_id
      GROUP BY t2.league_id, re2.player_id
      HAVING COUNT(*) > 1
    )

  UNION ALL

  -- Transactions for those players, newest first — the paper trail.
  SELECT 4,
         'TRANSACTIONS',
         pl.name,
         COALESCE(t.team_name, '—'),
         tr.type::text,
         COALESCE(tr.faab_bid::text, '—'),
         to_char(tr.created_at, 'YYYY-MM-DD HH24:MI')
  FROM public.transactions tr
  JOIN public.players pl ON pl.id = tr.player_id
  LEFT JOIN public.teams t ON t.id = tr.team_id
  WHERE (tr.league_id, tr.player_id) IN (
    SELECT t2.league_id, re2.player_id
    FROM public.roster_entries re2
    JOIN public.teams t2 ON t2.id = re2.team_id
    GROUP BY t2.league_id, re2.player_id
    HAVING COUNT(*) > 1
  )

) d
ORDER BY ord, c1, c5;
