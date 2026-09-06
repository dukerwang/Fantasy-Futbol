/**
 * The IR route: eligibility, the slot cap, and the kickoff lock.
 *
 * IR has two independent rules and the code enforces them in two different
 * places. This file covers the cap (`leagues.ir_size`, default 2) and the
 * eligibility check; the rule that a healthy player on IR blocks *bidding*
 * lives in the auction bid route and is tested there.
 *
 * The kickoff lock is checked against the SCORING week, not the squad-editor
 * week, because the final sanitize strips IR players out of a saved XI — an
 * IR move after a player has already played would silently zero his points.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakeSupabase, createFakeServerClient, type FakeClient, type Tables } from '@/test/supabaseFake';
import { MY_TEAM_ID, OTHER_USER_ID, RIVAL_TEAM_ID, USER_ID, leagueFixture } from '@/test/leagueFixture';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  admin: null as any,
  lockedPlTeamIds: new Set<number>(),
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => createFakeServerClient(state.user),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => state.admin,
}));
vi.mock('@/lib/fixtures/lockout', () => ({
  getLockedPlTeamIds: async () => state.lockedPlTeamIds,
}));

import { POST } from '../route';

let admin: FakeClient;

const INJURED = 'squad-1';
const HEALTHY = 'squad-2';

function setup(mutate: (tables: Tables) => void = () => {}) {
  const tables = leagueFixture();
  tables.players.find((p) => p.id === INJURED)!.fpl_status = 'i';
  for (const p of tables.players) p.pl_team_id = 11;
  mutate(tables);
  admin = createFakeSupabase(tables, {});
  state.admin = admin;
  return tables;
}

async function ir(body: Record<string, unknown>, teamId = MY_TEAM_ID) {
  const req = { json: async () => body } as any;
  const res = await POST(req, { params: Promise.resolve({ teamId }) });
  return { status: res!.status, body: await res!.json() };
}

function entryFor(tables: Tables, playerId: string) {
  return tables.roster_entries.find((e) => e.player_id === playerId && e.team_id === MY_TEAM_ID)!;
}

/**
 * Tops the squad up to the 22 active places the league allows, so the next
 * activation has nowhere to go. INJURED keeps his existing entry — a second
 * row for the same player would make the route's `.single()` read fail and
 * refuse for the wrong reason.
 */
function fillActiveRoster(tables: Tables) {
  const active = () =>
    tables.roster_entries.filter(
      (e) => e.team_id === MY_TEAM_ID && !['ir', 'taxi', 'loan_in'].includes(e.status),
    ).length;
  let next = 18;
  while (active() < 23) {
    tables.roster_entries.push({
      id: `fill-${next}`,
      team_id: MY_TEAM_ID,
      player_id: `squad-${next}`,
      status: 'active',
    });
    next++;
  }
}

beforeEach(() => {
  state.user = { id: USER_ID };
  state.lockedPlTeamIds = new Set<number>();
  setup();
});

describe('auth and request shape', () => {
  it('rejects an unauthenticated caller', async () => {
    state.user = null;
    expect((await ir({ playerId: INJURED, action: 'move_to_ir' })).status).toBe(401);
  });

  it('rejects an unknown action', async () => {
    expect((await ir({ playerId: INJURED, action: 'retire' })).status).toBe(400);
  });

  it('rejects a swap with no partner, or with itself', async () => {
    expect((await ir({ playerId: INJURED, action: 'swap' })).status).toBe(400);
    expect((await ir({ playerId: INJURED, action: 'swap', swapWithPlayerId: INJURED })).status).toBe(400);
  });

  it("refuses to touch another manager's club", async () => {
    state.user = { id: OTHER_USER_ID };
    expect((await ir({ playerId: INJURED, action: 'move_to_ir' })).status).toBe(403);
  });
});

describe('moving a player to IR', () => {
  it('moves an injured player', async () => {
    const tables = setup();
    const res = await ir({ playerId: INJURED, action: 'move_to_ir' });
    expect(res.status).toBe(200);
    expect(entryFor(tables, INJURED).status).toBe('ir');
  });

  it('refuses a fit player', async () => {
    const res = await ir({ playerId: HEALTHY, action: 'move_to_ir' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not eligible for IR/);
  });

  it('accepts unavailable and doubtful as well as injured', async () => {
    for (const status of ['u', 'd']) {
      const tables = setup((t) => {
        t.players.find((p) => p.id === HEALTHY)!.fpl_status = status;
      });
      expect((await ir({ playerId: HEALTHY, action: 'move_to_ir' })).status).toBe(200);
      expect(entryFor(tables, HEALTHY).status).toBe('ir');
    }
  });

  it('refuses a player who is not on the roster', async () => {
    const res = await ir({ playerId: 'not-mine', action: 'move_to_ir' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Player not on roster');
  });

  it('refuses a player already on IR', async () => {
    setup((t) => { entryFor(t, INJURED).status = 'ir'; });
    const res = await ir({ playerId: INJURED, action: 'move_to_ir' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Player is already on IR');
  });

  it('refuses a loaned player', async () => {
    for (const status of ['loan_in', 'loan_out']) {
      setup((t) => { entryFor(t, INJURED).status = status; });
      const res = await ir({ playerId: INJURED, action: 'move_to_ir' });
      expect(res.status).toBe(400);
      expect(res.body.error).toBe('Cannot move loaned players to IR');
    }
  });

  it('refuses once the IR slots are full', async () => {
    setup((t) => {
      t.players.find((p) => p.id === 'squad-3')!.fpl_status = 'i';
      t.players.find((p) => p.id === 'squad-4')!.fpl_status = 'i';
      entryFor(t, 'squad-3').status = 'ir';
      entryFor(t, 'squad-4').status = 'ir';
    });
    const res = await ir({ playerId: INJURED, action: 'move_to_ir' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('IR is full (2 slots). Activate or drop an IR player first.');
  });

  it("honours a league's own IR size", async () => {
    setup((t) => {
      t.leagues[0].ir_size = 1;
      t.players.find((p) => p.id === 'squad-3')!.fpl_status = 'i';
      entryFor(t, 'squad-3').status = 'ir';
    });
    const res = await ir({ playerId: INJURED, action: 'move_to_ir' });
    expect(res.body.error).toBe('IR is full (1 slots). Activate or drop an IR player first.');
  });
});

describe('the kickoff lock', () => {
  it("refuses an IR move once the player's club has kicked off", async () => {
    setup((t) => {
      t.matchups.push({ id: 'm-1', team_a_id: MY_TEAM_ID, team_b_id: RIVAL_TEAM_ID, status: 'live', gameweek: 4 });
    });
    state.lockedPlTeamIds = new Set([11]);

    const res = await ir({ playerId: INJURED, action: 'move_to_ir' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/match has already kicked off/);
  });

  it('allows the move when a different club has kicked off', async () => {
    const tables = setup((t) => {
      t.matchups.push({ id: 'm-1', team_a_id: MY_TEAM_ID, team_b_id: RIVAL_TEAM_ID, status: 'live', gameweek: 4 });
    });
    state.lockedPlTeamIds = new Set([12]);

    expect((await ir({ playerId: INJURED, action: 'move_to_ir' })).status).toBe(200);
    expect(entryFor(tables, INJURED).status).toBe('ir');
  });

  it('checks the lock against a scheduled matchup too', async () => {
    // Unlike the drop route, IR looks at `scheduled` as well as `live`: the
    // squad editor is already pointing at next week by the time this week's
    // matchup stops being live, and the lock is per-club regardless.
    setup((t) => {
      t.matchups.push({ id: 'm-1', team_a_id: MY_TEAM_ID, team_b_id: RIVAL_TEAM_ID, status: 'scheduled', gameweek: 5 });
    });
    state.lockedPlTeamIds = new Set([11]);

    expect((await ir({ playerId: INJURED, action: 'move_to_ir' })).status).toBe(400);
  });
});

describe('activating from IR', () => {
  it('returns an IR player to the bench', async () => {
    const tables = setup((t) => { entryFor(t, INJURED).status = 'ir'; });
    const res = await ir({ playerId: INJURED, action: 'activate' });
    expect(res.status).toBe(200);
    expect(entryFor(tables, INJURED).status).toBe('bench');
  });

  it('refuses a player who is not on IR', async () => {
    const res = await ir({ playerId: HEALTHY, action: 'activate' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Player is not currently on IR');
  });

  it('refuses when the active roster has no room', async () => {
    setup((t) => {
      fillActiveRoster(t);
      entryFor(t, INJURED).status = 'ir';
    });
    const res = await ir({ playerId: INJURED, action: 'activate' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Active roster is full/);
  });

  it('counts a used slot buyback as an extra place', async () => {
    const tables = setup((t) => {
      fillActiveRoster(t);
      entryFor(t, INJURED).status = 'ir';
      t.player_loans.push({ id: 'loan-1', lender_team_id: MY_TEAM_ID, status: 'active', slot_buyback_used: true });
    });
    expect((await ir({ playerId: INJURED, action: 'activate' })).status).toBe(200);
    expect(entryFor(tables, INJURED).status).toBe('bench');
  });
});

describe('swapping a player into IR', () => {
  function withIrOccupant(mutate: (tables: Tables) => void = () => {}) {
    return setup((t) => {
      t.players.find((p) => p.id === 'squad-3')!.fpl_status = 'i';
      entryFor(t, 'squad-3').status = 'ir';
      mutate(t);
    });
  }

  it('puts the injured player on IR and the recovered one on the bench', async () => {
    const tables = withIrOccupant();
    const res = await ir({ playerId: INJURED, action: 'swap', swapWithPlayerId: 'squad-3' });

    expect(res.status).toBe(200);
    expect(entryFor(tables, INJURED).status).toBe('ir');
    expect(entryFor(tables, 'squad-3').status).toBe('bench');
  });

  it('works in either argument order', async () => {
    const tables = withIrOccupant();
    const res = await ir({ playerId: 'squad-3', action: 'swap', swapWithPlayerId: INJURED });

    expect(res.status).toBe(200);
    expect(entryFor(tables, INJURED).status).toBe('ir');
    expect(entryFor(tables, 'squad-3').status).toBe('bench');
  });

  it('requires both players to be on the roster', async () => {
    withIrOccupant();
    const res = await ir({ playerId: 'not-mine', action: 'swap', swapWithPlayerId: 'squad-3' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Both players must be on your roster');
  });

  it('refuses when neither player is on IR', async () => {
    setup();
    const res = await ir({ playerId: INJURED, action: 'swap', swapWithPlayerId: HEALTHY });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Target player is not currently on IR');
  });

  it('refuses when both are already on IR', async () => {
    withIrOccupant((t) => { entryFor(t, INJURED).status = 'ir'; });
    const res = await ir({ playerId: INJURED, action: 'swap', swapWithPlayerId: 'squad-3' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Both players are already on IR');
  });

  it('refuses to swap in a fit player', async () => {
    withIrOccupant();
    const res = await ir({ playerId: HEALTHY, action: 'swap', swapWithPlayerId: 'squad-3' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not eligible for IR/);
  });

  it('refuses to swap in a loaned player', async () => {
    withIrOccupant((t) => { entryFor(t, INJURED).status = 'loan_in'; });
    const res = await ir({ playerId: INJURED, action: 'swap', swapWithPlayerId: 'squad-3' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Cannot move loaned players to IR');
  });

  it("refuses a swap once either player's club has kicked off", async () => {
    withIrOccupant((t) => {
      t.matchups.push({ id: 'm-1', team_a_id: MY_TEAM_ID, team_b_id: RIVAL_TEAM_ID, status: 'live', gameweek: 4 });
    });
    state.lockedPlTeamIds = new Set([11]);

    const res = await ir({ playerId: INJURED, action: 'swap', swapWithPlayerId: 'squad-3' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/match has already kicked off/);
  });

  it('does not enforce the IR cap on a swap, since the count is unchanged', async () => {
    const tables = withIrOccupant((t) => {
      t.players.find((p) => p.id === 'squad-4')!.fpl_status = 'i';
      entryFor(t, 'squad-4').status = 'ir';
    });
    // Two of two slots are already taken; swapping one out for another keeps
    // it at two.
    const res = await ir({ playerId: INJURED, action: 'swap', swapWithPlayerId: 'squad-3' });
    expect(res.status).toBe(200);
    expect(entryFor(tables, INJURED).status).toBe('ir');
  });
});
