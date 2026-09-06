/**
 * Targets: visibility, the caps, and who gets told.
 *
 * The visibility split is the one to get right. This route uses the
 * service-role client, which bypasses RLS entirely, so the `visibility.eq.
 * public,team_id.eq.<mine>` filter in GET is the ONLY thing keeping one
 * manager's private targets out of another's response.
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
import { MAX_ACTIVE_TARGETS, MAX_PUBLIC_TARGETS, TARGET_NOTE_MAX } from '@/lib/transfers/targetLimits';

const state = vi.hoisted(() => ({
  user: null as { id: string } | null,
  admin: null as any,
  notify: null as any,
}));

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => createFakeServerClient(state.user),
}));
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => state.admin,
}));
vi.mock('@/lib/notifications/createNotification', () => ({
  createNotification: (...args: any[]) => state.notify(...args),
}));

import { GET, POST } from '../route';

let admin: FakeClient;

/** A rival's player, so a named target has an owner to notify. */
const WANTED = 'rival-1';

function future(days = 14) {
  return new Date(Date.now() + days * 86_400_000).toISOString();
}

function setup(mutate: (tables: Tables) => void = () => {}) {
  const tables = leagueFixture();
  tables.player_targets = [];
  tables.players.push({
    id: WANTED,
    name: 'Wanted Man',
    market_value: 30,
    primary_position: 'LB',
    secondary_positions: [],
    fpl_status: 'a',
    is_active: true,
  });
  // roster_entries carries league_id of its own; the owner lookup filters on it.
  for (const entry of tables.roster_entries) entry.league_id = LEAGUE_ID;
  tables.roster_entries.push({
    id: 'rival-entry-1', league_id: LEAGUE_ID, team_id: RIVAL_TEAM_ID, player_id: WANTED, status: 'active',
  });
  mutate(tables);
  admin = createFakeSupabase(tables, {});
  state.admin = admin;
  return tables;
}

function target(overrides: Record<string, unknown> = {}) {
  return { targetKind: 'player', playerId: WANTED, ...overrides };
}

async function post(body: Record<string, unknown>) {
  const req = { json: async () => body } as any;
  const res = await POST(req, { params: Promise.resolve({ leagueId: LEAGUE_ID }) });
  return { status: res.status, body: await res.json() };
}

async function get() {
  const res = await GET({} as any, { params: Promise.resolve({ leagueId: LEAGUE_ID }) });
  return { status: res.status, body: await res.json() };
}

/** A stored row, as GET would find it. */
function stored(teamId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    league_id: LEAGUE_ID,
    team_id: teamId,
    target_kind: 'profile',
    player_id: null,
    position: 'CB',
    role: 'starter',
    visibility: 'public',
    open_to_sale: true,
    open_to_trade: false,
    open_to_loan: false,
    budget: null,
    note: null,
    status: 'active',
    expires_at: future(),
    created_at: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  state.user = { id: USER_ID };
  state.notify = vi.fn(async () => {});
  setup();
});

describe('reading the board', () => {
  it('rejects an unauthenticated caller', async () => {
    state.user = null;
    expect((await get()).status).toBe(401);
  });

  it('refuses a caller with no club in this league', async () => {
    setup((t) => { t.teams = t.teams.filter((x) => x.user_id !== USER_ID); });
    expect((await get()).status).toBe(403);
  });

  it("returns public targets from every club, and the caller's own private ones", async () => {
    setup((t) => {
      t.player_targets = [
        stored(RIVAL_TEAM_ID, { id: 'theirs-public', visibility: 'public' }),
        stored(RIVAL_TEAM_ID, { id: 'theirs-private', visibility: 'private', position: 'ST' }),
        stored(MY_TEAM_ID, { id: 'mine-private', visibility: 'private', position: 'GK' }),
      ];
    });

    const ids = (await get()).body.targets.map((t: any) => t.id);
    expect(ids).toContain('theirs-public');
    expect(ids).toContain('mine-private');
    expect(ids).not.toContain('theirs-private');
  });

  it('hides withdrawn and expired targets', async () => {
    setup((t) => {
      t.player_targets = [
        stored(MY_TEAM_ID, { id: 'live' }),
        stored(MY_TEAM_ID, { id: 'withdrawn', status: 'withdrawn', position: 'ST' }),
        stored(MY_TEAM_ID, { id: 'expired', expires_at: new Date(Date.now() - 1000).toISOString(), position: 'GK' }),
      ];
    });

    const ids = (await get()).body.targets.map((t: any) => t.id);
    expect(ids).toEqual(['live']);
  });

  it('leaves another league alone', async () => {
    setup((t) => {
      t.player_targets = [stored(MY_TEAM_ID, { id: 'elsewhere', league_id: 'league-other' })];
    });
    expect((await get()).body.targets).toHaveLength(0);
  });
});

describe('the shape of a new target', () => {
  it('rejects an unauthenticated caller', async () => {
    state.user = null;
    expect((await post(target())).status).toBe(401);
  });

  it('requires a known kind', async () => {
    expect((await post({ targetKind: 'wishlist' })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });

  it('requires a player on a named target', async () => {
    const res = await post({ targetKind: 'player' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('A named target needs a player');
  });

  it('requires one of the twelve tactical positions on a profile', async () => {
    const res = await post({ targetKind: 'profile', position: 'MID', role: 'starter' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/12 tactical positions/);
  });

  it('requires a squad role on a profile', async () => {
    const res = await post({ targetKind: 'profile', position: 'LB' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Pick a squad role');
  });

  it('accepts a well-formed profile', async () => {
    const tables = setup();
    const res = await post({ targetKind: 'profile', position: 'LB', role: 'starter' });
    expect(res.status).toBe(201);
    expect(tables.player_targets[0]).toMatchObject({
      target_kind: 'profile', position: 'LB', role: 'starter', player_id: null,
    });
  });

  it('refuses a fractional or negative budget', async () => {
    expect((await post(target({ budget: 12.5 }))).status).toBe(400);
    expect((await post(target({ budget: -5 }))).status).toBe(400);
  });

  it('refuses an over-long note, and trims a good one', async () => {
    expect((await post(target({ note: 'x'.repeat(TARGET_NOTE_MAX + 1) }))).status).toBe(400);

    const tables = setup();
    await post(target({ note: '  will pay cash  ' }));
    expect(tables.player_targets[0].note).toBe('will pay cash');
  });

  it('stores an empty note as nothing at all', async () => {
    const tables = setup();
    await post(target({ note: '   ' }));
    expect(tables.player_targets[0].note).toBeNull();
  });

  it('defaults to public and to being open to a cash deal', async () => {
    const tables = setup();
    await post(target());
    expect(tables.player_targets[0]).toMatchObject({
      visibility: 'public', open_to_sale: true, open_to_trade: false, open_to_loan: false,
    });
  });
});

describe('you cannot want what you already have', () => {
  it('refuses a named target for a player already on the roster', async () => {
    const res = await post(target({ playerId: 'squad-1' }));
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('He already plays for you');
  });

  it("does not stop a profile at a position the club already fields", async () => {
    expect((await post({ targetKind: 'profile', position: 'CM', role: 'star' })).status).toBe(201);
  });
});

describe('the caps', () => {
  it('refuses an eleventh live target', async () => {
    setup((t) => {
      t.player_targets = Array.from({ length: MAX_ACTIVE_TARGETS }, (_, i) =>
        stored(MY_TEAM_ID, { visibility: 'private', position: null, target_kind: 'player', player_id: `squad-${i}` }),
      );
    });
    const res = await post(target());
    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(new RegExp(`tracking ${MAX_ACTIVE_TARGETS} targets already`));
  });

  it('counts only this club against the cap', async () => {
    setup((t) => {
      t.player_targets = Array.from({ length: MAX_ACTIVE_TARGETS }, (_, i) =>
        stored(RIVAL_TEAM_ID, { target_kind: 'player', player_id: `squad-${i}`, position: null }),
      );
    });
    expect((await post(target())).status).toBe(201);
  });

  it('refuses a sixth public target but allows it as private', async () => {
    const build = (t: Tables) => {
      t.player_targets = Array.from({ length: MAX_PUBLIC_TARGETS }, (_, i) =>
        stored(MY_TEAM_ID, { target_kind: 'player', player_id: `squad-${i}`, position: null }),
      );
    };

    setup(build);
    const refused = await post(target());
    expect(refused.status).toBe(409);
    expect(refused.body.error).toMatch(new RegExp(`show ${MAX_PUBLIC_TARGETS} targets to the league`));

    setup(build);
    expect((await post(target({ visibility: 'private' }))).status).toBe(201);
  });

  it('does not count an expired target against either cap', async () => {
    setup((t) => {
      t.player_targets = Array.from({ length: MAX_ACTIVE_TARGETS }, (_, i) =>
        stored(MY_TEAM_ID, {
          target_kind: 'player', player_id: `squad-${i}`, position: null,
          expires_at: new Date(Date.now() - 1000).toISOString(),
        }),
      );
    });
    expect((await post(target())).status).toBe(201);
  });
});

describe('duplicates', () => {
  it('refuses a second target for the same player', async () => {
    setup((t) => {
      t.player_targets = [stored(MY_TEAM_ID, { target_kind: 'player', player_id: WANTED, position: null })];
    });
    const res = await post(target());
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("You're already tracking this one");
  });

  it('refuses a second profile at the same position', async () => {
    setup((t) => { t.player_targets = [stored(MY_TEAM_ID, { position: 'LB' })]; });
    const res = await post({ targetKind: 'profile', position: 'LB', role: 'bench' });
    expect(res.status).toBe(409);
  });

  it("does not treat another club's identical target as a duplicate", async () => {
    setup((t) => {
      t.player_targets = [stored(RIVAL_TEAM_ID, { target_kind: 'player', player_id: WANTED, position: null })];
    });
    expect((await post(target())).status).toBe(201);
  });
});

describe('telling the owner', () => {
  it('tells the club that holds a publicly named target', async () => {
    await post(target({ budget: 40 }));
    expect(state.notify).toHaveBeenCalledTimes(1);
    expect(state.notify.mock.calls[0][1]).toMatchObject({
      kind: 'targets',
      leagueId: LEAGUE_ID,
      userId: OTHER_USER_ID,
    });
  });

  it('tells nobody about a private target', async () => {
    await post(target({ visibility: 'private' }));
    expect(state.notify).not.toHaveBeenCalled();
  });

  it('tells nobody about a profile', async () => {
    // "A left-back is wanted" would reach every club that owns one.
    await post({ targetKind: 'profile', position: 'LB', role: 'starter' });
    expect(state.notify).not.toHaveBeenCalled();
  });

  it('tells nobody when the player is a free agent', async () => {
    setup((t) => { t.roster_entries = t.roster_entries.filter((e) => e.player_id !== WANTED); });
    const res = await post(target());
    expect(res.status).toBe(201);
    expect(state.notify).not.toHaveBeenCalled();
  });

  it('still writes the target when the notification fails', async () => {
    state.notify = vi.fn(async () => { throw new Error('push service down'); });
    const tables = setup();
    expect((await post(target())).status).toBe(201);
    expect(tables.player_targets).toHaveLength(1);
  });
});
