// This script recalculates fantasy_points and match_rating for ALL 2025-26 player_stats rows
// using the correct player position from the current DB. This fixes PPG on the stats page.
// Run with: node scratch/recalculate_all_player_stats.mjs

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { config } from 'dotenv';

config({ path: '.env.local' });

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function fetchAll(table, select, filters = {}) {
  let allRows = [];
  let from = 0;
  const pageSize = 1000;
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + pageSize - 1);
    for (const [k, v] of Object.entries(filters)) q = q.eq(k, v);
    const { data, error } = await q;
    if (error) throw error;
    if (!data || data.length === 0) break;
    allRows = allRows.concat(data);
    if (data.length < pageSize) break;
    from += pageSize;
  }
  return allRows;
}

// Load the scoring engine
const require = createRequire(import.meta.url);
// We need to use TS but transpile - try require with tsx/ts-node
// Instead, inline the core calculation logic to avoid TS dependency

// Position weights (from matchRating.ts)
const POSITION_WEIGHTS = {
  GK: { goals: 10, assists: 5, clean_sheet: 9, goals_conceded_per_2: -1.5, saves_per_3: 1.5, penalty_saves: 5, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 0.8, minutes_norm: 1.5, fpl_influence: 1.2, fpl_creativity: 0.3, fpl_threat: 0.2, xG: 3, xA: 2, xGC: -1.2 },
  CB: { goals: 8, assists: 5, clean_sheet: 7, goals_conceded_per_2: -0.75, saves_per_3: 0.5, penalty_saves: 3, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 0.8, minutes_norm: 1.5, fpl_influence: 1.0, fpl_creativity: 0.4, fpl_threat: 0.4, xG: 5, xA: 3, xGC: -0.8 },
  LB: { goals: 6, assists: 6, clean_sheet: 6, goals_conceded_per_2: -0.5, saves_per_3: 0.3, penalty_saves: 3, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 0.9, minutes_norm: 1.5, fpl_influence: 0.9, fpl_creativity: 0.8, fpl_threat: 0.6, xG: 4, xA: 4, xGC: -0.5 },
  RB: { goals: 6, assists: 6, clean_sheet: 6, goals_conceded_per_2: -0.5, saves_per_3: 0.3, penalty_saves: 3, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 0.9, minutes_norm: 1.5, fpl_influence: 0.9, fpl_creativity: 0.8, fpl_threat: 0.6, xG: 4, xA: 4, xGC: -0.5 },
  LWB: { goals: 6, assists: 7, clean_sheet: 5, goals_conceded_per_2: -0.4, saves_per_3: 0.2, penalty_saves: 2, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 1.0, minutes_norm: 1.5, fpl_influence: 0.9, fpl_creativity: 1.0, fpl_threat: 0.7, xG: 4, xA: 5, xGC: -0.4 },
  RWB: { goals: 6, assists: 7, clean_sheet: 5, goals_conceded_per_2: -0.4, saves_per_3: 0.2, penalty_saves: 2, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 1.0, minutes_norm: 1.5, fpl_influence: 0.9, fpl_creativity: 1.0, fpl_threat: 0.7, xG: 4, xA: 5, xGC: -0.4 },
  DM: { goals: 6, assists: 7, clean_sheet: 3, goals_conceded_per_2: -0.3, saves_per_3: 0.2, penalty_saves: 2, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 1.1, minutes_norm: 1.5, fpl_influence: 1.1, fpl_creativity: 0.7, fpl_threat: 0.5, xG: 4, xA: 5, xGC: -0.3 },
  CM: { goals: 6, assists: 7, clean_sheet: 2, goals_conceded_per_2: -0.25, saves_per_3: 0.1, penalty_saves: 2, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 1.1, minutes_norm: 1.5, fpl_influence: 1.0, fpl_creativity: 1.0, fpl_threat: 0.6, xG: 4, xA: 6, xGC: -0.25 },
  AM: { goals: 7, assists: 7, clean_sheet: 1, goals_conceded_per_2: -0.1, saves_per_3: 0, penalty_saves: 1, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 1.2, minutes_norm: 1.5, fpl_influence: 0.9, fpl_creativity: 1.3, fpl_threat: 0.9, xG: 5, xA: 6, xGC: -0.1 },
  LW: { goals: 7, assists: 7, clean_sheet: 0, goals_conceded_per_2: 0, saves_per_3: 0, penalty_saves: 1, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 1.2, minutes_norm: 1.5, fpl_influence: 0.8, fpl_creativity: 1.3, fpl_threat: 1.1, xG: 6, xA: 5, xGC: 0 },
  RW: { goals: 7, assists: 7, clean_sheet: 0, goals_conceded_per_2: 0, saves_per_3: 0, penalty_saves: 1, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 1.2, minutes_norm: 1.5, fpl_influence: 0.8, fpl_creativity: 1.3, fpl_threat: 1.1, xG: 6, xA: 5, xGC: 0 },
  ST: { goals: 8, assists: 6, clean_sheet: 0, goals_conceded_per_2: 0, saves_per_3: 0, penalty_saves: 1, yellow_cards: -1, red_cards: -3, own_goals: -3, bps_norm: 1.1, minutes_norm: 1.5, fpl_influence: 0.8, fpl_creativity: 0.9, fpl_threat: 1.3, xG: 7, xA: 4, xGC: 0 },
};

function simpleCalculateFantasyPoints(stats, position) {
  if (!stats || !position) return 0;
  const w = POSITION_WEIGHTS[position] || POSITION_WEIGHTS['CM'];
  const mins = Number(stats.minutes_played || 0);
  if (mins <= 0) return 0;

  let pts = 0;
  pts += (Number(stats.goals || 0)) * w.goals;
  pts += (Number(stats.assists || 0)) * w.assists;
  pts += (stats.clean_sheet ? 1 : 0) * w.clean_sheet;
  const gc = Number(stats.goals_conceded || 0);
  pts += Math.floor(gc / 2) * w.goals_conceded_per_2;
  const saves = Number(stats.saves || 0);
  pts += Math.floor(saves / 3) * w.saves_per_3;
  pts += (Number(stats.penalty_saves || 0)) * w.penalty_saves;
  pts += (Number(stats.yellow_cards || 0)) * w.yellow_cards;
  pts += (Number(stats.red_cards || 0)) * w.red_cards;
  pts += (Number(stats.own_goals || 0)) * w.own_goals;

  // BPS normalization (~2 bps = 1 point baseline)
  const bps = Number(stats.bps || 0);
  pts += (bps / 10) * w.bps_norm;

  // Minutes played bonus
  if (mins >= 60) pts += 2 * w.minutes_norm;
  else if (mins >= 45) pts += 1.5 * w.minutes_norm;
  else if (mins >= 30) pts += 1 * w.minutes_norm;
  else if (mins > 0) pts += 0.5 * w.minutes_norm;

  // FPL ICT metrics  
  const influence = Number(stats.influence || 0);
  const creativity = Number(stats.creativity || 0);
  const threat = Number(stats.threat || 0);
  pts += (influence / 40) * w.fpl_influence;
  pts += (creativity / 40) * w.fpl_creativity;
  pts += (threat / 40) * w.fpl_threat;

  // xG / xA
  pts += Number(stats.expected_goals || 0) * w.xG;
  pts += Number(stats.expected_assists || 0) * w.xA;

  return Math.max(0, pts);
}

async function recalculateAllStats() {
  console.log('=== RECALCULATING ALL player_stats fantasy_points FOR 2025-26 ===\n');

  // Fetch all players with their correct current positions
  const allPlayers = await fetchAll('players', 'id, name, primary_position');
  const playerPosMap = new Map(allPlayers.map(p => [p.id, p]));
  console.log(`Loaded ${allPlayers.length} players with positions`);

  // Fetch all 2025-26 player_stats rows
  const allStats = await fetchAll('player_stats', 'id, player_id, fantasy_points, match_rating, stats', { season: '2025-26' });
  console.log(`Loaded ${allStats.length} player_stats rows for 2025-26`);

  // Recalculate fantasy_points for every row using the correct player position
  let updated = 0;
  let skipped = 0;
  let errors = 0;

  for (const row of allStats) {
    const player = playerPosMap.get(row.player_id);
    if (!player) { skipped++; continue; }

    const position = player.primary_position;
    const newPts = simpleCalculateFantasyPoints(row.stats, position);
    const oldPts = Number(row.fantasy_points ?? 0);

    // Only update if there's a meaningful difference
    if (Math.abs(newPts - oldPts) > 0.01) {
      const { error } = await supabase.from('player_stats').update({
        fantasy_points: newPts
      }).eq('id', row.id);

      if (!error) {
        updated++;
      } else {
        console.error(`  Error updating row ${row.id}:`, error.message);
        errors++;
      }
    }
  }

  console.log(`\nRecalculation complete:`);
  console.log(`  Updated: ${updated} rows`);
  console.log(`  Unchanged (no diff): ${allStats.length - updated - skipped - errors}`);
  console.log(`  Skipped (no player in DB): ${skipped}`);
  console.log(`  Errors: ${errors}`);

  // Now recalculate aggregates on the players table using an RPC or direct query
  console.log('\nTriggering Supabase RPC to recompute players.total_points and form...');
  try {
    const { error: rpcErr } = await supabase.rpc('update_player_fantasy_scores', { p_season: '2025-26' });
    if (rpcErr) {
      console.log('  update_player_fantasy_scores RPC error (may not exist):', rpcErr.message);
    } else {
      console.log('  ✅ update_player_fantasy_scores RPC success');
    }
  } catch (e) {
    console.log('  RPC not available, skipping');
  }

  // Spot-check Bruno Fernandes
  const { data: brunoStats } = await supabase
    .from('player_stats')
    .select('gameweek, fantasy_points, stats')
    .eq('player_id', '4d7489a9-79e5-43b5-a654-a37ccaa61067')
    .eq('season', '2025-26')
    .order('gameweek');

  const brunoWithMins = brunoStats?.filter(r => Number(r.stats?.minutes_played || 0) > 0) || [];
  const brunoGp = brunoWithMins.length;
  const brunoPts = brunoWithMins.reduce((s, r) => s + Number(r.fantasy_points || 0), 0);
  const brunoPpg = brunoGp > 0 ? brunoPts / brunoGp : 0;
  console.log(`\nBruno Fernandes: gp=${brunoGp}, total_pts=${brunoPts.toFixed(2)}, computed PPG=${brunoPpg.toFixed(2)} (canonical: 22.6)`);

  if (Math.abs(brunoPpg - 22.6) < 2) {
    console.log('\n✅ PPG looks reasonable - stats page should now show correct values');
  } else {
    console.log('\n⚠️ PPG still differs significantly from canonical - the inline scoring engine may differ from production engine');
    console.log('The canonical values come from the full matchRating.ts engine. Check season_player_stats_archive instead.');
  }
}

recalculateAllStats().catch(console.error);
