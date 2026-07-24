/**
 * Gaffa — orphan player reconciliation (2026-07 sync damage)
 *
 * Context: the 2026-27 rollover sync mis-matched rows, leaving `players` with
 * two classes of bad row:
 *
 *   A. DUPLICATES — an old row for a player who IS still in the PL, while a
 *      separate row carries their live fpl_id. Roster entries pointing at the
 *      old row must be repointed at the live row. If these are left alone,
 *      Season Kickoff treats them as departed and pays compensation for a
 *      player who never left.
 *
 *   B. DEPARTURES — an old row for a player genuinely out of the PL. These are
 *      correct as-is: Kickoff should drop them and pay compensation.
 *
 * Automated name matching CANNOT separate these safely — shared surnames like
 * Silva / Gomes / Neto produce confident false positives. So the A-list below
 * is hand-reviewed, not computed. Anything not on it is treated as B.
 *
 * Usage:
 *   node scratch/reconcile-orphan-players.mjs           # dry run, prints plan
 *   node scratch/reconcile-orphan-players.mjs --apply   # writes
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');

/**
 * Hand-reviewed duplicates: orphan row `name` -> the live FPL full name it is
 * the same human as. Verified individually against the FPL bootstrap.
 * Everything else among the orphans is treated as a genuine PL departure.
 */
const CONFIRMED_DUPLICATES = {
  'Igor Thiago': 'Igor Thiago Nascimento Rodrigues',
  'Jamie Gittens': 'Jamie Bynoe-Gittens',
  'Pedro Porro': 'Pedro Porro Sauceda',
  'Yéremy Pino': 'Yéremy Pino Santos',
  // Mononyms — an earlier scan missed these because it required a surname
  // token to match, which a one-word name can never satisfy. Both verified
  // twice over: present in the FPL bootstrap (ids 472 and 458), and
  // Transfermarkt independently reports them at Forest and Newcastle.
  'Murillo': 'Murillo Costa dos Santos',
  'Joelinton': 'Joelinton Cássio Apolinário de Lira',
};

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    }),
);
const db = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const { data: all } = await db.from('players').select('id,name,web_name,pl_team,fpl_id,is_active,market_value');
const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
const boot = await res.json();
const teamMap = new Map(boot.teams.map((t) => [t.id, t.name]));
const fplById = new Map(boot.elements.map((e) => [e.id, {
  id: e.id, full: `${e.first_name} ${e.second_name}`, web: e.web_name, team: teamMap.get(e.team),
}]));

const { data: entries } = await db.from('roster_entries').select('id,player_id,team_id');
const byPlayer = new Map();
entries.forEach((e) => {
  if (!byPlayer.has(e.player_id)) byPlayer.set(e.player_id, []);
  byPlayer.get(e.player_id).push(e);
});

const liveByFullName = new Map();
for (const p of all) {
  if (p.fpl_id != null && fplById.has(p.fpl_id)) liveByFullName.set(fplById.get(p.fpl_id).full, p);
}

const plan = { repoint: [], deleteOrphan: [], unresolved: [] };

for (const [orphanName, liveFullName] of Object.entries(CONFIRMED_DUPLICATES)) {
  const orphan = all.find((p) => p.name === orphanName && p.fpl_id == null);
  const live = liveByFullName.get(liveFullName);
  if (!orphan || !live) {
    plan.unresolved.push(`${orphanName} -> ${liveFullName} (orphan:${!!orphan} live:${!!live})`);
    continue;
  }
  const orphanEntries = byPlayer.get(orphan.id) ?? [];
  const liveEntries = byPlayer.get(live.id) ?? [];
  const liveTeams = new Set(liveEntries.map((e) => e.team_id));
  for (const e of orphanEntries) {
    // If the team already rosters the live row, repointing would duplicate the
    // player on one roster — drop the stale entry instead.
    if (liveTeams.has(e.team_id)) plan.deleteOrphan.push({ entryId: e.id, orphanName, reason: 'team already owns live row' });
    else plan.repoint.push({ entryId: e.id, from: orphan.id, to: live.id, orphanName, liveFullName });
  }
}

console.log(`=== RECONCILIATION PLAN (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
console.log(`Repoint roster entries onto the live player row: ${plan.repoint.length}`);
for (const r of plan.repoint) console.log(`   entry ${r.entryId.slice(0, 8)}  "${r.orphanName}" -> "${r.liveFullName}"`);
console.log(`\nDelete redundant stale entries: ${plan.deleteOrphan.length}`);
for (const d of plan.deleteOrphan) console.log(`   entry ${d.entryId.slice(0, 8)}  "${d.orphanName}" (${d.reason})`);
if (plan.unresolved.length) {
  console.log(`\n!! UNRESOLVED (fix the mapping before applying): ${plan.unresolved.length}`);
  plan.unresolved.forEach((u) => console.log('   ', u));
}

if (!APPLY) {
  console.log('\nDry run only. Re-run with --apply to write.');
  process.exit(0);
}
if (plan.unresolved.length) {
  console.error('\nRefusing to apply with unresolved mappings.');
  process.exit(1);
}

for (const r of plan.repoint) {
  const { error } = await db.from('roster_entries').update({ player_id: r.to }).eq('id', r.entryId);
  if (error) console.error(`  FAILED repoint ${r.entryId}: ${error.message}`);
}
for (const d of plan.deleteOrphan) {
  const { error } = await db.from('roster_entries').delete().eq('id', d.entryId);
  if (error) console.error(`  FAILED delete ${d.entryId}: ${error.message}`);
}
console.log('\nApplied.');
