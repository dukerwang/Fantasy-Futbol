/**
 * Resets matchups that were resolved against a PREVIOUS season's player_stats.
 *
 * Signature of the bug (see matchupProcessor season filter fix):
 *   - league holds a full upcoming-season schedule (GW1-38, every GW present)
 *   - yet some matchups are already 'completed'/'live'
 *   - at a gameweek that has zero player_stats rows for the current FPL season
 *
 * Deliberately narrow: leagues whose schedule does NOT span GW1-38 are historical
 * test data from a season that was actually played, and are left untouched.
 *
 * Dry run by default. Pass --apply to write.
 */
import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';

const APPLY = process.argv.includes('--apply');

const env = Object.fromEntries(
  fs.readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// Current FPL season, raw — same derivation the processor and stats writer use.
const bootstrap = await (await fetch('https://fantasy.premierleague.com/api/bootstrap-static/')).json();
const gw1Year = new Date(bootstrap.events.find((e) => e.id === 1).deadline_time).getFullYear();
const CURRENT_SEASON = `${gw1Year}-${String(gw1Year + 1).slice(2)}`;
console.log(`Current FPL season: ${CURRENT_SEASON}`);
console.log(APPLY ? 'MODE: APPLY (writing)\n' : 'MODE: DRY RUN (no writes)\n');

// Which gameweeks have stats for the current season?
const { data: curStats } = await admin
  .from('player_stats')
  .select('gameweek')
  .eq('season', CURRENT_SEASON);
const gwsWithCurrentStats = new Set((curStats ?? []).map((r) => r.gameweek));
console.log(`Gameweeks with ${CURRENT_SEASON} stats: ${gwsWithCurrentStats.size ? [...gwsWithCurrentStats].join(',') : '(none)'}\n`);

const { data: leagues } = await admin.from('leagues').select('id, name, status');

let totalReset = 0;
const skipped = [];

for (const l of leagues ?? []) {
  const { data: ms } = await admin
    .from('matchups')
    .select('id, gameweek, status, score_a, score_b, winner_team_id')
    .eq('league_id', l.id);

  if (!ms?.length) continue;

  const gws = new Set(ms.map((m) => m.gameweek));
  const spansFullSeason = gws.size === 38 && Math.min(...gws) === 1 && Math.max(...gws) === 38;

  const resolved = ms.filter((m) => m.status === 'completed' || m.status === 'live');
  if (!resolved.length) continue;

  const phantom = resolved.filter((m) => !gwsWithCurrentStats.has(m.gameweek));
  if (!phantom.length) continue;

  if (!spansFullSeason) {
    skipped.push(
      `  [${l.status}] ${l.name} — ${phantom.length} resolved matchup(s) at GW${[...new Set(phantom.map((m) => m.gameweek))].join(',')}, ` +
      `but schedule spans ${gws.size} GW(s) (${Math.min(...gws)}-${Math.max(...gws)}), not a fresh GW1-38 slate → LEFT ALONE`
    );
    continue;
  }

  console.log(`--- ${l.name} [${l.status}] (${l.id})`);
  console.log(`    schedule GW1-38 (${ms.length} matchups), resetting ${phantom.length}:`);
  for (const m of phantom) {
    console.log(`      GW${m.gameweek} ${m.status} ${m.score_a}-${m.score_b}${m.winner_team_id ? ' winner=' + m.winner_team_id.slice(0, 8) : ''}`);
  }

  if (APPLY) {
    const { error } = await admin
      .from('matchups')
      .update({ status: 'scheduled', score_a: 0, score_b: 0, winner_team_id: null })
      .in('id', phantom.map((m) => m.id));
    if (error) {
      console.log(`    !! FAILED: ${error.message}`);
      continue;
    }
    console.log(`    ✓ reset ${phantom.length}`);
  }
  totalReset += phantom.length;
}

if (skipped.length) {
  console.log('\nSkipped (not the pre-season bug signature):');
  for (const s of skipped) console.log(s);
}

console.log(`\n${APPLY ? 'Reset' : 'Would reset'} ${totalReset} matchup(s).`);
