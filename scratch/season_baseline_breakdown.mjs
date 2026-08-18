/**
 * Season-averaged baseline-rule data for the player card, straight out of the
 * REAL engine — so the prototype is built on numbers the implementation will
 * actually produce, not on plausible-looking mock values. `matchRating.ts` has
 * only a type-only import, so Node 25 strips its types and imports it directly;
 * no offline replica, and therefore nothing that can drift from the engine.
 *
 * WHY THE AVERAGE IS OF THE SCORES, NOT OF THE STATS. Each component score is
 * a logistic CDF centred on the positional median, so the mean across a
 * player's appearances is still a 0-1 quantity where 0.5 reads as "at his
 * position's median, week in week out" — which is exactly what the rule's tick
 * already means, so the caption needs no change. Averaging the raw stats first
 * and normalising once would give a different and less honest number: the
 * sigmoid is not linear, so one enormous game drags a raw mean in a way it
 * cannot drag a mean of already-saturated scores.
 *
 *   node scratch/season_baseline_breakdown.mjs [season]
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating.ts';

const ROOT = '/Users/dukewang/Fantasy Futbol';
if (existsSync(`${ROOT}/.env.local`)) {
  for (const line of readFileSync(`${ROOT}/.env.local`, 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const season = process.argv[2] ?? '2025-26';
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

/* Same merge loadReferenceStats() does, inlined so this script needs no path
   alias resolution. Falls back to the engine's own defaults per component. */
const refStats = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
const { data: refRows } = await admin
  .from('rating_reference_stats')
  .select('position_group, component, median, stddev')
  .eq('season', season);
for (const r of refRows ?? []) {
  if (refStats[r.position_group]?.[r.component]) {
    refStats[r.position_group][r.component] = { median: Number(r.median), stddev: Number(r.stddev) };
  }
}
console.log(`reference stats: ${refRows?.length ?? 0} rows for ${season}\n`);

/** A handful of real players spanning the spine, for the prototype's cards. */
const WANTED = ['Bruno Fernandes', 'Bukayo Saka', 'Virgil van Dijk', 'David Raya', 'Alexander Isak'];

const { data: players } = await admin
  .from('players')
  .select('id, name, web_name, primary_position, secondary_positions, pl_team, photo_url, market_value, total_points, ppg, form_rating')
  .in('name', WANTED);

for (const p of players ?? []) {
  const { data: rows } = await admin
    .from('player_stats')
    .select('gameweek, fantasy_points, match_rating, stats')
    .eq('player_id', p.id)
    .eq('season', season);

  const played = (rows ?? []).filter((r) => Number(r.stats?.minutes_played ?? 0) > 0);
  console.log(`\n── ${p.name} — ${p.primary_position} · ${p.pl_team} · ${played.length} apps`);
  if (played.length === 0) continue;

  const sum = new Map();
  let composite = 0;
  for (const r of played) {
    const mr = calculateMatchRating(r.stats, p.primary_position, refStats);
    for (const item of mr.breakdown) {
      if (item.weight <= 0) continue;
      const acc = sum.get(item.key) ?? { component: item.component, weight: item.weight, total: 0, n: 0 };
      acc.total += item.score;
      acc.n += 1;
      sum.set(item.key, acc);
    }
    composite += mr.breakdown.reduce((s, i) => s + i.weighted, 0);
  }

  const breakdown = [...sum.entries()]
    .map(([key, a]) => ({ key, component: a.component, weight: a.weight, score: a.total / a.n }))
    .sort((a, b) => b.score - a.score);

  const pts = played.reduce((s, r) => s + Number(r.fantasy_points), 0);
  const code = (p.photo_url ?? '').match(/(\d+)\.png$/)?.[1] ?? null;

  console.log(`   code ${code}   value €${p.market_value}m   form ${p.form_rating}`);
  console.log(`   pts ${pts.toFixed(2)}   ppg ${(pts / played.length).toFixed(2)}`);
  console.log(`   composite ${(composite / played.length).toFixed(4)}   ← the figure's band keys on THIS, not on the point total`);
  for (const b of breakdown) {
    console.log(`   ${b.component.padEnd(18)} ${(b.score * 100).toFixed(1).padStart(5)}   w=${b.weight}`);
  }
  console.log(`   JS: ${JSON.stringify(breakdown.map((b) => [b.component, +(b.score * 100).toFixed(1)]))}`);
}
