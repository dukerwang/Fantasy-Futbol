-- Gaffa — Migration 078: auction_state, a live read model for the Transfers hub
--
-- WHY A PROJECTION TABLE RATHER THAN SUBSCRIBING TO waiver_claims
--
-- The hub replaces 15-second polling with Supabase Realtime, but the auction
-- data lives in `waiver_claims`, whose SELECT policy (001_initial_schema.sql:421)
-- is:
--
--     USING (EXISTS (SELECT 1 FROM teams t
--                     WHERE t.id = team_id AND t.user_id = auth.uid()))
--
-- — a manager can read only their OWN bids, and the system anchor row (team_id
-- IS NULL, the row that actually holds expires_at) is readable by nobody.
-- postgres_changes enforces RLS, so a subscription there would deliver almost
-- nothing.
--
-- Relaxing that policy is the wrong fix: it would newly expose `drop_player_id`,
-- the one genuinely private field in the auction system — who you plan to cut if
-- you win. Everything in the table below is ALREADY public in today's UI: the
-- bid history panel renders every bidder's club and amount to every league
-- member. So this projection leaks nothing new while making the board live.
--
-- WHY A TRIGGER RATHER THAN APPLICATION CODE
--
-- Auction claims are written from roughly ten places: place_auction_bid_rpc
-- (054), the listing bid route, executeDrop.ts, seasonKickoff.ts,
-- seedHighValueAuctions.ts, departures/decisions.ts, kickoffPreflight.ts,
-- syncPlayers.ts, scripts/sync_transfermarkt.ts, and the resolver's bulk status
-- update. Maintaining a projection from the application would have to be
-- remembered at every one of them, forever. A trigger cannot be forgotten.
--
-- WHY STATEMENT-LEVEL
--
-- The resolver rejects every losing bid in a single statement
-- (UPDATE ... WHERE league_id = ? AND player_id = ?). A FOR EACH ROW trigger
-- would fire once per losing bid and recompute the same aggregate each time.
-- Statement-level triggers with transition tables collapse that to one refresh.
-- Postgres will not let one trigger reference both OLD TABLE and NEW TABLE
-- across a mixed event list, hence three triggers rather than one.

-- ── 1. The projection ────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.auction_state (
  league_id               UUID NOT NULL REFERENCES public.leagues(id) ON DELETE CASCADE,
  player_id               UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,

  -- 'listing' when a seller put this player up; 'free_agent' otherwise.
  kind                    TEXT NOT NULL DEFAULT 'free_agent'
                          CHECK (kind IN ('free_agent', 'listing')),

  -- Soft close. See the note on DELETE below — resolution is an UPDATE.
  status                  TEXT NOT NULL DEFAULT 'live'
                          CHECK (status IN ('live', 'resolved')),

  sale_listing_id         UUID REFERENCES public.player_sale_listings(id) ON DELETE SET NULL,
  seller_team_id          UUID REFERENCES public.teams(id) ON DELETE SET NULL,

  highest_bid             INTEGER NOT NULL DEFAULT 0,
  highest_bidder_team_id  UUID REFERENCES public.teams(id) ON DELETE SET NULL,
  bid_count               INTEGER NOT NULL DEFAULT 0,

  -- [{ team_id, team_name, amount, at }], highest first. Included deliberately:
  -- the card renders full bid history, and it is already public. Leaving it out
  -- would force a refetch on every single bid, defeating the point of realtime.
  bids                    JSONB NOT NULL DEFAULT '[]'::JSONB,

  first_bid_at            TIMESTAMPTZ,
  expires_at              TIMESTAMPTZ,
  market_value_at_auction NUMERIC,
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Mirrors idx_waiver_claims_system_auction (010:61-63): one live auction per
  -- player per league. The projection cannot represent two, and neither can the
  -- source.
  PRIMARY KEY (league_id, player_id)
);

CREATE INDEX IF NOT EXISTS idx_auction_state_league_status
  ON public.auction_state (league_id, status);

CREATE INDEX IF NOT EXISTS idx_auction_state_expires
  ON public.auction_state (expires_at)
  WHERE status = 'live';

COMMENT ON TABLE public.auction_state IS
  'Realtime read model for live auctions, maintained by triggers on waiver_claims. Never written by application code.';

-- ── 2. The refresh function ──────────────────────────────────

CREATE OR REPLACE FUNCTION public.refresh_auction_state(
  p_league_id UUID,
  p_player_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_anchor        RECORD;
  v_highest_bid   INTEGER := 0;
  v_highest_team  UUID    := NULL;
  v_bid_count     INTEGER := 0;
  v_bids          JSONB   := '[]'::JSONB;
  v_kind          TEXT;
  v_seller        UUID    := NULL;
BEGIN
  -- The anchor is the auction. It carries the clock.
  SELECT wc.expires_at, wc.first_bid_at, wc.sale_listing_id, wc.market_value_at_auction
  INTO v_anchor
  FROM public.waiver_claims wc
  WHERE wc.league_id = p_league_id
    AND wc.player_id = p_player_id
    AND wc.team_id IS NULL
    AND wc.is_auction = TRUE
    AND wc.status = 'pending';

  IF NOT FOUND THEN
    -- Auction is over (or never existed). Mark any row resolved rather than
    -- deleting it: Supabase does not RLS-filter postgres_changes DELETE events,
    -- and a DELETE payload carries only replica-identity columns, so the client
    -- would receive an unfiltered, contentless event. An UPDATE stays filtered
    -- and gives the board something to animate out with.
    UPDATE public.auction_state
    SET status = 'resolved', updated_at = NOW()
    WHERE league_id = p_league_id
      AND player_id = p_player_id
      AND status <> 'resolved';
    RETURN;
  END IF;

  -- Real manager bids, one row per team.
  SELECT
    COALESCE(MAX(wc.faab_bid), 0),
    COUNT(*),
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'team_id',   wc.team_id,
          'team_name', t.team_name,
          'amount',    wc.faab_bid,
          'at',        wc.created_at
        )
        ORDER BY wc.faab_bid DESC, wc.created_at ASC
      ),
      '[]'::JSONB
    )
  INTO v_highest_bid, v_bid_count, v_bids
  FROM public.waiver_claims wc
  JOIN public.teams t ON t.id = wc.team_id
  WHERE wc.league_id = p_league_id
    AND wc.player_id = p_player_id
    AND wc.team_id IS NOT NULL
    AND wc.is_auction = TRUE
    AND wc.status = 'pending';

  IF v_bid_count > 0 THEN
    SELECT wc.team_id INTO v_highest_team
    FROM public.waiver_claims wc
    WHERE wc.league_id = p_league_id
      AND wc.player_id = p_player_id
      AND wc.team_id IS NOT NULL
      AND wc.is_auction = TRUE
      AND wc.status = 'pending'
    ORDER BY wc.faab_bid DESC, wc.created_at ASC
    LIMIT 1;
  END IF;

  IF v_anchor.sale_listing_id IS NOT NULL THEN
    v_kind := 'listing';
    SELECT seller_team_id INTO v_seller
    FROM public.player_sale_listings
    WHERE id = v_anchor.sale_listing_id;
  ELSE
    v_kind := 'free_agent';
  END IF;

  INSERT INTO public.auction_state (
    league_id, player_id, kind, status, sale_listing_id, seller_team_id,
    highest_bid, highest_bidder_team_id, bid_count, bids,
    first_bid_at, expires_at, market_value_at_auction, updated_at
  ) VALUES (
    p_league_id, p_player_id, v_kind, 'live', v_anchor.sale_listing_id, v_seller,
    v_highest_bid, v_highest_team, v_bid_count, v_bids,
    v_anchor.first_bid_at, v_anchor.expires_at, v_anchor.market_value_at_auction, NOW()
  )
  ON CONFLICT (league_id, player_id) DO UPDATE
  SET kind                    = EXCLUDED.kind,
      status                  = 'live',
      sale_listing_id         = EXCLUDED.sale_listing_id,
      seller_team_id          = EXCLUDED.seller_team_id,
      highest_bid             = EXCLUDED.highest_bid,
      highest_bidder_team_id  = EXCLUDED.highest_bidder_team_id,
      bid_count               = EXCLUDED.bid_count,
      bids                    = EXCLUDED.bids,
      first_bid_at            = EXCLUDED.first_bid_at,
      expires_at              = EXCLUDED.expires_at,
      market_value_at_auction = EXCLUDED.market_value_at_auction,
      updated_at              = NOW();
END;
$$;

-- ── 3. Statement-level triggers over transition tables ───────

CREATE OR REPLACE FUNCTION public.auction_state_from_new()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT league_id, player_id FROM newrows WHERE is_auction LOOP
    PERFORM public.refresh_auction_state(r.league_id, r.player_id);
  END LOOP;
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.auction_state_from_old()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT DISTINCT league_id, player_id FROM oldrows WHERE is_auction LOOP
    PERFORM public.refresh_auction_state(r.league_id, r.player_id);
  END LOOP;
  RETURN NULL;
END; $$;

-- An UPDATE can move a row between auctions or flip is_auction, so both sides
-- of the transition need refreshing.
CREATE OR REPLACE FUNCTION public.auction_state_from_both()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT league_id, player_id FROM (
      SELECT league_id, player_id, is_auction FROM oldrows
      UNION
      SELECT league_id, player_id, is_auction FROM newrows
    ) s WHERE is_auction
  LOOP
    PERFORM public.refresh_auction_state(r.league_id, r.player_id);
  END LOOP;
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_auction_state_ins ON public.waiver_claims;
CREATE TRIGGER trg_auction_state_ins
  AFTER INSERT ON public.waiver_claims
  REFERENCING NEW TABLE AS newrows
  FOR EACH STATEMENT EXECUTE FUNCTION public.auction_state_from_new();

DROP TRIGGER IF EXISTS trg_auction_state_upd ON public.waiver_claims;
CREATE TRIGGER trg_auction_state_upd
  AFTER UPDATE ON public.waiver_claims
  REFERENCING OLD TABLE AS oldrows NEW TABLE AS newrows
  FOR EACH STATEMENT EXECUTE FUNCTION public.auction_state_from_both();

DROP TRIGGER IF EXISTS trg_auction_state_del ON public.waiver_claims;
CREATE TRIGGER trg_auction_state_del
  AFTER DELETE ON public.waiver_claims
  REFERENCING OLD TABLE AS oldrows
  FOR EACH STATEMENT EXECUTE FUNCTION public.auction_state_from_old();

-- ── 4. RLS: league members read, nobody writes ───────────────

ALTER TABLE public.auction_state ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Auction state: read if league member" ON public.auction_state;
CREATE POLICY "Auction state: read if league member"
  ON public.auction_state FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.teams t
      WHERE t.league_id = auction_state.league_id
        AND t.user_id = auth.uid()
    )
  );

-- No INSERT/UPDATE/DELETE policies on purpose. The trigger functions are
-- SECURITY DEFINER and the service role bypasses RLS; nothing else should ever
-- write here.

-- The policy runs per subscriber per change, so this index is load-bearing for
-- realtime fan-out, not just for queries.
CREATE INDEX IF NOT EXISTS idx_teams_league_user ON public.teams (league_id, user_id);

-- ── 5. Backfill ──────────────────────────────────────────────
--
-- Without this the board is empty on first load after deploy for every auction
-- that is already running.

DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT league_id, player_id
    FROM public.waiver_claims
    WHERE is_auction = TRUE
      AND status = 'pending'
      AND team_id IS NULL
  LOOP
    PERFORM public.refresh_auction_state(r.league_id, r.player_id);
  END LOOP;
END $$;

-- ── 6. Realtime publication ──────────────────────────────────
--
-- ALTER PUBLICATION ... ADD TABLE errors if the table is already a member, so
-- each is wrapped individually — otherwise re-running this file, or running it
-- after someone added a table through the dashboard, aborts everything after the
-- first duplicate.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    RAISE NOTICE 'Publication supabase_realtime not found — skipping. Enable Realtime in the Supabase dashboard, then re-run this block.';
    RETURN;
  END IF;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.auction_state;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.player_sale_listings;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;

  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.trade_proposals;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- DEFAULT replica identity (primary key) is enough: every event the hub cares
-- about is an INSERT or UPDATE, and both carry the full new row. auction_state
-- is never deleted by design; the other two are only ever soft-transitioned.
ALTER TABLE public.auction_state        REPLICA IDENTITY DEFAULT;
ALTER TABLE public.player_sale_listings REPLICA IDENTITY DEFAULT;
ALTER TABLE public.trade_proposals      REPLICA IDENTITY DEFAULT;


-- ============================================================
-- POST-APPLY CHECKS
-- ============================================================
--
--   -- Projection matches the source (should return zero rows):
--   SELECT wc.league_id, wc.player_id
--     FROM public.waiver_claims wc
--     LEFT JOIN public.auction_state a
--       ON a.league_id = wc.league_id AND a.player_id = wc.player_id
--    WHERE wc.is_auction AND wc.status = 'pending' AND wc.team_id IS NULL
--      AND (a.player_id IS NULL OR a.status <> 'live');
--
--   -- Highest bid agrees with the source (should return zero rows):
--   SELECT a.player_id, a.highest_bid, MAX(wc.faab_bid) AS actual
--     FROM public.auction_state a
--     JOIN public.waiver_claims wc
--       ON wc.league_id = a.league_id AND wc.player_id = a.player_id
--      AND wc.team_id IS NOT NULL AND wc.is_auction AND wc.status = 'pending'
--    WHERE a.status = 'live'
--    GROUP BY a.player_id, a.highest_bid
--   HAVING a.highest_bid <> MAX(wc.faab_bid);
--
--   -- Publication membership:
--   SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime';
