'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import { useTick } from './useTick';
import type {
  TransfersModel,
  TransfersAuction,
  TransfersListing,
  TradeProposalRow,
  LoanRow,
  ResolvedAuction,
  AuctionBidEntry,
} from '@/lib/transfers/buildTransfersModel';

/**
 * Live-patches the Transfers hub over Supabase Realtime.
 *
 * `auction_state`, `player_sale_listings`, `trade_proposals` and
 * `player_loans` are already on the `supabase_realtime` publication
 * (migrations 078, 101) — this is the first client to actually subscribe to
 * them for the hub itself (chat's `chat_negotiations` channel is a separate,
 * narrower case — see ChatClient.tsx). `model` from the server render stays
 * the source of truth: a `router.refresh()` re-seeds the patch on top of it,
 * matching the pattern in DraftRoom.tsx.
 *
 * Also drives near-instant auction resolution: any viewer whose local clock
 * crosses a live auction's `expires_at` fires the resolve endpoint once. The
 * resulting `auction_state` UPDATE is realtime-pushed to every viewer, so
 * only one of them needs to do this.
 */
export function useLiveTransfers(leagueId: string, model: TransfersModel): TransfersModel {
  const router = useRouter();

  const [auctions, setAuctions] = useState(model.auctions);
  const [recentlyResolved, setRecentlyResolved] = useState(model.recentlyResolved);
  const [listings, setListings] = useState(model.listings);
  const [myOffers, setMyOffers] = useState(model.myOffers);
  const [leagueFeed, setLeagueFeed] = useState(model.leagueFeed);
  const [loans, setLoans] = useState(model.loans);

  // A server refresh is always the new truth — reset every live patch on top of it.
  useEffect(() => {
    setAuctions(model.auctions);
    setRecentlyResolved(model.recentlyResolved);
    setListings(model.listings);
    setMyOffers(model.myOffers);
    setLeagueFeed(model.leagueFeed);
    setLoans(model.loans);
  }, [model]);

  // Read-only context the row mappers need, kept fresh every render (not just
  // on refresh) so a mapper never closes over stale team/listing/player data.
  const ctxRef = useRef({
    allTeams: model.allTeams,
    playerMap: model.playerMap,
    myTeamId: model.myTeam.id,
    listings,
  });
  ctxRef.current = { allTeams: model.allTeams, playerMap: model.playerMap, myTeamId: model.myTeam.id, listings };

  // A row referencing a player this page has never seen (a brand-new auction,
  // listing, or trade for a player outside the initial fetch) can't be
  // rendered from local data — fall back to one refresh rather than a bespoke
  // fetch, debounced so a burst of such rows only refreshes once.
  const refreshPendingRef = useRef(false);
  const requestRefresh = () => {
    if (refreshPendingRef.current) return;
    refreshPendingRef.current = true;
    router.refresh();
  };
  useEffect(() => { refreshPendingRef.current = false; }, [model]);

  useEffect(() => {
    const supabase = createClient();
    const teamName = (id: string | null): string | null => {
      if (!id) return null;
      return ctxRef.current.allTeams.find((t) => t.id === id)?.team_name ?? null;
    };

    const handleAuctionRow = (row: AuctionStateRow) => {
      if (row.status === 'resolved') {
        setAuctions((prev) => prev.filter((a) => a.player_id !== row.player_id));
        const player = ctxRef.current.playerMap[row.player_id] ?? null;
        const resolved: ResolvedAuction = {
          player_id: row.player_id,
          player,
          kind: row.kind,
          winning_bid: row.highest_bid ?? 0,
          winner_team_id: row.highest_bidder_team_id,
          winner_team_name: teamName(row.highest_bidder_team_id),
          bid_count: row.bid_count ?? 0,
          settled_at: row.updated_at,
        };
        setRecentlyResolved((prev) => [resolved, ...prev.filter((r) => r.player_id !== row.player_id)]);
        return;
      }

      const player = ctxRef.current.playerMap[row.player_id];
      if (!player) return requestRefresh();

      const bids: AuctionBidEntry[] = Array.isArray(row.bids) ? row.bids : [];
      const listing = row.sale_listing_id
        ? ctxRef.current.listings.find((l) => l.id === row.sale_listing_id)
        : undefined;
      const marketValue = Number(player.market_value ?? row.market_value_at_auction ?? 0);

      const bidFloor = Number(model.league.free_agent_bid_floor) || 0.5;

      const mapped: TransfersAuction = {
        player_id: row.player_id,
        player,
        kind: row.kind,
        sale_listing_id: row.sale_listing_id,
        seller_team_id: row.seller_team_id,
        seller_team_name: teamName(row.seller_team_id),
        highest_bid: row.highest_bid ?? 0,
        highest_bidder_team_id: row.highest_bidder_team_id,
        highest_bidder_team_name: teamName(row.highest_bidder_team_id),
        bid_count: row.bid_count ?? 0,
        bids,
        minimum_bid: listing ? listing.min_bid : Math.floor(marketValue * bidFloor),
        first_bid_at: row.first_bid_at,
        expires_at: row.expires_at,
        opens_at: row.opens_at ?? null,
        market_value_at_auction: row.market_value_at_auction,
        my_bid: bids.find((b) => b.team_id === ctxRef.current.myTeamId)?.amount ?? null,
        my_drop_player_id: null,
      };

      setAuctions((prev) => {
        if (mapped.kind === 'listing' && (mapped.bid_count ?? 0) === 0) {
          return prev.filter((a) => a.player_id !== row.player_id);
        }
        const idx = prev.findIndex((a) => a.player_id === row.player_id);
        if (idx === -1) return [mapped, ...prev];
        // Drop-player nomination is deliberately absent from the public
        // projection (078) — carry the caller's own prior value forward.
        mapped.my_drop_player_id = prev[idx].my_drop_player_id;
        const copy = [...prev];
        copy[idx] = mapped;
        return copy;
      });
    };

    const handleListingRow = (row: ListingRow) => {
      const player = ctxRef.current.playerMap[row.player_id];
      if (!player) return requestRefresh();
      const mapped: TransfersListing = {
        id: row.id,
        seller_team_id: row.seller_team_id,
        seller_team_name: teamName(row.seller_team_id),
        player_id: row.player_id,
        player,
        min_bid: row.min_bid,
        ask_price: row.ask_price,
        buy_now_price: row.buy_now_price,
        open_to_trade: row.open_to_trade,
        open_to_sale: row.open_to_sale,
        open_to_loan: row.open_to_loan,
        status: row.status,
        auction_expires_at: row.auction_expires_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
      };
      setListings((prev) => {
        const idx = prev.findIndex((l) => l.id === row.id);
        if (idx === -1) return [mapped, ...prev];
        const copy = [...prev];
        copy[idx] = mapped;
        return copy;
      });
    };

    const handleTradeRow = (row: TradeProposalRawRow) => {
      const mapped = {
        ...row,
        team_a: { id: row.team_a_id, team_name: teamName(row.team_a_id) ?? '' },
        team_b: { id: row.team_b_id, team_name: teamName(row.team_b_id) ?? '' },
      } as TradeProposalRow;

      const mine = row.team_a_id === ctxRef.current.myTeamId || row.team_b_id === ctxRef.current.myTeamId;
      setMyOffers((prev) => {
        const filtered = prev.filter((o) => o.id !== row.id);
        return mine ? [mapped, ...filtered] : filtered;
      });

      const settled = row.status === 'accepted' || row.status === 'accepted_deferred';
      setLeagueFeed((prev) => {
        const filtered = prev.filter((o) => o.id !== row.id);
        return settled ? [mapped, ...filtered] : filtered;
      });
    };

    const handleLoanRow = (row: LoanRawRow) => {
      const player = ctxRef.current.playerMap[row.player_id] ?? null;
      const mapped = {
        ...row,
        lender_team: { id: row.lender_team_id, team_name: teamName(row.lender_team_id) },
        borrower_team: { id: row.borrower_team_id, team_name: teamName(row.borrower_team_id) },
        player,
      } as unknown as LoanRow;

      const mine = row.lender_team_id === ctxRef.current.myTeamId || row.borrower_team_id === ctxRef.current.myTeamId;
      setLoans((prev) => {
        const filtered = prev.filter((l) => l.id !== row.id);
        return mine ? [mapped, ...filtered] : filtered;
      });
    };

    const channel = supabase
      .channel(`transfers:${leagueId}`)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'auction_state', filter: `league_id=eq.${leagueId}` }, (p) => handleAuctionRow(p.new as AuctionStateRow))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'auction_state', filter: `league_id=eq.${leagueId}` }, (p) => handleAuctionRow(p.new as AuctionStateRow))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'player_sale_listings', filter: `league_id=eq.${leagueId}` }, (p) => handleListingRow(p.new as ListingRow))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'player_sale_listings', filter: `league_id=eq.${leagueId}` }, (p) => handleListingRow(p.new as ListingRow))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'trade_proposals', filter: `league_id=eq.${leagueId}` }, (p) => handleTradeRow(p.new as TradeProposalRawRow))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'trade_proposals', filter: `league_id=eq.${leagueId}` }, (p) => handleTradeRow(p.new as TradeProposalRawRow))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'player_loans', filter: `league_id=eq.${leagueId}` }, (p) => handleLoanRow(p.new as LoanRawRow))
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'player_loans', filter: `league_id=eq.${leagueId}` }, (p) => handleLoanRow(p.new as LoanRawRow))
      .subscribe();

    return () => { supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId]);

  // Near-instant resolution: nudge any locally-held live auction whose clock
  // has run out. Deduped so a 1s tick doesn't refire every second. On deferral
  // or a failed poke, clear after 15s so listings still waiting on a kickoff
  // lock get retried instead of sitting on "settling" until cron happens to run.
  const hasLiveAuctions = auctions.some((a) => a.expires_at != null);
  const now = useTick(hasLiveAuctions);
  const resolvingRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    for (const a of auctions) {
      if (!a.expires_at || new Date(a.expires_at).getTime() > now) continue;
      if (resolvingRef.current.has(a.player_id)) continue;
      resolvingRef.current.add(a.player_id);
      fetch(`/api/leagues/${leagueId}/auctions/resolve-expired`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId: a.player_id }),
      })
        .then(async (res) => {
          const data = await res.json().catch(() => ({}));
          if (!res.ok || data.resolved !== true) {
            window.setTimeout(() => resolvingRef.current.delete(a.player_id), 15_000);
          }
        })
        .catch(() => {
          resolvingRef.current.delete(a.player_id);
        });
    }
  }, [now, auctions, leagueId]);

  return { ...model, auctions, recentlyResolved, listings, myOffers, leagueFeed, loans };
}

// ── Raw realtime row shapes (a subset of each table's columns) ─────────────

interface AuctionStateRow {
  player_id: string;
  kind: 'free_agent' | 'listing';
  status: 'live' | 'resolved';
  sale_listing_id: string | null;
  seller_team_id: string | null;
  highest_bid: number | null;
  highest_bidder_team_id: string | null;
  bid_count: number | null;
  bids: AuctionBidEntry[] | null;
  first_bid_at: string | null;
  expires_at: string | null;
  opens_at: string | null;
  market_value_at_auction: number | null;
  updated_at: string;
}

interface ListingRow {
  id: string;
  seller_team_id: string;
  player_id: string;
  min_bid: number | null;
  ask_price: number | null;
  buy_now_price: number | null;
  open_to_trade: boolean;
  open_to_sale: boolean;
  open_to_loan: boolean;
  status: TransfersListing['status'];
  auction_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TradeProposalRawRow {
  id: string;
  league_id: string;
  team_a_id: string;
  team_b_id: string;
  offered_players: string[];
  requested_players: string[];
  offered_rights: string[];
  requested_rights: string[];
  offered_faab: number;
  requested_faab: number;
  status: string;
  message: string | null;
  sale_listing_id: string | null;
  created_at: string;
  updated_at: string;
}

interface LoanRawRow {
  id: string;
  league_id: string;
  player_id: string;
  lender_team_id: string;
  borrower_team_id: string;
  status: string;
}
