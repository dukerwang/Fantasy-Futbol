/**
 * Proposing a trade.
 *
 * Three rules here exist nowhere else and each of them protects somebody's
 * money. Neither side may come empty-handed, and cash NETS — €30m out against
 * €30m back is €0m, not a payment. A player with a live auction cannot be put
 * in a deal at all. And a cash-only offer against a listing must clear the
 * seller's published minimum, because undercutting it privately undercuts an
 * auction other managers have already committed budget to.
 *
 * Everything a listing's owner merely *prefers* is advertising, not a gate
 * (088): an offer is never refused for arriving in a shape they did not tick.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, createFakeServerClient, type FakeClient, type Tables } from '@/test/supabaseFake';
import {
  LEAGUE_ID,
  MY_TEAM_ID,
  OTHER_USER_ID,
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

import { POST } from '../route';

let admin: FakeClient;

const MINE = 'squad-1';
const THEIRS = 'rival-1';

function setup(mutate: (tables: Tables) => void = () => {}) {
  const tables = leagueFixture();
  tables.chat_messages = [];
  tables.players.push({
    id: THEIRS,
    name: 'Rival Player',
    market_value: 30,
    primary_position: 'ST',
    fpl_status: 'a',
    is_active: true,
  });
  tables.roster_entries.push({ id: 'rival-entry-1', team_id: RIVAL_TEAM_ID, player_id: THEIRS, status: 'active' });
  mutate(tables);
  admin = createFakeSupabase(tables, {});
  state.admin = admin;
  return tables;
}

/** A straight one-for-one, which clears every gate. */
function deal(overrides: Record<string, unknown> = {}) {
  return {
    targetTeamId: RIVAL_TEAM_ID,
    offeredPlayerIds: [MINE],
    requestedPlayerIds: [THEIRS],
    offeredFaab: 0,
    requestedFaab: 0,
    ...overrides,
  };
}

async function propose(body: Record<string, unknown>) {
  const req = { json: async () => body } as any;
  const res = await POST(req, { params: Promise.resolve({ leagueId: LEAGUE_ID }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.user = { id: USER_ID };
  setup();
});

describe('auth and the shape of an offer', () => {
  it('rejects an unauthenticated caller', async () => {
    state.user = null;
    expect((await propose(deal())).status).toBe(401);
  });

  it('requires a counterparty', async () => {
    expect((await propose(deal({ targetTeamId: undefined }))).status).toBe(400);
  });

  it('requires the player lists to be arrays', async () => {
    expect((await propose(deal({ offeredPlayerIds: MINE }))).status).toBe(400);
    expect((await propose(deal({ requestedRightIds: 'nope' }))).status).toBe(400);
  });

  it('refuses a deal with no players and no rights on either side', async () => {
    const res = await propose(deal({ offeredPlayerIds: [], requestedPlayerIds: [], offeredFaab: 10 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/at least one player or retained right/);
  });

  it('refuses a fractional or negative cash amount', async () => {
    expect((await propose(deal({ offeredFaab: 2.5 }))).status).toBe(400);
    expect((await propose(deal({ requestedFaab: -1 }))).status).toBe(400);
  });

  it('refuses a trade with yourself', async () => {
    const res = await propose(deal({ targetTeamId: MY_TEAM_ID }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cannot trade with yourself');
  });

  it('refuses a counterparty from another league', async () => {
    setup((t) => { t.teams.find((x) => x.id === RIVAL_TEAM_ID)!.league_id = 'league-other'; });
    expect((await propose(deal())).status).toBe(404);
  });
});

describe('neither side may come empty-handed', () => {
  it('refuses a request for players with nothing offered', async () => {
    const res = await propose(deal({ offeredPlayerIds: [], offeredFaab: 0 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/asking for players and putting nothing up/);
  });

  it('refuses a gift with nothing asked in return', async () => {
    const res = await propose(deal({ requestedPlayerIds: [], requestedFaab: 0 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/giving players up and asking for nothing back/);
  });

  it('accepts cash as the thing being put up', async () => {
    expect((await propose(deal({ offeredPlayerIds: [], offeredFaab: 25 }))).status).toBe(201);
  });

  it('nets cash on both sides before deciding', async () => {
    // €30m out and €30m back is €0m — not a payment for the player coming the
    // other way, however it looks in the composer.
    const res = await propose(deal({ offeredPlayerIds: [], offeredFaab: 30, requestedFaab: 30 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/putting nothing up/);
  });

  it('counts a retained right as substance', async () => {
    setup((t) => {
      t.departure_decisions.push({
        id: 'right-1', league_id: LEAGUE_ID, team_id: MY_TEAM_ID, status: 'retained',
      });
    });
    const res = await propose(deal({ offeredPlayerIds: [], offeredRightIds: ['right-1'] }));
    expect(res.status).toBe(201);
  });
});

describe('the IR gate', () => {
  it('blocks proposing a trade while a healthy player sits on IR', async () => {
    setup((t) => {
      t.roster_entries.push({ id: 'ir-1', team_id: MY_TEAM_ID, player_id: 'squad-20', status: 'ir' });
    });
    const res = await propose(deal());
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/healthy player occupying an IR slot/);
  });

  it('allows it when the player on IR is injured', async () => {
    setup((t) => {
      t.players.find((p) => p.id === 'squad-20')!.fpl_status = 'i';
      t.roster_entries.push({ id: 'ir-1', team_id: MY_TEAM_ID, player_id: 'squad-20', status: 'ir' });
    });
    expect((await propose(deal())).status).toBe(201);
  });
});

describe('club balance', () => {
  it('refuses to offer more cash than the club has', async () => {
    setup((t) => { t.teams.find((x) => x.id === MY_TEAM_ID)!.faab_budget = 10; });
    const res = await propose(deal({ offeredFaab: 11 }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('You only have €10m Club Balance — cannot offer €11m');
  });
});

describe('who is actually tradeable', () => {
  it("refuses an offered player who is not on the proposer's roster", async () => {
    const res = await propose(deal({ offeredPlayerIds: [THEIRS] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('One or more offered players are not on your roster');
  });

  it('refuses a requested player who is not on the target roster', async () => {
    const res = await propose(deal({ requestedPlayerIds: ['squad-9'] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('One or more requested players are not on the target team roster');
  });

  it('refuses a player who is out on loan on either side', async () => {
    setup((t) => { t.roster_entries.find((e) => e.player_id === MINE)!.status = 'loan_out'; });
    expect((await propose(deal())).body.error).toMatch(/offered players are currently out on loan/);

    setup((t) => { t.roster_entries.find((e) => e.player_id === THEIRS)!.status = 'loan_in'; });
    expect((await propose(deal())).body.error).toMatch(/requested players are currently out on loan/);
  });

  it('refuses any player whose auction is live, and names him', async () => {
    setup((t) => {
      t.player_sale_listings.push({
        id: 'sl-1', league_id: LEAGUE_ID, player_id: THEIRS, status: 'active', seller_team_id: RIVAL_TEAM_ID,
      });
    });
    const res = await propose(deal());
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cannot include locked players in a trade proposal: Rival Player — bidding is live.');
  });

  it('allows a player whose listing has not gone to auction yet', async () => {
    setup((t) => {
      t.player_sale_listings.push({
        id: 'sl-1', league_id: LEAGUE_ID, player_id: THEIRS, status: 'pending', seller_team_id: RIVAL_TEAM_ID,
      });
    });
    expect((await propose(deal())).status).toBe(201);
  });
});

describe('retained rights', () => {
  function withRight(teamId: string, status = 'retained') {
    return setup((t) => {
      t.departure_decisions.push({ id: 'right-1', league_id: LEAGUE_ID, team_id: teamId, status });
    });
  }

  it('accepts a live right held by the side offering it', async () => {
    withRight(MY_TEAM_ID);
    expect((await propose(deal({ offeredRightIds: ['right-1'] }))).status).toBe(201);
  });

  it('accepts a right that is pending return', async () => {
    withRight(MY_TEAM_ID, 'return_pending');
    expect((await propose(deal({ offeredRightIds: ['right-1'] }))).status).toBe(201);
  });

  it('refuses a right the proposer does not hold', async () => {
    withRight(RIVAL_TEAM_ID);
    const res = await propose(deal({ offeredRightIds: ['right-1'] }));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/offered retained rights are no longer held/);
  });

  it('refuses a lapsed right', async () => {
    withRight(MY_TEAM_ID, 'released');
    const res = await propose(deal({ offeredRightIds: ['right-1'] }));
    expect(res.body.error).toMatch(/offered retained rights are no longer held/);
  });

  it('checks the requested side against the target club', async () => {
    withRight(MY_TEAM_ID);
    const res = await propose(deal({ requestedRightIds: ['right-1'] }));
    expect(res.body.error).toMatch(/requested retained rights are no longer held/);
  });
});

describe('an offer against a sale listing', () => {
  function withListing(extra: Record<string, unknown> = {}) {
    return setup((t) => {
      t.player_sale_listings.push({
        id: 'sl-1',
        league_id: LEAGUE_ID,
        player_id: THEIRS,
        seller_team_id: RIVAL_TEAM_ID,
        status: 'pending',
        min_bid: 20,
        ...extra,
      });
    });
  }

  it('refuses a listing that no longer exists', async () => {
    setup();
    expect((await propose(deal({ saleListingId: 'gone' }))).status).toBe(404);
  });

  it('refuses an offer once bidding has started', async () => {
    // Reached only when the listed player is not himself in the deal, since
    // the locked-player check would otherwise fire first.
    setup((t) => {
      t.player_sale_listings.push({
        id: 'sl-1', league_id: LEAGUE_ID, player_id: 'squad-9',
        seller_team_id: RIVAL_TEAM_ID, status: 'active', min_bid: 20,
      });
    });
    const res = await propose(deal({ saleListingId: 'sl-1' }));
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Bidding has started on this listing — it is now auction-only.');
  });

  it('refuses an offer on a settled listing', async () => {
    withListing({ status: 'sold' });
    const res = await propose(deal({ saleListingId: 'sl-1' }));
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/is sold and no longer accepting offers/);
  });

  it("refuses a listing pinned to the wrong club", async () => {
    withListing({ seller_team_id: 'team-third' });
    const res = await propose(deal({ saleListingId: 'sl-1' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('That listing belongs to a different club.');
  });

  it('refuses an offer that does not ask for the listed player', async () => {
    setup((t) => {
      t.roster_entries.push({ id: 'rival-entry-2', team_id: RIVAL_TEAM_ID, player_id: 'squad-9', status: 'active' });
      t.player_sale_listings.push({
        id: 'sl-1', league_id: LEAGUE_ID, player_id: THEIRS,
        seller_team_id: RIVAL_TEAM_ID, status: 'pending', min_bid: 20,
      });
    });
    const res = await propose(deal({ requestedPlayerIds: ['squad-9'], saleListingId: 'sl-1' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('An offer on a listing must request the listed player.');
  });

  it('refuses a cash-only offer under the published minimum', async () => {
    withListing({ min_bid: 20 });
    const res = await propose(deal({ offeredPlayerIds: [], offeredFaab: 19, saleListingId: 'sl-1' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A cash offer must be at least the minimum bid of €20m.');
  });

  it('accepts a cash-only offer that meets it', async () => {
    withListing({ min_bid: 20 });
    expect((await propose(deal({ offeredPlayerIds: [], offeredFaab: 20, saleListingId: 'sl-1' }))).status).toBe(201);
  });

  it('does not apply the floor to an offer that includes players', async () => {
    // A package's value is not a single number, so the seller judges it.
    withListing({ min_bid: 20 });
    expect((await propose(deal({ offeredFaab: 1, saleListingId: 'sl-1' }))).status).toBe(201);
  });

  it('has no floor to apply when the listing published no minimum', async () => {
    withListing({ min_bid: null });
    expect((await propose(deal({ offeredPlayerIds: [], offeredFaab: 1, saleListingId: 'sl-1' }))).status).toBe(201);
  });
});

describe('countering', () => {
  it('rejects the parent proposal it counters', async () => {
    const tables = setup((t) => {
      t.trade_proposals.push({
        id: 'parent-1', league_id: LEAGUE_ID, team_a_id: RIVAL_TEAM_ID, team_b_id: MY_TEAM_ID, status: 'pending',
      });
    });
    const res = await propose(deal({ parentTradeId: 'parent-1' }));

    expect(res.status).toBe(201);
    expect(tables.trade_proposals.find((t) => t.id === 'parent-1')!.status).toBe('rejected');
    expect(tables.trade_proposals.at(-1)!.parent_trade_id).toBe('parent-1');
  });

  it('leaves a parent that is no longer pending alone', async () => {
    const tables = setup((t) => {
      t.trade_proposals.push({
        id: 'parent-1', league_id: LEAGUE_ID, team_a_id: RIVAL_TEAM_ID, team_b_id: MY_TEAM_ID, status: 'accepted',
      });
    });
    await propose(deal({ parentTradeId: 'parent-1' }));
    expect(tables.trade_proposals.find((t) => t.id === 'parent-1')!.status).toBe('accepted');
  });
});

describe('a proposal that clears everything', () => {
  it('writes the deal as pending, with both sides recorded', async () => {
    const tables = setup();
    const res = await propose(deal({ offeredFaab: 5, message: 'Take it or leave it' }));

    expect(res.status).toBe(201);
    expect(tables.trade_proposals).toHaveLength(1);
    expect(tables.trade_proposals[0]).toMatchObject({
      league_id: LEAGUE_ID,
      team_a_id: MY_TEAM_ID,
      team_b_id: RIVAL_TEAM_ID,
      offered_players: [MINE],
      requested_players: [THEIRS],
      offered_faab: 5,
      requested_faab: 0,
      status: 'pending',
      message: 'Take it or leave it',
    });
  });

  it('sends the counterparty a direct message carrying the trade id', async () => {
    const tables = setup();
    await propose(deal());
    expect(tables.chat_messages).toHaveLength(1);
    expect(tables.chat_messages[0]).toMatchObject({
      sender_id: USER_ID,
      recipient_id: OTHER_USER_ID,
      trade_id: tables.trade_proposals[0].id,
    });
  });
});
