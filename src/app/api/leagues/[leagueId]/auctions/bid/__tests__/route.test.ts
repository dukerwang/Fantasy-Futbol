/**
 * The auction bid route's validation gauntlet.
 *
 * Everything before `place_auction_bid_rpc` is a refusal this handler owns
 * alone — the RPC re-checks price and roster under a row lock, but it never
 * sees the IR rule, the buy-back exclusion, the academy compliance check or
 * the staggered release gate. Those exist here and nowhere else, and until
 * now nothing tested them.
 *
 * The RPC itself is stubbed. These tests are about which bids reach it.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, createFakeServerClient, type FakeClient, type Tables } from '@/test/supabaseFake';
import {
  LEAGUE_ID,
  MY_TEAM_ID,
  PLAYER_ID,
  RIVAL_TEAM_ID,
  USER_ID,
  dobForAge,
  leagueFixture,
} from '@/test/leagueFixture';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  admin: null as any,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => createFakeServerClient(state.user),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => state.admin,
}));
vi.mock('@/lib/notifications/createNotification', () => ({
  createNotification: vi.fn(async () => {}),
}));
vi.mock('@/lib/auction/lockedClubs', () => ({
  getLockedPlTeamIds: async () => ({ lockedPlTeamIds: [] as number[] }),
}));

import { POST } from '../route';

/** The RPC accepts every bid unless a test says otherwise. */
const acceptingRpc = {
  place_auction_bid_rpc: () => ({ success: true, expires_at: '2026-09-10T12:00:00.000Z', is_first_bid: true }),
};

let admin: FakeClient;

function setup(tables: Tables, rpc: Record<string, (args: any) => any> = acceptingRpc) {
  admin = createFakeSupabase(tables, { rpc });
  state.admin = admin;
  return tables;
}

async function bid(body: Record<string, unknown>) {
  const req = { json: async () => body } as any;
  const res = await POST(req, { params: Promise.resolve({ leagueId: LEAGUE_ID }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.user = { id: USER_ID };
  setup(leagueFixture());
});

describe('auth and request shape', () => {
  it('rejects an unauthenticated caller', async () => {
    state.user = null;
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(401);
  });

  it('requires a player and an amount', async () => {
    expect((await bid({ bidAmount: 30 })).status).toBe(400);
    expect((await bid({ playerId: PLAYER_ID })).status).toBe(400);
  });

  it('rejects a fractional or negative amount', async () => {
    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30.5 })).status).toBe(400);
    expect((await bid({ playerId: PLAYER_ID, bidAmount: -1 })).status).toBe(400);
  });

  it('rejects a bid that both nominates a drop and asks for the academy', async () => {
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30, dropPlayerId: 'squad-1', sendToAcademy: true });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/same bid/i);
  });

  it('refuses a caller with no club in this league', async () => {
    const tables = leagueFixture();
    tables.teams = tables.teams.filter((t) => t.user_id !== USER_ID);
    setup(tables);
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(403);
  });
});

describe('club balance', () => {
  it('refuses a bid above the balance', async () => {
    setup(leagueFixture({ faabBudget: 25 }));
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 26 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Insufficient Club Balance');
  });

  it('allows a bid for the whole balance', async () => {
    setup(leagueFixture({ faabBudget: 26, marketValue: 40 }));
    expect((await bid({ playerId: PLAYER_ID, bidAmount: 26 })).status).toBe(200);
  });
});

describe('the IR gate', () => {
  // CLAUDE.md: IR's slot cap and this rule are independent. A club under its
  // IR cap still cannot bid while a fit player occupies a slot.
  it('blocks bidding while a healthy player sits on IR', async () => {
    const tables = leagueFixture();
    tables.roster_entries.push({ id: 'ir-1', team_id: MY_TEAM_ID, player_id: 'squad-20', status: 'ir' });
    setup(tables);

    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/healthy player occupying an IR slot/);
  });

  it('allows bidding when the player on IR is actually injured', async () => {
    const tables = leagueFixture();
    tables.players.find((p) => p.id === 'squad-20')!.fpl_status = 'i';
    tables.roster_entries.push({ id: 'ir-1', team_id: MY_TEAM_ID, player_id: 'squad-20', status: 'ir' });
    setup(tables);

    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30 })).status).toBe(200);
  });

  it("ignores another club's healthy IR player", async () => {
    const tables = leagueFixture();
    tables.roster_entries.push({ id: 'ir-1', team_id: RIVAL_TEAM_ID, player_id: 'squad-20', status: 'ir' });
    setup(tables);

    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30 })).status).toBe(200);
  });
});

describe('the buy-back exclusion', () => {
  // Taking compensation bars this manager from the return auction. Keyed on
  // original_team_id so trading the rights away cannot launder it.
  it('refuses a manager who took compensation for this player', async () => {
    const tables = leagueFixture();
    tables.departure_decisions.push({
      id: 'dd-1',
      league_id: LEAGUE_ID,
      player_id: PLAYER_ID,
      original_team_id: MY_TEAM_ID,
      team_id: RIVAL_TEAM_ID,
      status: 'released',
      season_from: '2026-27',
    });
    setup(tables);

    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/took compensation/);
  });

  it('still refuses, not errors, when he was released in both seasons', async () => {
    // The route carries `.limit(1)` before `.maybeSingle()` precisely because
    // two rows made maybeSingle() throw, turning the refusal into a 500.
    const tables = leagueFixture();
    for (const season of ['2025-26', '2026-27']) {
      tables.departure_decisions.push({
        id: `dd-${season}`,
        league_id: LEAGUE_ID,
        player_id: PLAYER_ID,
        original_team_id: MY_TEAM_ID,
        status: 'released',
        season_from: season,
      });
    }
    setup(tables);

    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/took compensation/);
  });

  it('does not bar a manager who retained his rights instead', async () => {
    const tables = leagueFixture();
    tables.departure_decisions.push({
      id: 'dd-1',
      league_id: LEAGUE_ID,
      player_id: PLAYER_ID,
      original_team_id: MY_TEAM_ID,
      status: 'retained',
      season_from: '2026-27',
    });
    setup(tables);

    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30 })).status).toBe(200);
  });

  it('lets an exclusion from two summers ago lapse', async () => {
    const tables = leagueFixture();
    tables.departure_decisions.push({
      id: 'dd-old',
      league_id: LEAGUE_ID,
      player_id: PLAYER_ID,
      original_team_id: MY_TEAM_ID,
      status: 'released',
      season_from: '2024-25',
    });
    setup(tables);

    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30 })).status).toBe(200);
  });
});

describe('offseason and academy compliance', () => {
  it('refuses every bid while rosters are locked', async () => {
    setup(leagueFixture({ rosterLocked: true }));
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/locked during the offseason/);
  });

  it('refuses while an aged-out player is still in the academy', async () => {
    const tables = leagueFixture();
    tables.players.find((p) => p.id === 'squad-21')!.date_of_birth = dobForAge(23);
    tables.roster_entries.push({ id: 'ac-1', team_id: MY_TEAM_ID, player_id: 'squad-21', status: 'taxi' });
    setup(tables);

    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/aged out/);
  });

  it('allows a bid when the academy is within the age limit', async () => {
    const tables = leagueFixture();
    tables.players.find((p) => p.id === 'squad-21')!.date_of_birth = dobForAge(19);
    tables.roster_entries.push({ id: 'ac-1', team_id: MY_TEAM_ID, player_id: 'squad-21', status: 'taxi' });
    setup(tables);

    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30 })).status).toBe(200);
  });
});

describe('the unpriced-player quarantine', () => {
  // A null market_value means "Transfermarkt has not valued him yet", not
  // "worth nothing" — treating it as zero would let a new arrival be claimed
  // at the table minimum.
  it('refuses a bid on a player with no market value', async () => {
    setup(leagueFixture({ marketValue: null }));
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hasn't been priced/);
  });
});

describe('the free-agent floor', () => {
  it('refuses below 50% of market value and names the figure', async () => {
    setup(leagueFixture({ marketValue: 40 }));
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 19 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Minimum bid for this player is €20m (50% of market value)');
  });

  it('accepts a bid exactly on the floor', async () => {
    setup(leagueFixture({ marketValue: 40 }));
    expect((await bid({ playerId: PLAYER_ID, bidAmount: 20 })).status).toBe(200);
  });

  it("honours a league's own floor setting", async () => {
    const tables = leagueFixture({ marketValue: 40 });
    tables.leagues[0].free_agent_bid_floor = 0.75;
    setup(tables);

    const res = await bid({ playerId: PLAYER_ID, bidAmount: 29 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/€30m \(75% of market value\)/);
  });
});

describe("a manager's listing", () => {
  function withListing(extra: Record<string, unknown>) {
    const tables = leagueFixture({ marketValue: 40 });
    tables.player_sale_listings.push({
      id: 'listing-1',
      league_id: LEAGUE_ID,
      player_id: PLAYER_ID,
      seller_team_id: RIVAL_TEAM_ID,
      status: 'active',
      min_bid: null,
      buy_now_price: null,
      ...extra,
    });
    setup(tables);
    return tables;
  }

  it("refuses below the seller's minimum", async () => {
    withListing({ min_bid: 30 });
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 29 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Bid must be at least the seller's minimum of €30m.");
  });

  it("accepts the seller's minimum even when it is under the free-agent floor", async () => {
    // The seller's floor governs; 129 already guarantees it clears 60% of
    // market value. Stacking the free-agent rule on top would double-charge.
    withListing({ min_bid: 24 });
    expect((await bid({ playerId: PLAYER_ID, bidAmount: 24 })).status).toBe(200);
  });

  it('refuses an auction bid on a clause-only listing', async () => {
    withListing({ min_bid: null, buy_now_price: 60 });
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 50 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only a release-clause payment of €60m/);
  });

  it('accepts a payment that meets the clause', async () => {
    withListing({ min_bid: null, buy_now_price: 60 });
    expect((await bid({ playerId: PLAYER_ID, bidAmount: 60 })).status).toBe(200);
  });

  it('refuses any bid on a listing open to neither auction nor clause', async () => {
    withListing({ min_bid: null, buy_now_price: null });
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 100 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/isn't open to auction bids\. Send an Offer/);
  });
});

describe('roster capacity', () => {
  it('lets a full roster bid when the winner can go to the academy', async () => {
    const tables = leagueFixture({ rosterCount: 22 });
    tables.players.find((p) => p.id === PLAYER_ID)!.date_of_birth = dobForAge(19);
    setup(tables);

    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30 })).status).toBe(200);
  });

  it('refuses a full roster and full academy with no drop nominated', async () => {
    const tables = leagueFixture({ rosterCount: 22 });
    for (let i = 0; i < 3; i++) {
      // Young enough to be legally in the academy, so the aged-out check
      // upstream cannot be what refuses this bid.
      tables.players.find((p) => p.id === `squad-2${i}`)!.date_of_birth = dobForAge(19);
      tables.roster_entries.push({ id: `ac-${i}`, team_id: MY_TEAM_ID, player_id: `squad-2${i}`, status: 'taxi' });
    }
    setup(tables);

    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Roster is full and academy is full/);
  });

  it('refuses a full roster when the player is too old for the academy', async () => {
    setup(leagueFixture({ rosterCount: 22 }));
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not U21 academy-eligible/);
  });

  it('accepts a full roster when a drop is nominated', async () => {
    setup(leagueFixture({ rosterCount: 22 }));
    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30, dropPlayerId: 'squad-1' })).status).toBe(200);
  });

  it('counts a used slot buyback as an extra roster place', async () => {
    const tables = leagueFixture({ rosterCount: 22 });
    tables.player_loans.push({
      id: 'loan-1',
      lender_team_id: MY_TEAM_ID,
      status: 'active',
      slot_buyback_used: true,
    });
    setup(tables);

    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30 })).status).toBe(200);
  });

  it('does not count IR, academy or loaned-in players against the roster', async () => {
    const tables = leagueFixture({ rosterCount: 22 });
    tables.roster_entries = tables.roster_entries.slice(0, 21);
    // squad-22 is hurt so the IR gate stays shut; squad-23 is young so the
    // academy stays compliant. Neither should count against the 22 places.
    tables.players.find((p) => p.id === 'squad-22')!.fpl_status = 'i';
    tables.players.find((p) => p.id === 'squad-23')!.date_of_birth = dobForAge(19);
    tables.roster_entries.push(
      { id: 'x-ir', team_id: MY_TEAM_ID, player_id: 'squad-22', status: 'ir' },
      { id: 'x-taxi', team_id: MY_TEAM_ID, player_id: 'squad-23', status: 'taxi' },
      { id: 'x-loan', team_id: MY_TEAM_ID, player_id: 'squad-24', status: 'loan_in' },
    );
    setup(tables);

    // 21 active + three parked players: still one place free, so no academy
    // routing and no drop is required.
    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30 })).status).toBe(200);
  });
});

describe('the duplicate-drop guard', () => {
  // Two pending bids nominating the same drop would, if both won, take two
  // players in and put only one out.
  it('refuses a drop already nominated on another pending bid', async () => {
    const tables = leagueFixture();
    tables.waiver_claims.push({
      id: 'claim-other',
      league_id: LEAGUE_ID,
      team_id: MY_TEAM_ID,
      player_id: 'other-player',
      drop_player_id: 'squad-1',
      status: 'pending',
      is_auction: true,
    });
    setup(tables);

    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30, dropPlayerId: 'squad-1' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already nominated as a drop/);
  });

  it('allows re-nominating the same drop on this auction', async () => {
    const tables = leagueFixture();
    tables.waiver_claims.push({
      id: 'claim-mine',
      league_id: LEAGUE_ID,
      team_id: MY_TEAM_ID,
      player_id: PLAYER_ID,
      drop_player_id: 'squad-1',
      status: 'pending',
      is_auction: true,
    });
    setup(tables);

    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30, dropPlayerId: 'squad-1' })).status).toBe(200);
  });
});

describe('the auction clock', () => {
  function withSeedClaim(extra: Record<string, unknown>) {
    const tables = leagueFixture();
    tables.waiver_claims.push({
      id: 'seed-1',
      league_id: LEAGUE_ID,
      player_id: PLAYER_ID,
      team_id: null,
      status: 'pending',
      is_auction: true,
      expires_at: null,
      first_bid_at: null,
      opens_at: null,
      ...extra,
    });
    setup(tables);
    return tables;
  }

  it('refuses a bid on an auction that has already expired', async () => {
    withSeedClaim({ expires_at: new Date(Date.now() - 60_000).toISOString() });
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already expired/);
  });

  it('refuses a bid on a lot that has not opened yet', async () => {
    withSeedClaim({ opens_at: new Date(Date.now() + 3_600_000).toISOString() });
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/^Bidding on this lot opens /);
  });

  it('accepts a bid on a lot that has opened', async () => {
    withSeedClaim({ opens_at: new Date(Date.now() - 3_600_000).toISOString() });
    expect((await bid({ playerId: PLAYER_ID, bidAmount: 30 })).status).toBe(200);
  });
});

describe('reaching the RPC', () => {
  it('passes the bid through with the arguments the RPC expects', async () => {
    setup(leagueFixture());
    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30, dropPlayerId: 'squad-1' });

    expect(res.status).toBe(200);
    const call = admin.__rpcCalls.find((c) => c.name === 'place_auction_bid_rpc');
    expect(call).toBeDefined();
    expect(call!.args).toMatchObject({
      p_league_id: LEAGUE_ID,
      p_team_id: MY_TEAM_ID,
      p_player_id: PLAYER_ID,
      p_drop_player_id: 'squad-1',
      p_bid_amount: 30,
      p_send_to_academy: false,
    });
    expect(typeof call!.args.p_expires_at).toBe('string');
  });

  it("returns the RPC's own refusal as a 400", async () => {
    setup(leagueFixture(), {
      place_auction_bid_rpc: () => ({ success: false, error: 'Another bid landed first' }),
    });

    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Another bid landed first');
  });

  it('returns 500 when the RPC itself errors', async () => {
    setup(leagueFixture(), {
      place_auction_bid_rpc: () => ({ data: null, error: { message: 'deadlock detected' } }),
    });

    const res = await bid({ playerId: PLAYER_ID, bidAmount: 30 });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('deadlock detected');
  });

  it('reports a Buy Now as unresolved when the inline resolver fails', async () => {
    // The purchase committed; only the resolution did not. The client must say
    // "completing" rather than "you signed him", so the sweep can finish it.
    setup(leagueFixture(), {
      place_auction_bid_rpc: () => ({ success: true, is_buy_now: true, expires_at: '2026-09-10T12:00:00.000Z' }),
      resolve_single_player_auction_rpc: () => ({ data: null, error: { message: 'lock timeout' } }),
    });

    const res = await bid({ playerId: PLAYER_ID, bidAmount: 60 });
    expect(res.status).toBe(200);
    expect(res.body.is_buy_now).toBe(true);
    expect(res.body.resolved).toBe(false);
  });

  it('reports a Buy Now as resolved when the inline resolver succeeds', async () => {
    setup(leagueFixture(), {
      place_auction_bid_rpc: () => ({ success: true, is_buy_now: true, expires_at: '2026-09-10T12:00:00.000Z' }),
      resolve_single_player_auction_rpc: () => ({ success: true, winner_team_id: MY_TEAM_ID }),
    });

    const res = await bid({ playerId: PLAYER_ID, bidAmount: 60 });
    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(true);
  });
});

describe('bidding on a listing goes through the same gates', () => {
  // The legacy /trades page used to bid via /listings/[listingId]/bid, which
  // reached the same RPC without any of these checks — and the RPC does not
  // enforce them either; its source mentions neither `ir` nor `fpl_status`.
  // That route is gone and its caller now posts here, so these assertions are
  // what closed the gap.
  const LISTING_ID = 'listing-1';

  function withListing(mutate: (tables: Tables) => void = () => {}) {
    const tables = leagueFixture({ marketValue: 40 });
    tables.player_sale_listings.push({
      id: LISTING_ID,
      league_id: LEAGUE_ID,
      player_id: PLAYER_ID,
      seller_team_id: RIVAL_TEAM_ID,
      status: 'active',
      min_bid: 25,
      buy_now_price: null,
    });
    mutate(tables);
    setup(tables);
    return tables;
  }

  function listingBid(extra: Record<string, unknown> = {}) {
    return bid({ playerId: PLAYER_ID, bidAmount: 30, saleListingId: LISTING_ID, ...extra });
  }

  it('refuses a bid while a healthy player sits on IR', async () => {
    withListing((t) => {
      t.roster_entries.push({ id: 'ir-1', team_id: MY_TEAM_ID, player_id: 'squad-20', status: 'ir' });
    });
    const res = await listingBid();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/healthy player occupying an IR slot/);
  });

  it('refuses a manager who took compensation for this player', async () => {
    withListing((t) => {
      t.departure_decisions.push({
        id: 'dd-1', league_id: LEAGUE_ID, player_id: PLAYER_ID,
        original_team_id: MY_TEAM_ID, status: 'released', season_from: '2026-27',
      });
    });
    const res = await listingBid();
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/took compensation/);
  });

  it('refuses while an aged-out player is still in the academy', async () => {
    withListing((t) => {
      t.players.find((p) => p.id === 'squad-21')!.date_of_birth = dobForAge(24);
      t.roster_entries.push({ id: 'ac-1', team_id: MY_TEAM_ID, player_id: 'squad-21', status: 'taxi' });
    });
    const res = await listingBid();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/aged out/);
  });

  it('refuses a bid on a player Transfermarkt has never priced', async () => {
    withListing((t) => {
      t.players.find((p) => p.id === PLAYER_ID)!.market_value = null;
    });
    const res = await listingBid();
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/hasn't been priced/);
  });

  it("refuses below the seller's published minimum", async () => {
    withListing();
    const res = await listingBid({ bidAmount: 24 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Bid must be at least the seller's minimum of €25m.");
  });

  it('passes the listing id to the RPC as a consistency check', async () => {
    withListing();
    const res = await listingBid();
    expect(res.status).toBe(200);
    expect(res.body.sale_listing_id).toBeNull();

    const call = admin.__rpcCalls.find((c) => c.name === 'place_auction_bid_rpc')!;
    expect(call.args.p_expect_sale_listing_id).toBe(LISTING_ID);
  });
});
