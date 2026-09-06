/**
 * The drop route: severance, and the deferral rule.
 *
 * Two things here are easy to get wrong and cost real money when they are.
 * Severance is 20% of market value with a €2m floor and is charged on a plain
 * drop only, never on a transfer out. And a drop defers only when a matchup is
 * actually `live` — the whole season's matchups are inserted upfront as
 * `scheduled`, so deferring on `scheduled` would freeze every drop from the
 * moment the fixtures are generated.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, createFakeServerClient, type FakeClient, type Tables } from '@/test/supabaseFake';
import { LEAGUE_ID, MY_TEAM_ID, OTHER_USER_ID, USER_ID, leagueFixture } from '@/test/leagueFixture';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  admin: null as any,
  executeDrop: null as any,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => createFakeServerClient(state.user),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => state.admin,
}));
vi.mock('@/lib/roster/executeDrop', () => ({
  executeDrop: (...args: any[]) => state.executeDrop(...args),
}));
vi.mock('@/lib/notifications/createNotification', () => ({
  createNotification: vi.fn(async () => {}),
}));

import { POST } from '../route';

let admin: FakeClient;

/** The squad player every test drops, priced so severance is a round number. */
const DROP_ID = 'squad-1';

function setup(mutate: (tables: Tables) => void = () => {}) {
  const tables = leagueFixture();
  tables.players.find((p) => p.id === DROP_ID)!.market_value = 50;
  mutate(tables);
  admin = createFakeSupabase(tables, {});
  state.admin = admin;
  return tables;
}

async function drop(body: Record<string, unknown>, teamId = MY_TEAM_ID) {
  const req = { json: async () => body } as any;
  const res = await POST(req, { params: Promise.resolve({ teamId }) });
  return { status: res.status, body: await res.json() };
}

beforeEach(() => {
  state.user = { id: USER_ID };
  state.executeDrop = vi.fn(async () => {});
  setup();
});

describe('auth and ownership', () => {
  it('rejects an unauthenticated caller', async () => {
    state.user = null;
    expect((await drop({ playerId: DROP_ID, actionType: 'drop' })).status).toBe(401);
  });

  it('requires a player and an action type', async () => {
    expect((await drop({ actionType: 'drop' })).status).toBe(400);
    expect((await drop({ playerId: DROP_ID })).status).toBe(400);
  });

  it("refuses to drop from somebody else's club", async () => {
    state.user = { id: OTHER_USER_ID };
    expect((await drop({ playerId: DROP_ID, actionType: 'drop' })).status).toBe(403);
  });

  it('refuses a player who is not on the roster', async () => {
    const res = await drop({ playerId: 'not-mine', actionType: 'drop' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Player not on roster');
  });
});

describe('the offseason lock', () => {
  it('refuses every drop while rosters are locked', async () => {
    setup((t) => { t.leagues[0].roster_locked = true; });
    const res = await drop({ playerId: DROP_ID, actionType: 'drop' });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/locked during the offseason/);
  });
});

describe('transfer out', () => {
  it('refuses a transfer out while the player is still in the Premier League', async () => {
    const res = await drop({ playerId: DROP_ID, actionType: 'transfer_out' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/still active in the Premier League/);
  });

  it('allows a transfer out once he has left', async () => {
    setup((t) => { t.players.find((p) => p.id === DROP_ID)!.is_active = false; });
    expect((await drop({ playerId: DROP_ID, actionType: 'transfer_out' })).status).toBe(200);
    expect(state.executeDrop).toHaveBeenCalledWith(expect.anything(), MY_TEAM_ID, DROP_ID, 'transfer_out');
  });

  it('charges no severance on a transfer out, however poor the club', async () => {
    setup((t) => {
      t.players.find((p) => p.id === DROP_ID)!.is_active = false;
      t.teams.find((x) => x.id === MY_TEAM_ID)!.faab_budget = 0;
    });
    expect((await drop({ playerId: DROP_ID, actionType: 'transfer_out' })).status).toBe(200);
  });
});

describe('severance', () => {
  it('refuses a drop the club cannot afford, and names the fee', async () => {
    setup((t) => { t.teams.find((x) => x.id === MY_TEAM_ID)!.faab_budget = 9; });
    const res = await drop({ playerId: DROP_ID, actionType: 'drop' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Severance fee: €10m/);
  });

  it('allows the drop when the balance exactly covers the fee', async () => {
    setup((t) => { t.teams.find((x) => x.id === MY_TEAM_ID)!.faab_budget = 10; });
    expect((await drop({ playerId: DROP_ID, actionType: 'drop' })).status).toBe(200);
  });

  it('applies the €2m floor to a cheap player', async () => {
    // 20% of €5m is €1m, but the floor is €2m.
    setup((t) => {
      t.players.find((p) => p.id === DROP_ID)!.market_value = 5;
      t.teams.find((x) => x.id === MY_TEAM_ID)!.faab_budget = 1;
    });
    const res = await drop({ playerId: DROP_ID, actionType: 'drop' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Severance fee: €2m/);
  });

  it('rounds the fee down rather than up', async () => {
    // 20% of €47m is €9.4m.
    setup((t) => {
      t.players.find((p) => p.id === DROP_ID)!.market_value = 47;
      t.teams.find((x) => x.id === MY_TEAM_ID)!.faab_budget = 8;
    });
    const res = await drop({ playerId: DROP_ID, actionType: 'drop' });
    expect(res.body.error).toMatch(/Severance fee: €9m/);
  });
});

describe('deferral while a gameweek is being played', () => {
  it('queues the drop when a matchup is live', async () => {
    const tables = setup((t) => {
      t.matchups.push({ id: 'm-1', team_a_id: MY_TEAM_ID, team_b_id: 'team-rival', status: 'live', gameweek: 4 });
    });

    const res = await drop({ playerId: DROP_ID, actionType: 'drop' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, deferred: true });
    expect(res.body.message).toMatch(/end of Gameweek 4/);
    expect(state.executeDrop).not.toHaveBeenCalled();
    expect(tables.pending_drops).toHaveLength(1);
    expect(tables.pending_drops[0]).toMatchObject({
      league_id: LEAGUE_ID,
      team_id: MY_TEAM_ID,
      player_id: DROP_ID,
      action_type: 'drop',
    });
  });

  it('does not defer for a merely scheduled matchup', async () => {
    // Every fixture in the season exists as `scheduled` from the day the
    // schedule is generated. Deferring on that status would queue every drop
    // in the league forever.
    const tables = setup((t) => {
      t.matchups.push({ id: 'm-1', team_a_id: MY_TEAM_ID, team_b_id: 'team-rival', status: 'scheduled', gameweek: 4 });
    });

    const res = await drop({ playerId: DROP_ID, actionType: 'drop' });
    expect(res.status).toBe(200);
    expect(res.body.deferred).toBeUndefined();
    expect(state.executeDrop).toHaveBeenCalled();
    expect(tables.pending_drops).toHaveLength(0);
  });

  it("ignores another club's live matchup", async () => {
    setup((t) => {
      t.matchups.push({ id: 'm-1', team_a_id: 'team-rival', team_b_id: 'team-third', status: 'live', gameweek: 4 });
    });

    const res = await drop({ playerId: DROP_ID, actionType: 'drop' });
    expect(res.body.deferred).toBeUndefined();
    expect(state.executeDrop).toHaveBeenCalled();
  });
});

describe('failures from the drop itself', () => {
  it('reports the reason rather than a bare 500 body', async () => {
    state.executeDrop = vi.fn(async () => {
      throw new Error('Player is in an active loan');
    });
    const res = await drop({ playerId: DROP_ID, actionType: 'drop' });
    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Player is in an active loan');
  });
});
