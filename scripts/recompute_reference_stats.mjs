/**
 * scripts/recompute_reference_stats.mjs
 *
 * Recomputes the per-position median + stddev for every component the scoring
 * engine sigmoid-normalizes against, using the current season's FPL live data
 * as the source of truth. Writes results to the `rating_reference_stats` table.
 *
 * Run:
 *   node scripts/recompute_reference_stats.mjs                  # current FPL season
 *   node scripts/recompute_reference_stats.mjs --season 2025-26 # explicit
 *   node scripts/recompute_reference_stats.mjs --dry-run        # print only
 *
 * Requires env vars: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 * Reads from .env.local automatically if present.
 *
 * Why this exists:
 *   The original reference stats were computed from vaastav historical CSVs
 *   that predate FPL's granular defensive fields (tackles, CBI, recoveries,
 *   defensive_contribution). Those fields are live in 25/26+, so the engine
 *   needs reference stats derived from the same data the engine actually sees.
 *
 *   The defensive raw input is position-specific to match
 *   `src/lib/scoring/matchRating.ts` `computeComponentScores`:
 *     GK:                  0 (defense delegated to save_score)
 *     CB:                  tackles + CBI*0.5
 *     LB/RB/LWB/RWB:       defensive_contribution + recoveries*0.5
 *     DM/CM/AM/LW/RW/ST:   defensive_contribution
 *   Plus the outcome modifiers (csBonus, xgcOutperf, gcPenalty).
 */

import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const seasonArg = args.find((a) => a.startsWith('--season='))?.split('=')[1]
  ?? (() => {
    const idx = args.indexOf('--season');
    return idx >= 0 ? args[idx + 1] : null;
  })();

// ── env loading (.env.local fallback) ─────────────────────────────────
if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
const COMPONENTS = [
  'match_impact',
  'influence',
  'creativity',
  'threat',
  'defensive',
  'goal_involvement',
  'finishing',
  'save_score',
];
const FPL_BASE = 'https://fantasy.premierleague.com/api';
const FETCH_HEADERS = { 'User-Agent': 'FantasyFutbol/1.0' };

function positionGroup(pos) {
  if (pos === 'GK') return 'GK';
  if (['CB', 'LB', 'RB', 'LWB', 'RWB'].includes(pos)) return 'DEF';
  if (['DM', 'CM', 'AM'].includes(pos)) return 'MID';
  return 'ATT';
}

function defensiveRawInput(s, pos) {
  const gc = s.goals_conceded ?? 0;
  const xgc = parseFloat(s.expected_goals_conceded) || 0;
  const minutes = s.minutes ?? 0;
  const cleanSheet = (s.clean_sheets ?? 0) > 0;

  let csBonus = 0;
  if (cleanSheet && minutes >= 60) {
    const pg = positionGroup(pos);
    if (pg === 'GK' || pg === 'DEF' || pos === 'DM') csBonus = 12;
    else if (pos === 'CM') csBonus = 4;
  }

  const xgcOutperf = Math.max(0, xgc - gc) * 5;
  const gcPenalty = Math.max(0, gc - xgc) * 5;

  const tackles = Math.max(0, s.tackles ?? 0);
  const cbi = Math.max(0, s.clearances_blocks_interceptions ?? 0);
  const recoveries = Math.max(0, s.recoveries ?? 0);
  const dc = Math.max(0, s.defensive_contribution ?? 0);

  let defActionsRaw;
  if (pos === 'GK') defActionsRaw = 0;
  else if (pos === 'CB') defActionsRaw = tackles + cbi * 0.5;
  else if (['LB', 'RB', 'LWB', 'RWB'].includes(pos)) defActionsRaw = dc + recoveries * 0.5;
  else defActionsRaw = dc;

  return defActionsRaw + csBonus + xgcOutperf - gcPenalty;
}

function saveScoreRaw(s) {
  const gc = s.goals_conceded ?? 0;
  const xgc = parseFloat(s.expected_goals_conceded) || 0;
  const sv = s.saves ?? 0;
  const psav = s.penalties_saved ?? 0;
  return sv * 2 + psav * 5 - Math.max(0, gc - xgc) * 2;
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function pstdev(arr) {
  if (arr.length === 0) return 1;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) * (v - mean), 0) / arr.length;
  const sd = Math.sqrt(variance);
  return sd < 0.001 ? 1 : sd;
}

async function detectCompletedGameweeks() {
  const res = await fetch(`${FPL_BASE}/bootstrap-static/`, { headers: FETCH_HEADERS });
  const data = await res.json();
  return (data.events ?? []).filter((e) => e.finished).map((e) => e.id);
}

async function getCurrentFplSeason() {
  // Derive from current year + bootstrap events.
  // FPL doesn't publish season metadata on bootstrap-static; conventional naming
  // is YYYY-YY based on the year of GW1's deadline.
  const res = await fetch(`${FPL_BASE}/bootstrap-static/`, { headers: FETCH_HEADERS });
  const data = await res.json();
  const gw1 = (data.events ?? []).find((e) => e.id === 1);
  if (!gw1) throw new Error('Could not find GW1');
  const start = new Date(gw1.deadline_time).getUTCFullYear();
  const end = (start + 1).toString().slice(-2);
  return `${start}-${end}`;
}

async function fetchGwLive(gw) {
  const res = await fetch(`${FPL_BASE}/event/${gw}/live/`, { headers: FETCH_HEADERS });
  if (!res.ok) throw new Error(`FPL live GW${gw} error: ${res.status}`);
  return res.json();
}

async function fetchFplIdToPosition() {
  const { data, error } = await supabase
    .from('players')
    .select('fpl_id, primary_position')
    .not('fpl_id', 'is', null);
  if (error) throw new Error(`Players lookup failed: ${error.message}`);
  const map = new Map();
  for (const row of data) map.set(row.fpl_id, row.primary_position);
  return map;
}

async function main() {
  const season = seasonArg ?? (await getCurrentFplSeason());
  console.log(`Season: ${season}`);

  const completed = await detectCompletedGameweeks();
  if (completed.length === 0) {
    console.warn('No completed gameweeks yet; aborting.');
    return;
  }
  console.log(`Completed gameweeks: ${completed.join(', ')}`);

  const fplToPos = await fetchFplIdToPosition();
  console.log(`Loaded ${fplToPos.size} players with primary_position`);

  const buckets = Object.fromEntries(
    POSITIONS.map((p) => [p, Object.fromEntries(COMPONENTS.map((c) => [c, []]))]),
  );

  for (const gw of completed) {
    process.stdout.write(`Fetching GW${gw}... `);
    const data = await fetchGwLive(gw);
    let kept = 0;
    for (const el of data.elements ?? []) {
      const s = el.stats ?? {};
      if ((s.minutes ?? 0) < 45) continue;
      const pos = fplToPos.get(el.id);
      if (!pos || !POSITIONS.includes(pos)) continue;

      const goals = s.goals_scored ?? 0;
      const assists = s.assists ?? 0;
      const bps = s.bps ?? 0;
      const adjBps = Math.max(0, bps - goals * 12 - assists * 9);
      const xg = parseFloat(s.expected_goals) || 0;
      const xa = parseFloat(s.expected_assists) || 0;

      buckets[pos].match_impact.push(adjBps);
      buckets[pos].influence.push(parseFloat(s.influence) || 0);
      buckets[pos].creativity.push(parseFloat(s.creativity) || 0);
      buckets[pos].threat.push(parseFloat(s.threat) || 0);
      buckets[pos].defensive.push(defensiveRawInput(s, pos));
      buckets[pos].goal_involvement.push(goals * 6 + assists * 4);
      buckets[pos].finishing.push((goals - xg) + (assists - xa) * 0.5);
      buckets[pos].save_score.push(pos === 'GK' ? saveScoreRaw(s) : 0);
      kept++;
    }
    console.log(`${kept} rows kept`);
  }

  console.log('\n--- Computed reference stats ---');
  console.log('Position  Component         Median    Stddev    N');
  console.log('-'.repeat(60));
  const rows = [];
  for (const pos of POSITIONS) {
    for (const comp of COMPONENTS) {
      const vals = buckets[pos][comp];
      const med = Number(median(vals).toFixed(4));
      const sd = Number(pstdev(vals).toFixed(4));
      const n = vals.length;
      console.log(`${pos.padEnd(8)}  ${comp.padEnd(16)}  ${med.toFixed(3).padStart(8)}  ${sd.toFixed(3).padStart(8)}  ${String(n).padStart(5)}`);
      rows.push({
        position_group: pos,
        component: comp,
        median: med,
        stddev: sd,
        sample_size: n,
        season,
      });
    }
  }

  if (dryRun) {
    console.log('\nDry run; not writing to DB.');
    return;
  }

  console.log(`\nDeleting existing rows for season ${season}...`);
  const { error: delErr } = await supabase
    .from('rating_reference_stats')
    .delete()
    .eq('season', season);
  if (delErr) throw new Error(`Delete failed: ${delErr.message}`);

  console.log(`Inserting ${rows.length} rows...`);
  const { error: insErr } = await supabase
    .from('rating_reference_stats')
    .insert(rows);
  if (insErr) throw new Error(`Insert failed: ${insErr.message}`);

  console.log('Done.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
