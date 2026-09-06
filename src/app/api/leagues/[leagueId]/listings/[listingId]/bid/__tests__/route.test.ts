/**
 * The deprecated listing bid route.
 *
 * It delegates to `place_auction_bid_rpc` and keeps only the checks it can do
 * cheaply itself. That makes it a WEAKER door onto the same auction than
 * `/auctions/bid`, and the tests below pin exactly how much weaker, because
 * the difference is not visible from either file on its own:
 *
 *   - the IR gate (no bidding while a fit player occupies an IR slot)
 *   - the buy-back exclusion (took compensation, cannot bid on the return)
 *   - the aged-out academy compliance check
 *   - the unpriced-player quarantine (market_value is null)
 *
 * None of those exist here, and none of them exist in the RPC either — its
 * source mentions neither `ir` nor `fpl_status`. They live in `/auctions/bid`
 * alone. The route is still reachable: the legacy /trades page calls it.
 *
 * These are characterisation tests. They assert what the route does today so
 * that closing the gap is a visible, deliberate change rather than a silent
 * one, and so nothing else drifts while it stays open.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, createFakeServerClient, type FakeClient, type Tables } from '@/test/supabaseFake';
import {
  LEAGUE_ID,
  MY_TEAM_ID,
  PLAYER_ID,
  RIVAL_TEAM_ID,
  USER_ID,
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

const LISTING_ID = 'listing-1';

const acceptingRpc = {
  place_auction_bid_rpc: () => ({ success: true, expires_at: '2026-09-10T12:00:00.000Z' }),
};

let admin: FakeClient;

function setup(
  mutate: (tables: Tables) => void = () => {},
  rpc: Record<string, (args: any) => any> = acceptingRpc,
) {
  const tables = leagueFixture();
  tables.player_sale_listings.push({
    id: LISTING_ID,
    league_id: LEAGUE_ID,
    player_id: PLAYER_ID,
    seller_team_id: RIVAL_TEAM_ID,
    status: 'pending',
    min_bid: 25,
    buy_now_price: null,
  });
  mutate(tables);
  admin = createFakeSupabase(tables, { rpc });
  state.admin = admin;
  return tables;
}

async function bid(body: Record<string, unknown>, listingId = LISTING_ID) {
  const req = { json: async () => body } as any;
  const res = await POST(req, { params: Promise.resolve({ leagueId: LEAGUE_ID, listingId }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.user = { id: USER_ID };
  setup();
});

describe('what it does check', () => {
  it('rejects an unauthenticated caller', async () => {
    state.user = null;
    expect((await bid({ bidAmount: 30 })).status).toBe(401);
  });

  it('refuses a fractional or negative amount', async () => {
    expect((await bid({ bidAmount: 30.5 })).status).toBe(400);
    expect((await bid({ bidAmount: -1 })).status).toBe(400);
  });

  it('refuses a caller with no club in this league', async () => {
    setup((t) => { t.teams = t.teams.filter((x) => x.user_id !== USER_ID); });
    expect((await bid({ bidAmount: 30 })).status).toBe(403);
  });

  it('refuses a listing that does not exist', async () => {
    expect((await bid({ bidAmount: 30 }, 'nope')).status).toBe(404);
  });

  it('refuses a listing from another league', async () => {
    setup((t) => { t.player_sale_listings[0].league_id = 'league-other'; });
    expect((await bid({ bidAmount: 30 })).status).toBe(404);
  });

  it('refuses a listing that has already settled', async () => {
    setup((t) => { t.player_sale_listings[0].status = 'sold'; });
    const res = await bid({ bidAmount: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Bidding is closed for this listing (status is sold)');
  });

  it('accepts a listing that is already live', async () => {
    setup((t) => { t.player_sale_listings[0].status = 'active'; });
    expect((await bid({ bidAmount: 30 })).status).toBe(200);
  });

  it('refuses a bid above the club balance', async () => {
    setup((t) => { t.teams.find((x) => x.id === MY_TEAM_ID)!.faab_budget = 20; });
    const res = await bid({ bidAmount: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Insufficient Club Balance');
  });

  it('refuses every bid while rosters are locked', async () => {
    setup((t) => { t.leagues[0].roster_locked = true; });
    expect((await bid({ bidAmount: 30 })).status).toBe(403);
  });

  it("passes the listing id to the RPC so it cannot settle a different lot", async () => {
    setup();
    await bid({ bidAmount: 30 });
    const call = admin.__rpcCalls.find((c) => c.name === 'place_auction_bid_rpc')!;
    expect(call.args).toMatchObject({
      p_league_id: LEAGUE_ID,
      p_team_id: MY_TEAM_ID,
      p_player_id: PLAYER_ID,
      p_bid_amount: 30,
      p_expect_sale_listing_id: LISTING_ID,
    });
  });

  it("returns the RPC's refusal as a 400", async () => {
    setup(() => {}, { place_auction_bid_rpc: () => ({ success: false, error: 'Outbid already' }) });
    const res = await bid({ bidAmount: 30 });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Outbid already');
  });

  it('reports a Buy Now as unresolved when the inline resolver fails', async () => {
    setup(() => {}, {
      place_auction_bid_rpc: () => ({ success: true, is_buy_now: true }),
      resolve_single_player_auction_rpc: () => ({ data: null, error: { message: 'lock timeout' } }),
    });
    const res = await bid({ bidAmount: 60 });
    expect(res.status).toBe(200);
    expect(res.body.resolved).toBe(false);
  });
});

describe('what it does NOT check, unlike /auctions/bid', () => {
  it('lets a club bid with a healthy player parked on IR', async () => {
    setup((t) => {
      t.roster_entries.push({ id: 'ir-1', team_id: MY_TEAM_ID, player_id: 'squad-20', status: 'ir' });
    });
    // /auctions/bid refuses this outright. Here it reaches the RPC, which does
    // not know the rule either.
    expect((await bid({ bidAmount: 30 })).status).toBe(200);
  });

  it('lets a club bid on the return of a player it took compensation for', async () => {
    setup((t) => {
      t.departure_decisions.push({
        id: 'dd-1', league_id: LEAGUE_ID, player_id: PLAYER_ID,
        original_team_id: MY_TEAM_ID, status: 'released', season_from: '2026-27',
      });
    });
    expect((await bid({ bidAmount: 30 })).status).toBe(200);
  });

  it('lets a club bid while an aged-out player sits in its academy', async () => {
    setup((t) => {
      const born = new Date();
      born.setUTCFullYear(born.getUTCFullYear() - 24);
      t.players.find((p) => p.id === 'squad-21')!.date_of_birth = born.toISOString().slice(0, 10);
      t.roster_entries.push({ id: 'ac-1', team_id: MY_TEAM_ID, player_id: 'squad-21', status: 'taxi' });
    });
    expect((await bid({ bidAmount: 30 })).status).toBe(200);
  });

  it('lets a bid through on a player Transfermarkt has never priced', async () => {
    setup((t) => { t.players.find((p) => p.id === PLAYER_ID)!.market_value = null; });
    expect((await bid({ bidAmount: 30 })).status).toBe(200);
  });

  it("does not pre-check the seller's minimum, leaving it to the RPC", async () => {
    // The listing's min_bid is €25m. /auctions/bid would name it in the
    // refusal; here the bid goes straight through to the lock.
    expect((await bid({ bidAmount: 1 })).status).toBe(200);
  });
});
