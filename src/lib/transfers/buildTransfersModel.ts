/**
 * buildTransfersModel — the whole Transfers hub in one server-side read.
 *
 * Replaces three overlapping fetch paths (`players/page.tsx`,
 * `trades/page.tsx`, `GET /auctions`) that each rebuilt the same shapes from
 * `waiver_claims` with ~50 lines of grouping apiece and disagreed on the
 * details. Auctions now come straight out of the `auction_state` projection
 * (migration 078), so the grouping loops are gone entirely — the aggregate is
 * maintained by trigger and cannot drift from its source.
 *
 * Deliberately does NOT ship the player catalogue. `players/page.tsx:171-196`
 * put every active Premier League player in the RSC payload and
 * `TransferMarketClient.tsx:222-227` re-downloaded all of it every 15 seconds.
 * Free agents are served separately, filtered and paginated, by
 * `GET /api/leagues/[leagueId]/transfers/free-agents`.
 */

import type { createAdminClient } from '@/lib/supabase/admin';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import {
  fetchEnrichmentMaps,
  enrichPlayer,
  type EnrichmentMaps,
  type StatOverrides,
} from './playerEnrichment';
import { buildEffectivePpgMap } from './effectivePpg';
import { getFplStatus } from '@/lib/fpl/api';
import { RIGHTS_HELD_STATUSES } from '@/lib/departures/types';
import type { Player, TradeProposal, Team } from '@/types';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * A proposal as the hub reads it — plus the listing link added by 077.
 *
 * `team_a`/`team_b` are re-declared because PostgREST's type inference models
 * every embed as an array, including to-one relations like these foreign keys.
 * At runtime they are single objects; the cast happens once, at the query.
 */
export interface TradeProposalRow extends Omit<TradeProposal, 'team_a' | 'team_b'> {
  sale_listing_id: string | null;
  team_a?: Pick<Team, 'id' | 'team_name'> | null;
  team_b?: Pick<Team, 'id' | 'team_name'> | null;
}

/** A roster_entries row with its embedded player, as selected below. */
interface RosterEntryRow {
  team_id: string;
  status: string;
  player: EnrichedPlayer | null;
}

/**
 * A loan row with its joined clubs and player. No shared type exists yet.
 *
 * The terms below are declared rather than left to the index signature because
 * the Deals page renders every one of them. Under `[key: string]: unknown` a
 * misspelled field would type-check as `unknown`, render as nothing, and look
 * like a €0 fee on a real loan.
 */
export interface LoanRow {
  id: string;
  league_id: string;
  player_id: string;
  lender_team_id: string;
  borrower_team_id: string;
  status: string;
  created_at: string;
  loan_fee: number;
  start_gameweek: number;
  end_gameweek: number;
  bonus_rate: number;
  bonus_cap: number;
  has_recall: boolean;
  slot_buyback_used: boolean;
  /** Roster status when the loan started. taxi restores to academy. */
  origin_status?: string | null;
  /** Who made the running. The OTHER side is the one who answers. */
  proposed_by: 'lender' | 'borrower';
  lender_team?: Pick<Team, 'id' | 'team_name'> & { user_id: string };
  borrower_team?: Pick<Team, 'id' | 'team_name'> & { user_id: string };
  player?: EnrichedPlayer | null;
}

// ── Model ─────────────────────────────────────────────────────

/**
 * A player row as this module hands it out: the `FULL_PLAYER_SELECT` columns
 * plus the rank/archive merge.
 *
 * `adp` and `form` are optional here because `FULL_PLAYER_SELECT` does not
 * select them — the draft's average-draft-position and the 5-GW points average
 * are not shown anywhere in the transfer UI. Declaring them required would be a
 * lie the compiler happily propagates to every consumer.
 */
export type EnrichedPlayer =
  Omit<Player, 'adp' | 'form'> & Partial<Pick<Player, 'adp' | 'form'>> & StatOverrides;

/** An enriched player as he sits on a roster. */
export interface RosterPlayer extends EnrichedPlayer {
  status: string;
  recent_ppg: number;
  listing: TransfersListing | null;
}

/**
 * A retained claim as the hub reads it — a `departure_decisions` row still
 * held by a club (status `retained` or `return_pending`), tradeable via
 * `offered_rights`/`requested_rights` on `trade_proposals`.
 *
 * Not a roster player: `id` is the decision id, not the player id — the same
 * player id can appear in both `myRoster` (never, while a right is held) and
 * here across different teams over the claim's lifetime.
 */
export interface TransfersRight {
  id: string;
  playerId: string;
  player: EnrichedPlayer | null;
  teamId: string;
  status: string;
  marketValueAtDeparture: number;
}

export interface TransfersListing {
  id: string;
  seller_team_id: string;
  seller_team_name?: string | null;
  player_id: string;
  player?: EnrichedPlayer | null;
  /** The auction floor. Null (114) means this listing has no open auction. */
  min_bid: number | null;
  ask_price: number | null;
  buy_now_price: number | null;
  open_to_trade: boolean;
  open_to_sale: boolean;
  open_to_loan: boolean;
  status: 'pending' | 'active' | 'sold' | 'expired' | 'cancelled';
  auction_expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TransfersLeague {
  id: string;
  name: string;
  roster_size: number | null;
  taxi_size: number | null;
  taxi_age_limit: number | null;
  status: string | null;
  roster_locked: boolean | null;
  total_gameweeks: number | null;
  current_season: string | null;
  previous_season: string | null;
  loan_slot_buyback_fee: number | null;
  loan_bonus_cap_default: number | null;
  max_loan_outs: number | null;
  max_loan_ins: number | null;
  free_agent_bid_floor: number | null;
}

export interface TransfersTeam {
  id: string;
  team_name: string;
  faab_budget: number;
  /** Short form for the crest disc on a listing card. Falls back to initials. */
  abbreviation: string | null;
  /** Shape consumed by <CrestBadge>; `unknown` because that component validates it. */
  crest_config: unknown | null;
}

/**
 * The numbers on the sub-nav (`Market · Listings n · Free Agency n · Deals n`).
 *
 * Computed here rather than derived on the client because free agency is the
 * one count no page holds the rows for — `GET /transfers/free-agents` paginates,
 * so a client that has 40 of 412 players cannot label its own tab.
 */
export interface TransfersCounts {
  auctions: number;
  listings: number;
  freeAgents: number;
  deals: number;
}

/**
 * An auction that has already settled — the "Gone this week" strip.
 *
 * `auction_state` keeps the row at `status = 'resolved'` rather than deleting
 * it (078 §2), so the price a player actually fetched survives. That record is
 * the league's only evidence of what a player is worth *here*, as opposed to
 * what Transfermarkt says he is worth in the world.
 */
export interface ResolvedAuction {
  player_id: string;
  player: EnrichedPlayer | null;
  kind: 'free_agent' | 'listing';
  winning_bid: number;
  winner_team_id: string | null;
  winner_team_name: string | null;
  bid_count: number;
  settled_at: string;
}

export interface AuctionBidEntry {
  team_id: string;
  team_name: string;
  amount: number;
  at: string;
}

export interface TransfersAuction {
  player_id: string;
  player: EnrichedPlayer | null;
  kind: 'free_agent' | 'listing';
  sale_listing_id: string | null;
  seller_team_id: string | null;
  seller_team_name: string | null;
  highest_bid: number;
  highest_bidder_team_id: string | null;
  highest_bidder_team_name: string | null;
  bid_count: number;
  bids: AuctionBidEntry[];
  /**
   * The lowest legal opening bid, resolved server-side so the card never has to
   * know the rule. Two different floors converge here:
   *   - a listing uses the seller's own min_bid (077 guarantees >= 80% of MV)
   *   - a free agent uses the Transfermarkt floor of 20% of market value,
   *     matching the check in POST /auctions/bid
   * Null (114) when the listing behind this row has no min_bid — no open
   * auction exists, so there is no floor to state.
   */
  minimum_bid: number | null;
  first_bid_at: string | null;
  expires_at: string | null;
  /**
   * When bidding opens, or null for immediately. A lot with a future value is
   * listed deliberately — you plan a budget against it — but a bid is refused
   * until then, and the card has to say so rather than let the error do it.
   */
  opens_at: string | null;
  market_value_at_auction: number | null;
  /** Private to the caller — never sourced from the public projection. */
  my_bid: number | null;
  my_drop_player_id: string | null;
}

export interface TransfersModel {
  /** Clock-skew anchor. Every countdown offsets against this, not Date.now(). */
  serverNow: string;
  /**
   * The gameweek in progress. The propose builder needs it to default loan
   * start/end and to state the "no loans after GW{total - 8}" cutoff; both
   * routes re-derive it server-side, so this is for the form, not the rule.
   */
  currentGameweek: number;
  league: TransfersLeague;
  myTeam: TransfersTeam;
  allTeams: TransfersTeam[];
  myRoster: RosterPlayer[];
  allRosters: Record<string, RosterPlayer[]>;
  myRights: TransfersRight[];
  rightsByTeam: Record<string, TransfersRight[]>;
  /** Retained rights by decision id — resolves what an offered/requested right actually is. */
  rightsMap: Record<string, TransfersRight>;
  auctions: TransfersAuction[];
  /** Settled in the last 7 days, newest first. Feeds "Gone this week". */
  recentlyResolved: ResolvedAuction[];
  listings: TransfersListing[];
  myOffers: TradeProposalRow[];
  leagueFeed: TradeProposalRow[];
  loans: LoanRow[];
  playerMap: Record<string, EnrichedPlayer>;
  rosterFull: boolean;
  academy: { current: number; max: number; age_limit: number };
  counts: TransfersCounts;
}

// ── Builder ───────────────────────────────────────────────────

export async function buildTransfersModel(
  admin: AdminClient,
  leagueId: string,
  userId: string,
): Promise<TransfersModel | null> {
  // 1. League + membership. Everything else depends on these.
  const { data: league } = await admin
    .from('leagues')
    .select(`id, name, roster_size, taxi_size, taxi_age_limit, status, roster_locked,
             total_gameweeks, current_season, previous_season, loan_slot_buyback_fee,
             loan_bonus_cap_default, max_loan_outs, max_loan_ins, free_agent_bid_floor`)
    .eq('id', leagueId)
    .single();
  if (!league) return null;

  const { data: myTeam } = await admin
    .from('teams')
    .select('id, team_name, faab_budget, abbreviation, crest_config')
    .eq('league_id', leagueId)
    .eq('user_id', userId)
    .single();
  if (!myTeam) return null;

  const { data: allTeams } = await admin
    .from('teams')
    .select('id, team_name, faab_budget, abbreviation, crest_config')
    .eq('league_id', leagueId);

  const teamIds = (allTeams ?? []).map((t) => t.id);
  const teamNameById = new Map((allTeams ?? []).map((t) => [t.id, t.team_name]));

  const maps = await fetchEnrichmentMaps(admin, league);

  // 2. The board, straight from the projection.
  const [
    { data: auctionRows },
    { data: myClaims },
    { data: listings },
    { data: rosterRows },
    { count: activePlayerCount },
    { data: resolvedRows },
    { data: rightRows },
  ] = await Promise.all([
    admin
      .from('auction_state')
      .select('*')
      .eq('league_id', leagueId)
      .eq('status', 'live')
      .order('expires_at', { ascending: true, nullsFirst: false }),
    // my_bid / my_drop_player_id are intentionally absent from auction_state —
    // drop_player_id is the one genuinely secret field in the auction system, so
    // the projection cannot carry it. Read the caller's own claims directly.
    admin
      .from('waiver_claims')
      .select('player_id, faab_bid, drop_player_id')
      .eq('league_id', leagueId)
      .eq('team_id', myTeam.id)
      .eq('status', 'pending')
      .eq('is_auction', true),
    admin
      .from('player_sale_listings')
      .select(
        `id, seller_team_id, player_id, min_bid, ask_price, buy_now_price,
         open_to_trade, open_to_sale, open_to_loan, status, auction_expires_at,
         created_at, updated_at`,
      )
      .eq('league_id', leagueId)
      .in('status', ['pending', 'active'])
      .order('created_at', { ascending: false }),
    teamIds.length
      ? admin
          .from('roster_entries')
          .select(`team_id, status, player:players(${FULL_PLAYER_SELECT})`)
          .in('team_id', teamIds)
      : Promise.resolve({ data: [] as RosterEntryRow[] }),
    // Head-only: the free-agency tab needs a total, not the rows. The rows are
    // GET /transfers/free-agents' job, and it paginates.
    admin.from('players').select('id', { count: 'exact', head: true }).eq('is_active', true),
    // Settled auctions, for the Auction Room's record of what things went for.
    // Bounded twice — a week and 12 rows — because this is a strip, not an
    // archive, and the (league_id, status) index makes the window cheap.
    admin
      .from('auction_state')
      .select('player_id, kind, highest_bid, highest_bidder_team_id, bid_count, updated_at')
      .eq('league_id', leagueId)
      .eq('status', 'resolved')
      .gte('updated_at', new Date(Date.now() - 7 * 86400_000).toISOString())
      .order('updated_at', { ascending: false })
      .limit(12),
    // Retained claims still live (status `retained` or `return_pending`) — the
    // rights market. No roster row backs these, so they must be fetched
    // separately from everything above.
    admin
      .from('departure_decisions')
      .select('id, team_id, player_id, status, market_value_at_departure')
      .eq('league_id', leagueId)
      .in('status', RIGHTS_HELD_STATUSES),
  ]);

  const myClaimBy = new Map((myClaims ?? []).map((c) => [c.player_id, c]));
  const listingByPlayer = new Map((listings ?? []).map((l) => [l.player_id, l]));

  // 3. Player rows for everything referenced above, fetched once.
  const referencedIds = new Set<string>([
    ...(auctionRows ?? []).map((a) => a.player_id),
    ...(listings ?? []).map((l) => l.player_id),
    ...(resolvedRows ?? []).map((a) => a.player_id),
    ...(rightRows ?? []).map((r) => r.player_id),
  ]);

  const playerMap: Record<string, EnrichedPlayer> = {};
  if (referencedIds.size) {
    const { data: players } = await admin
      .from('players')
      .select(FULL_PLAYER_SELECT)
      .in('id', Array.from(referencedIds));
    for (const p of players ?? []) playerMap[p.id] = enrichPlayer(p, maps);
  }

  // 3b. Retained rights, grouped by holder.
  const rightsByTeam: Record<string, TransfersRight[]> = {};
  const rightsMap: Record<string, TransfersRight> = {};
  for (const r of rightRows ?? []) {
    const right: TransfersRight = {
      id: r.id,
      playerId: r.player_id,
      player: playerMap[r.player_id] ?? null,
      teamId: r.team_id,
      status: r.status,
      marketValueAtDeparture: Number(r.market_value_at_departure ?? 0),
    };
    (rightsByTeam[r.team_id] ??= []).push(right);
    rightsMap[r.id] = right;
  }

  // 4. Rosters — enriched, grouped, and PPG-blended.
  const allRosters: Record<string, RosterPlayer[]> = {};
  const myRoster: RosterPlayer[] = [];
  const marketValues: Record<string, number> = {};
  const rosterPlayerIds: string[] = [];

  for (const e of (rosterRows ?? []) as unknown as RosterEntryRow[]) {
    const p = e.player;
    if (!p) continue;
    marketValues[p.id] = Number(p.market_value) || 0;
    rosterPlayerIds.push(p.id);
    playerMap[p.id] ??= enrichPlayer(p, maps);
  }

  const ppgMap = await buildEffectivePpgMap(
    admin,
    Array.from(new Set(rosterPlayerIds)),
    maps.season,
    maps.previousSeason,
    marketValues,
  );

  for (const e of (rosterRows ?? []) as unknown as RosterEntryRow[]) {
    const p = e.player;
    if (!p) continue;
    const row = {
      ...enrichPlayer(p, maps),
      status: e.status,
      recent_ppg: ppgMap[p.id] ?? Math.max(3.0, Number(p.ppg) || 3.0),
      listing: listingByPlayer.get(p.id) ?? null,
    };
    (allRosters[e.team_id] ??= []).push(row);
    if (e.team_id === myTeam.id) myRoster.push(row);
  }

  // 5. Offers, feed, loans. The FPL gameweek rides along here because it is the
  // one field in the model that comes from outside Supabase — it is cached for
  // five minutes upstream, so this does not add a round trip per request.
  const [{ myOffers, leagueFeed, loans }, fplStatus] = await Promise.all([
    fetchDealFlow(admin, leagueId, myTeam.id, maps, playerMap),
    getFplStatus(),
  ]);

  const freeAgentBidFloor = Number(league.free_agent_bid_floor) || 0.5;

  // 6. Assemble the board.
  const auctions: TransfersAuction[] = (auctionRows ?? []).map((a) => {
    const mine = myClaimBy.get(a.player_id);
    const player = playerMap[a.player_id];
    const listing = listingByPlayer.get(a.player_id);
    const marketValue = Number(player?.market_value ?? a.market_value_at_auction ?? 0);
    return {
      player_id: a.player_id,
      player,
      kind: a.kind,
      sale_listing_id: a.sale_listing_id,
      seller_team_id: a.seller_team_id,
      seller_team_name: a.seller_team_id ? teamNameById.get(a.seller_team_id) ?? null : null,
      highest_bid: a.highest_bid ?? 0,
      highest_bidder_team_id: a.highest_bidder_team_id,
      highest_bidder_team_name: a.highest_bidder_team_id
        ? teamNameById.get(a.highest_bidder_team_id) ?? null
        : null,
      bid_count: a.bid_count ?? 0,
      bids: Array.isArray(a.bids) ? a.bids : [],
      minimum_bid: listing ? listing.min_bid : Math.floor(marketValue * freeAgentBidFloor),
      first_bid_at: a.first_bid_at,
      expires_at: a.expires_at,
      opens_at: a.opens_at ?? null,
      market_value_at_auction: a.market_value_at_auction,
      my_bid: mine?.faab_bid ?? null,
      my_drop_player_id: mine?.drop_player_id ?? null,
    };
  })
    // A listing is a listing, not an auction, until someone actually bids on
    // it — the anchor seeded at creation (migration 080) exists to hold the
    // 14-day expiry clock, not to make the board treat an untouched listing
    // as live. Free-agent auctions (system-seeded or otherwise) have no
    // seller "deciding" anything, so they're unaffected and still show
    // immediately regardless of bid count.
    .filter((a) => a.kind !== 'listing' || a.bid_count > 0);

  const activeRosterCount = myRoster.filter((r) => r.status !== 'ir' && r.status !== 'taxi').length;

  // Free-agency count, derived rather than queried.
  //
  // It must agree with what GET /transfers/free-agents actually returns, so it
  // subtracts exactly what that route excludes from exactly the same universe.
  // Three details, each of which was wrong at some point:
  //
  //   1. The universe is `is_active` players. So only `is_active` rostered
  //      players may be subtracted — a squad holding 12 players who have left
  //      the Premier League was never counted in the total, and subtracting them
  //      undercounted free agency by 12 against the route's own answer.
  //   2. Distinct player ids, not roster rows: a loaned player holds two entries
  //      (`loan_out` on the lender, `loan_in` on the borrower).
  //   3. Only FREE-AGENT auctions are subtracted separately. A listing's player
  //      sits on the seller's roster and is already in the set above, so
  //      counting listing auctions here would remove him twice.
  //   4. Retained rights: a player back in the Premier League under a live
  //      `return_pending` claim is `is_active` but has no roster row, so he
  //      must be subtracted here too or he double-counts as a free agent.
  const rosteredActive = new Set(
    (rosterRows ?? [])
      .map((e) => (e as unknown as RosterEntryRow).player)
      .filter((p): p is EnrichedPlayer => Boolean(p?.is_active))
      .map((p) => p.id),
  ).size;
  const freeAgentAuctions = auctions.filter((a) => a.kind === 'free_agent').length;
  const rightsHeldActive = new Set(
    (rightRows ?? []).filter((r) => playerMap[r.player_id]?.is_active).map((r) => r.player_id),
  ).size;
  const freeAgents = Math.max(
    0,
    (activePlayerCount ?? 0) - rosteredActive - freeAgentAuctions - rightsHeldActive,
  );

  // "Deals" is your desk, not the league's — everything awaiting your attention
  // or someone else's answer to you.
  const deals =
    myOffers.filter((o) => o.status === 'pending').length +
    loans.filter(
      (l) =>
        l.status === 'pending' &&
        (l.lender_team_id === myTeam.id || l.borrower_team_id === myTeam.id),
    ).length;

  return {
    serverNow: new Date().toISOString(),
    currentGameweek: fplStatus.currentGw,
    league,
    myTeam,
    allTeams: allTeams ?? [],
    myRoster,
    allRosters,
    myRights: rightsByTeam[myTeam.id] ?? [],
    rightsByTeam,
    rightsMap,
    auctions,
    recentlyResolved: (resolvedRows ?? []).map((a) => ({
      player_id: a.player_id,
      player: playerMap[a.player_id] ?? null,
      kind: a.kind,
      winning_bid: a.highest_bid ?? 0,
      winner_team_id: a.highest_bidder_team_id,
      winner_team_name: a.highest_bidder_team_id
        ? teamNameById.get(a.highest_bidder_team_id) ?? null
        : null,
      bid_count: a.bid_count ?? 0,
      settled_at: a.updated_at,
    })),
    listings: (listings ?? []).map((l) => ({
      ...l,
      player: playerMap[l.player_id] ?? null,
      seller_team_name: teamNameById.get(l.seller_team_id) ?? null,
    })),
    myOffers,
    leagueFeed,
    loans,
    playerMap,
    rosterFull: activeRosterCount >= (league.roster_size ?? 20),
    academy: {
      current: myRoster.filter((r) => r.status === 'taxi').length,
      max: league.taxi_size ?? 3,
      age_limit: league.taxi_age_limit ?? 21,
    },
    counts: {
      // A listing-kind auction with no minimum_bid (114) has no bid ladder —
      // it doesn't show as a lot on the Auction Room (AuctionsClient filters
      // the same way), so the nav badge shouldn't count it either.
      auctions: auctions.filter((a) => a.kind !== 'listing' || a.minimum_bid != null).length,
      listings: (listings ?? []).length,
      freeAgents,
      deals,
    },
  };
}

// ── Helpers ───────────────────────────────────────────────────


/** My live offers, the settled league feed, and loans — plus any players they name. */
async function fetchDealFlow(
  admin: AdminClient,
  leagueId: string,
  myTeamId: string,
  maps: EnrichmentMaps,
  playerMap: Record<string, EnrichedPlayer>,
) {
  const proposalSelect = `
    id, league_id, team_a_id, team_b_id, offered_players, requested_players,
    offered_faab, requested_faab, offered_rights, requested_rights,
    sale_listing_id, status, message, created_at, updated_at,
    team_a:teams!trade_proposals_team_a_id_fkey(id, team_name),
    team_b:teams!trade_proposals_team_b_id_fkey(id, team_name)
  `;

  const [{ data: myOffers }, { data: leagueFeed }, { data: loans }] = await Promise.all([
    admin
      .from('trade_proposals')
      .select(proposalSelect)
      .eq('league_id', leagueId)
      .or(`team_a_id.eq.${myTeamId},team_b_id.eq.${myTeamId}`)
      .order('created_at', { ascending: false }),
    admin
      .from('trade_proposals')
      .select(proposalSelect)
      .eq('league_id', leagueId)
      .in('status', ['accepted', 'accepted_deferred'])
      .order('updated_at', { ascending: false })
      .limit(20),
    admin
      .from('player_loans')
      .select(
        `*,
         lender_team:teams!lender_team_id(id, team_name, user_id),
         borrower_team:teams!borrower_team_id(id, team_name, user_id),
         player:players(${FULL_PLAYER_SELECT})`,
      )
      .eq('league_id', leagueId)
      .or(`lender_team_id.eq.${myTeamId},borrower_team_id.eq.${myTeamId}`)
      .order('created_at', { ascending: false }),
  ]);

  // Backfill playerMap for anything a proposal references but no roster carries
  // (a player can be traded away while his proposal stays in the feed).
  const missing = new Set<string>();
  for (const t of [...(myOffers ?? []), ...(leagueFeed ?? [])]) {
    for (const id of [...(t.offered_players ?? []), ...(t.requested_players ?? [])]) {
      if (!playerMap[id]) missing.add(id);
    }
  }
  if (missing.size) {
    const { data: extra } = await admin
      .from('players')
      .select(FULL_PLAYER_SELECT)
      .in('id', Array.from(missing));
    for (const p of extra ?? []) playerMap[p.id] = enrichPlayer(p, maps);
  }

  for (const l of (loans ?? []) as unknown as LoanRow[]) {
    if (l.player) l.player = enrichPlayer(l.player, maps);
  }

  return {
    // See TradeProposalRow: PostgREST types these to-one embeds as arrays.
    myOffers: (myOffers ?? []) as unknown as TradeProposalRow[],
    leagueFeed: (leagueFeed ?? []) as unknown as TradeProposalRow[],
    loans: (loans ?? []) as unknown as LoanRow[],
  };
}
