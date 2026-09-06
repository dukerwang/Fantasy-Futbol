/**
 * The fake's own tests.
 *
 * Route tests are only as trustworthy as this file. A fake that quietly
 * disagreed with PostgREST — matching a null on `eq`, returning an empty
 * result instead of an error from `single()`, ignoring a `not(... in ...)` —
 * would turn every route suite green while proving nothing.
 */

import { describe, expect, it } from 'vitest';
import { createFakeSupabase } from '../supabaseFake';

function db() {
  return createFakeSupabase({
    teams: [
      { id: 't1', league_id: 'l1', user_id: 'u1', name: 'One' },
      { id: 't2', league_id: 'l1', user_id: 'u2', name: 'Two' },
      { id: 't3', league_id: 'l2', user_id: 'u3', name: 'Three' },
    ],
    entries: [
      { id: 'e1', team_id: 't1', player_id: 'p1', status: 'active', score: 10 },
      { id: 'e2', team_id: 't1', player_id: 'p2', status: 'ir', score: 30 },
      { id: 'e3', team_id: 't2', player_id: 'p3', status: 'taxi', score: null },
    ],
    players: [
      { id: 'p1', name: 'Alpha', fpl_status: 'a' },
      { id: 'p2', name: 'Beta', fpl_status: 'i' },
      { id: 'p3', name: 'Gamma', fpl_status: 'a' },
    ],
  });
}

describe('filters', () => {
  it('matches eq as text, and never matches a null', async () => {
    const { data } = await db().from('teams').select('id').eq('league_id', 'l1');
    expect(data.map((r: any) => r.id)).toEqual(['t1', 't2']);

    const { data: nulls } = await db().from('entries').select('id').eq('score', null);
    expect(nulls).toEqual([]);
  });

  it('treats neq as including nulls, as PostgREST does not', async () => {
    // Documented divergence: real PostgREST drops null rows on neq. Nothing in
    // the routes depends on that, and matching it would make the common
    // "everyone except me" filter surprising.
    const { data } = await db().from('entries').select('id').neq('team_id', 't1');
    expect(data.map((r: any) => r.id)).toEqual(['e3']);
  });

  it('supports in, is, and a negated in', async () => {
    const inList = await db().from('entries').select('id').in('status', ['ir', 'taxi']);
    expect(inList.data.map((r: any) => r.id)).toEqual(['e2', 'e3']);

    const isNull = await db().from('entries').select('id').is('score', null);
    expect(isNull.data.map((r: any) => r.id)).toEqual(['e3']);

    const notIn = await db().from('entries').select('id').not('status', 'in', '("ir","taxi")');
    expect(notIn.data.map((r: any) => r.id)).toEqual(['e1']);
  });

  it('supports or across columns', async () => {
    const { data } = await db().from('teams').select('id').or('id.eq.t1,id.eq.t3');
    expect(data.map((r: any) => r.id)).toEqual(['t1', 't3']);
  });

  it('supports the comparison operators', async () => {
    const { data } = await db().from('entries').select('id').gt('score', 15);
    expect(data.map((r: any) => r.id)).toEqual(['e2']);
  });
});

describe('shaping', () => {
  it('narrows to the selected columns', async () => {
    const { data } = await db().from('teams').select('id, name').eq('id', 't1');
    expect(data[0]).toEqual({ id: 't1', name: 'One' });
  });

  it('resolves a to-one embed by the conventional foreign key', async () => {
    const { data } = await db().from('entries').select('id, player:players(name, fpl_status)').eq('id', 'e2');
    expect(data[0].player).toEqual({ name: 'Beta', fpl_status: 'i' });
  });

  it('resolves an embed that names its column explicitly', async () => {
    const { data } = await db().from('entries').select('id, holder:teams!team_id(name)').eq('id', 'e1');
    expect(data[0].holder).toEqual({ name: 'One' });
  });

  it('resolves an embed that names a constraint instead of a column', async () => {
    const store = createFakeSupabase({
      trade_proposals: [{ id: 'tr1', team_a_id: 't1', team_b_id: 't2' }],
      teams: [{ id: 't1', name: 'One' }, { id: 't2', name: 'Two' }],
    });
    const { data } = await store
      .from('trade_proposals')
      .select('id, team_a:teams!trade_proposals_team_a_id_fkey(name)');
    expect(data[0].team_a).toEqual({ name: 'One' });
  });

  it('orders, limits, and counts', async () => {
    const ordered = await db().from('entries').select('id').order('score', { ascending: false });
    // Nulls sort last in either direction.
    expect(ordered.data.map((r: any) => r.id)).toEqual(['e2', 'e1', 'e3']);

    const limited = await db().from('entries').select('id').order('score').limit(1);
    expect(limited.data.map((r: any) => r.id)).toEqual(['e1']);

    const counted = await db().from('entries').select('id', { count: 'exact', head: true }).eq('team_id', 't1');
    expect(counted.count).toBe(2);
    expect(counted.data).toBeNull();
  });
});

describe('single and maybeSingle', () => {
  it('errors rather than returning nothing when single() finds no row', async () => {
    const { data, error } = await db().from('teams').select('id').eq('id', 'nope').single();
    expect(data).toBeNull();
    expect(error?.code).toBe('PGRST116');
  });

  it('errors when single() finds more than one', async () => {
    const { error } = await db().from('teams').select('id').eq('league_id', 'l1').single();
    expect(error?.code).toBe('PGRST116');
  });

  it('returns null for maybeSingle() with no row, and errors on two', async () => {
    const none = await db().from('teams').select('id').eq('id', 'nope').maybeSingle();
    expect(none).toEqual({ data: null, error: null });

    const two = await db().from('teams').select('id').eq('league_id', 'l1').maybeSingle();
    expect(two.error?.code).toBe('PGRST116');
  });
});

describe('writes', () => {
  it('inserts and returns the row when asked', async () => {
    const store = db();
    const { data } = await store.from('entries').insert({ team_id: 't3', player_id: 'p9' }).select().single();
    expect(data.team_id).toBe('t3');
    expect(store.__tables.entries).toHaveLength(4);
    expect(store.__writes.at(-1)).toMatchObject({ table: 'entries', op: 'insert' });
  });

  it('updates only the matching rows, in place', async () => {
    const store = db();
    await store.from('entries').update({ status: 'bench' }).eq('id', 'e2');
    expect(store.__tables.entries.map((r: any) => r.status)).toEqual(['active', 'bench', 'taxi']);
  });

  it('deletes the matching rows', async () => {
    const store = db();
    await store.from('entries').delete().eq('team_id', 't1');
    expect(store.__tables.entries.map((r: any) => r.id)).toEqual(['e3']);
  });

  it('upserts on the conflict key rather than duplicating', async () => {
    const store = db();
    await store.from('teams').upsert({ id: 't1', name: 'Renamed' }, { onConflict: 'id' });
    expect(store.__tables.teams).toHaveLength(3);
    expect(store.__tables.teams[0].name).toBe('Renamed');
  });

  it('creates a table it has never seen rather than dropping the write', async () => {
    const store = db();
    await store.from('audit').insert({ what: 'something' });
    expect(store.__tables.audit).toHaveLength(1);
  });
});

describe('rpc', () => {
  it('records the call and unwraps a bare payload', async () => {
    const store = createFakeSupabase({}, { rpc: { do_thing: () => ({ success: true }) } });
    const res = await store.rpc('do_thing', { p_id: 1 });
    expect(res).toEqual({ data: { success: true }, error: null });
    expect(store.__rpcCalls).toEqual([{ name: 'do_thing', args: { p_id: 1 } }]);
  });

  it('passes an envelope through untouched', async () => {
    const store = createFakeSupabase({}, { rpc: { do_thing: () => ({ data: null, error: { message: 'boom' } }) } });
    const res = await store.rpc('do_thing');
    expect(res.error).toEqual({ message: 'boom' });
  });

  it('treats a payload carrying its own error field as a payload', async () => {
    // Gaffa's RPCs return { success: false, error: '...' } as DATA. Reading
    // that as a transport error would turn a 400 refusal into a 500.
    const store = createFakeSupabase({}, { rpc: { do_thing: () => ({ success: false, error: 'refused' }) } });
    const res = await store.rpc('do_thing');
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ success: false, error: 'refused' });
  });

  it('throws on an RPC the test never stubbed', async () => {
    await expect(createFakeSupabase({}).rpc('surprise')).rejects.toThrow(/not stubbed/);
  });
});

describe('isolation', () => {
  it('does not let a handler that mutates a read corrupt later reads', async () => {
    const store = db();
    const { data } = await store.from('teams').select('id, name').eq('id', 't1');
    data[0].name = 'Tampered';

    const again = await store.from('teams').select('name').eq('id', 't1');
    expect(again.data[0].name).toBe('One');
  });

  it('reads an unseeded table as empty rather than throwing', async () => {
    const { data } = await db().from('never_seeded').select('*');
    expect(data).toEqual([]);
  });
});
