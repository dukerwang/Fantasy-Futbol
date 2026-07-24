/**
 * Clears the auction backlog released on 2026-07-24.
 *
 * The nightly high-value sweep had been failing silently on a bad column name
 * since it was written. Fixing that made its first successful run dump every
 * qualifying free agent at once — 260 auctions across 6 leagues — instead of
 * the handful of genuine new arrivals it was meant to surface.
 *
 * Also clears one auction from 2026-07-22: a manager released Casemiro, which
 * correctly opened an auction, but he has since left the Premier League and is
 * owed transfer compensation. Bidding on him is incoherent.
 *
 * DELETE, not status='rejected'. The sweep now skips any player the league has
 * ever system-auctioned, so leaving rejected rows behind would permanently bar
 * these players from a future auction.
 *
 * Preserved: the Daniel Muñoz auction from 2026-07-22 — a legitimate release,
 * and he is still an active Premier League player.
 *
 * Usage:
 *   node scratch/clear-sweep-auctions.mjs           # dry run
 *   node scratch/clear-sweep-auctions.mjs --apply
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const APPLY = process.argv.includes('--apply');
const SWEEP_DATE = '2026-07-24';
const KEEP_PLAYER_NAME = 'Daniel Muñoz';

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

const { data: leagues } = await db.from('leagues').select('id,name');
const leagueName = new Map(leagues.map((l) => [l.id, l.name]));
const { data: players } = await db.from('players').select('id,name,is_active');
const playerById = new Map(players.map((p) => [p.id, p]));

// Every system-seeded auction anchor (team_id IS NULL) still pending.
const { data: anchors, error } = await db
  .from('waiver_claims')
  .select('id,league_id,player_id,created_at,expires_at')
  .eq('is_auction', true)
  .eq('status', 'pending')
  .is('team_id', null);
if (error) throw new Error(error.message);

// Real manager bids live in the same table with team_id set. Deleting an
// anchor out from under live bids would strand them, so check first.
const { data: realBids } = await db
  .from('waiver_claims')
  .select('id,league_id,player_id,team_id,faab_bid,status,created_at')
  .eq('is_auction', true)
  .not('team_id', 'is', null);

const toDelete = [];
const kept = [];
for (const a of anchors) {
  const p = playerById.get(a.player_id);
  const isSweep = a.created_at.slice(0, 10) === SWEEP_DATE;
  const isDepartedDrop = p && !p.is_active;
  if (p?.name === KEEP_PLAYER_NAME) { kept.push({ a, p, why: 'legitimate release, still in PL' }); continue; }
  if (isSweep) toDelete.push({ a, p, why: 'sweep backlog' });
  else if (isDepartedDrop) toDelete.push({ a, p, why: 'player has left the PL' });
  else kept.push({ a, p, why: 'not sweep-created, player still active' });
}

const byLeague = {};
for (const d of toDelete) {
  const k = leagueName.get(d.a.league_id) ?? d.a.league_id;
  byLeague[k] = (byLeague[k] ?? 0) + 1;
}

console.log(`=== CLEAR SWEEP AUCTIONS (${APPLY ? 'APPLY' : 'DRY RUN'}) ===\n`);
console.log(`pending system auctions total: ${anchors.length}`);
console.log(`to delete: ${toDelete.length}`);
for (const [k, v] of Object.entries(byLeague)) console.log(`     ${String(v).padStart(3)}  ${k}`);

console.log(`\nnon-sweep deletions (listed individually):`);
for (const d of toDelete.filter((x) => x.why !== 'sweep backlog')) {
  console.log(`     "${d.p?.name}" — ${d.why} (created ${d.a.created_at.slice(0, 10)})`);
}

console.log(`\nKEEPING ${kept.length}:`);
for (const k of kept) console.log(`     "${k.p?.name}" — ${k.why} (created ${k.a.created_at.slice(0, 10)})`);

const deleteIds = new Set(toDelete.map((d) => d.a.id));

// A bid only belongs to the auction we're about to delete if it is still
// unresolved, or was placed after that auction opened. This table also holds
// bids from previous, long-settled auctions for the same player in the same
// league — Casemiro was won on a €1m bid in April, dropped in July, and
// re-listed — and those are completed history, not live exposure.
const strandedBids = (realBids ?? []).filter((b) => {
  const anchor = toDelete.find(
    (d) => d.a.league_id === b.league_id && d.a.player_id === b.player_id,
  );
  if (!anchor) return false;
  if (b.status !== 'pending') return false;
  return b.created_at >= anchor.a.created_at;
});
console.log(`\nmanager bids attached to anything being deleted: ${strandedBids.length}`);
for (const b of strandedBids) {
  console.log(`     !! "${playerById.get(b.player_id)?.name}" team=${b.team_id.slice(0, 8)} bid=€${b.faab_bid}m status=${b.status}`);
}

if (!APPLY) {
  console.log('\nDry run. Re-run with --apply to delete.');
  process.exit(0);
}
if (strandedBids.length > 0) {
  console.error('\nRefusing to apply: real bids are attached. Resolve or refund those first.');
  process.exit(1);
}

let deleted = 0;
const ids = [...deleteIds];
for (let i = 0; i < ids.length; i += 100) {
  const chunk = ids.slice(i, i + 100);
  const { error: delErr } = await db.from('waiver_claims').delete().in('id', chunk);
  if (delErr) console.error(`  FAILED chunk ${i}: ${delErr.message}`);
  else deleted += chunk.length;
}
console.log(`\nDeleted ${deleted} auction(s).`);
