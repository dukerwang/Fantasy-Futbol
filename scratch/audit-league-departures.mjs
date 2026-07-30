/** Read-only: what does the live offseason league hold that left the PL? */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const LEAGUE = 'c6567c19-4da4-492b-ad33-5defb3dbec6a';

const { data: teams } = await admin.from('teams').select('id, name, faab_budget').eq('league_id', LEAGUE);
console.log('teams:', teams?.length);

const { data: roster, error } = await admin
  .from('roster_entries')
  .select('id, team_id, player_id, players(name, pl_team, is_active)')
  .in('team_id', (teams ?? []).map((t) => t.id));
if (error) throw error;
console.log('roster entries:', roster?.length);
const gone = (roster ?? []).filter((r) => r.players && !r.players.is_active);
console.log('rostered players no longer in the PL:', gone.length);
gone.forEach((r) => console.log('   ', r.players.name, '-', r.players.pl_team));

for (const table of ['player_departures', 'departure_decisions', 'departures']) {
  const { data, error: e } = await admin.from(table).select('*').limit(5);
  console.log(`\n${table}:`, e ? `(${e.message})` : `${data.length} sample rows`, e ? '' : JSON.stringify(data.slice(0, 2)));
}

const { data: auctions } = await admin
  .from('waiver_claims')
  .select('id, player_id, status, is_auction, team_id, created_at, players(name, pl_team, market_value)')
  .eq('league_id', LEAGUE)
  .eq('is_auction', true)
  .order('created_at', { ascending: false })
  .limit(15);
console.log('\nsystem/auction claims (latest 15):', auctions?.length ?? 0);
(auctions ?? []).forEach((a) =>
  console.log('   ', a.players?.name, a.players?.pl_team, '£' + a.players?.market_value, a.status, a.team_id ? 'manager-bid' : 'system')
);
