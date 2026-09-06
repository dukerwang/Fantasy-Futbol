/**
 * Gaffa — target matching
 *
 * Two different things are worth pinning here, and they need different tools.
 *
 * The FILTER the module builds is asserted as a string, because that is what
 * actually reaches PostgREST and it is where the interesting decisions live:
 * whether secondary positions are included, whether junk positions are
 * whitelisted out, whether a floor produces a budget clause at all. The fake
 * client below deliberately does NOT implement PostgREST semantics — a fake
 * that reimplemented them could agree with itself while the real query did
 * something else.
 *
 * The LOGIC after the query — one notice per club, named beats profile, a
 * club that already owns the player hears nothing — runs on rows the fake
 * hands back, and is asserted on the returned matches.
 */

import { describe, it, expect } from 'vitest';
import { matchTargets } from '../matchTargets';
import type { PlayerTarget } from '@/types';

interface Recorded {
  table: string;
  eq: [string, unknown][];
  neq: [string, unknown][];
  gt: [string, unknown][];
  in: [string, unknown[]][];
  or: string[];
}

/** Canned tables plus a record of every filter the module applied. */
function fakeClient(tables: Record<string, unknown[]>) {
  const calls: Recorded[] = [];

  const client = {
    from(table: string) {
      const rec: Recorded = { table, eq: [], neq: [], gt: [], in: [], or: [] };
      calls.push(rec);

      const builder = {
        select() { return builder; },
        eq(col: string, val: unknown) { rec.eq.push([col, val]); return builder; },
        neq(col: string, val: unknown) { rec.neq.push([col, val]); return builder; },
        gt(col: string, val: unknown) { rec.gt.push([col, val]); return builder; },
        in(col: string, vals: unknown[]) { rec.in.push([col, vals]); return builder; },
        or(clause: string) { rec.or.push(clause); return builder; },
        then(resolve: (r: { data: unknown[]; error: null }) => unknown) {
          return Promise.resolve(resolve({ data: tables[table] ?? [], error: null }));
        },
      };
      return builder;
    },
  };

  return { client, calls, of: (t: string) => calls.filter((c) => c.table === t) };
}

function target(over: Partial<PlayerTarget> = {}): PlayerTarget {
  return {
    id: 't1',
    league_id: 'L',
    team_id: 'teamA',
    target_kind: 'profile',
    player_id: null,
    position: 'LB',
    role: 'starter',
    visibility: 'public',
    open_to_sale: true,
    open_to_trade: false,
    open_to_loan: false,
    budget: null,
    note: null,
    status: 'active',
    expires_at: '2099-01-01T00:00:00Z',
    created_at: '2026-09-01T00:00:00Z',
    updated_at: '2026-09-01T00:00:00Z',
    ...over,
  };
}

const TEAMS = [
  { id: 'teamA', team_name: 'Palace', user_id: 'userA' },
  { id: 'teamB', team_name: 'Chelsea', user_id: 'userB' },
];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asClient = (c: unknown) => c as any;

describe('matchTargets — the filter it builds', () => {
    it('matches the named player OR any of his positions, primary and secondary', async () => {
        const { client, of } = fakeClient({ player_targets: [], teams: [], roster_entries: [] });

        await matchTargets(asClient(client), 'L', {
            id: 'p1',
            primary_position: 'CB',
            secondary_positions: ['LB', 'RB'],
        });

        expect(of('player_targets')[0].or[0]).toBe('player_id.eq.p1,position.in.(CB,LB,RB)');
    });

    it('drops positions that are not part of the 12-position taxonomy', async () => {
        const { client, of } = fakeClient({ player_targets: [], teams: [], roster_entries: [] });

        await matchTargets(asClient(client), 'L', {
            id: 'p1',
            primary_position: 'DEF',           // a coarse FPL bucket, not ours
            secondary_positions: ['LB', 'MID'],
        });

        expect(of('player_targets')[0].or[0]).toBe('player_id.eq.p1,position.in.(LB)');
    });

    it('falls back to the named player alone when he has no usable position', async () => {
        const { client, of } = fakeClient({ player_targets: [], teams: [], roster_entries: [] });

        await matchTargets(asClient(client), 'L', {
            id: 'p1',
            primary_position: null,
            secondary_positions: null,
        });

        expect(of('player_targets')[0].or[0]).toBe('player_id.eq.p1');
    });

    it('adds a budget clause only when the event carries a floor', async () => {
        const withFloor = fakeClient({ player_targets: [], teams: [], roster_entries: [] });
        await matchTargets(asClient(withFloor.client), 'L', { id: 'p1', primary_position: 'LB' }, { floor: 25 });
        expect(withFloor.of('player_targets')[0].or).toContain('budget.is.null,budget.gte.25');

        // An offers-only listing has no number to compare against, so nobody
        // is filtered out on price.
        const noFloor = fakeClient({ player_targets: [], teams: [], roster_entries: [] });
        await matchTargets(asClient(noFloor.client), 'L', { id: 'p1', primary_position: 'LB' });
        expect(noFloor.of('player_targets')[0].or).toHaveLength(1);
    });

    it('only ever looks at active, unexpired targets in the one league', async () => {
        const { client, of } = fakeClient({ player_targets: [], teams: [], roster_entries: [] });
        await matchTargets(asClient(client), 'L', { id: 'p1', primary_position: 'LB' });

        const q = of('player_targets')[0];
        expect(q.eq).toContainEqual(['league_id', 'L']);
        expect(q.eq).toContainEqual(['status', 'active']);
        expect(q.gt.map(([col]) => col)).toContain('expires_at');
    });

    it('excludes the selling club so a seller never answers his own listing', async () => {
        const { client, of } = fakeClient({ player_targets: [], teams: [], roster_entries: [] });
        await matchTargets(asClient(client), 'L', { id: 'p1', primary_position: 'LB' }, { excludeTeamId: 'teamB' });

        expect(of('player_targets')[0].neq).toContainEqual(['team_id', 'teamB']);
    });
});

describe('matchTargets — what it returns', () => {
    it('gives a club one match even when a named target and a profile both hit', async () => {
        const { client } = fakeClient({
            player_targets: [
                target({ id: 'profile', team_id: 'teamA', target_kind: 'profile', position: 'LB' }),
                target({ id: 'named', team_id: 'teamA', target_kind: 'player', position: null, player_id: 'p1' }),
            ],
            teams: TEAMS,
            roster_entries: [],
        });

        const matches = await matchTargets(asClient(client), 'L', { id: 'p1', primary_position: 'LB' });

        expect(matches).toHaveLength(1);
        expect(matches[0].target.id).toBe('named');
        expect(matches[0].named).toBe(true);
    });

    it('keeps the named target regardless of which row came back first', async () => {
        const { client } = fakeClient({
            player_targets: [
                target({ id: 'named', team_id: 'teamA', target_kind: 'player', position: null, player_id: 'p1' }),
                target({ id: 'profile', team_id: 'teamA', target_kind: 'profile', position: 'LB' }),
            ],
            teams: TEAMS,
            roster_entries: [],
        });

        const matches = await matchTargets(asClient(client), 'L', { id: 'p1', primary_position: 'LB' });
        expect(matches).toHaveLength(1);
        expect(matches[0].target.id).toBe('named');
    });

    it('says nothing to a club that already owns the player', async () => {
        const { client } = fakeClient({
            player_targets: [
                target({ id: 'a', team_id: 'teamA' }),
                target({ id: 'b', team_id: 'teamB' }),
            ],
            teams: TEAMS,
            roster_entries: [{ team_id: 'teamA' }],
        });

        const matches = await matchTargets(asClient(client), 'L', { id: 'p1', primary_position: 'LB' });

        expect(matches.map((m) => m.team.id)).toEqual(['teamB']);
    });

    it('carries the club through so the caller can notify and name it', async () => {
        const { client } = fakeClient({
            player_targets: [target({ team_id: 'teamB' })],
            teams: TEAMS,
            roster_entries: [],
        });

        const [match] = await matchTargets(asClient(client), 'L', { id: 'p1', primary_position: 'LB' });

        expect(match.team).toEqual({ id: 'teamB', team_name: 'Chelsea', user_id: 'userB' });
        expect(match.named).toBe(false);
    });

    it('drops a target whose club no longer exists rather than throwing', async () => {
        const { client } = fakeClient({
            player_targets: [target({ team_id: 'ghost' })],
            teams: TEAMS,
            roster_entries: [],
        });

        await expect(matchTargets(asClient(client), 'L', { id: 'p1', primary_position: 'LB' })).resolves.toEqual([]);
    });

    it('short-circuits before the follow-up lookups when nothing matched', async () => {
        const { client, of } = fakeClient({ player_targets: [], teams: TEAMS, roster_entries: [] });

        await matchTargets(asClient(client), 'L', { id: 'p1', primary_position: 'LB' });

        expect(of('teams')).toHaveLength(0);
        expect(of('roster_entries')).toHaveLength(0);
    });
});
