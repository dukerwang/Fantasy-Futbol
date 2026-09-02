import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function run() {
  console.log('Fetching 2026-27 GW1 & GW2 stats...');
  
  // 1. Fetch 2026-27 player stats for GW 1 and 2
  const { data: stats27 } = await admin
    .from('player_stats')
    .select('player_id, gameweek, fantasy_points, match_rating, stats')
    .eq('season', '2026-27')
    .in('gameweek', [1, 2]);

  // Fetch player metadata for positions
  let allPlayers = [];
  for (let from = 0; ; from += 1000) {
    const { data: pChunk } = await admin
      .from('players')
      .select('id, name, web_name, primary_position, secondary_positions, pl_team')
      .range(from, from + 999);
    allPlayers = allPlayers.concat(pChunk);
    if (pChunk.length < 1000) break;
  }
  const playerMap = new Map(allPlayers.map((p) => [p.id, p]));

  // 2. Fetch 2025-26 player stats archive / backfill
  console.log('Fetching 2025-26 stats...');
  let stats26 = [];
  for (let from = 0; ; from += 1000) {
    const { data: sChunk } = await admin
      .from('player_stats')
      .select('player_id, gameweek, fantasy_points, match_rating, stats')
      .eq('season', '2025-26')
      .range(from, from + 999);
    stats26 = stats26.concat(sChunk);
    if (sChunk.length < 1000) break;
  }

  function analyzeDataset(name, statRows) {
    console.log(`\n========================================================================`);
    console.log(`STATISTICAL ANALYSIS: ${name}`);
    console.log(`========================================================================`);

    const validRows = statRows.filter((r) => {
      const mins = r.stats?.minutes_played ?? 0;
      return mins >= 45; // starters / significant minutes
    });

    const allPlayed = statRows.filter((r) => (r.stats?.minutes_played ?? 0) > 0);

    console.log(`Total appearances (minutes > 0): ${allPlayed.length}`);
    console.log(`Starters/Regulars (minutes >= 45): ${validRows.length}`);

    // Group by granular position and by group (GK, DEF, MID, ATT)
    const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
    const GROUPS = {
      GK: ['GK'],
      DEF: ['CB', 'LB', 'RB', 'LWB', 'RWB'],
      FULLBACK: ['LB', 'RB', 'LWB', 'RWB'],
      CB: ['CB'],
      MID: ['DM', 'CM', 'AM'],
      ATT: ['LW', 'RW', 'ST'],
    };

    function computeStatsForFilter(label, rows) {
      if (rows.length === 0) {
        console.log(`${label.padEnd(12)}: No data`);
        return;
      }
      const pts = rows.map((r) => Number(r.fantasy_points) || 0);
      const ratings = rows.map((r) => Number(r.match_rating) || 0);
      
      const n = pts.length;
      const meanPts = pts.reduce((a, b) => a + b, 0) / n;
      const meanRating = ratings.reduce((a, b) => a + b, 0) / n;
      
      pts.sort((a, b) => a - b);
      const medianPts = pts[Math.floor(n / 2)];
      
      const variance = pts.reduce((sum, p) => sum + Math.pow(p - meanPts, 2), 0) / n;
      const stddev = Math.sqrt(variance);

      const zeroCount = pts.filter((p) => p === 0).length;
      const under5Count = pts.filter((p) => p < 5).length;
      const under10Count = pts.filter((p) => p < 10).length;
      const gte15Count = pts.filter((p) => p >= 15).length;
      const gte20Count = pts.filter((p) => p >= 20).length;
      const gte30Count = pts.filter((p) => p >= 30).length;
      const maxPts = pts[pts.length - 1];

      const pct = (c) => ((c / n) * 100).toFixed(1) + '%';

      console.log(
        `${label.padEnd(10)} | N=${String(n).padStart(4)} | Mean: ${meanPts.toFixed(2).padStart(5)} | Med: ${medianPts.toFixed(2).padStart(5)} | Std: ${stddev.toFixed(2).padStart(5)} | 0 pts: ${pct(zeroCount).padStart(6)} | <10: ${pct(under10Count).padStart(6)} | 15+: ${pct(gte15Count).padStart(5)} | 20+: ${pct(gte20Count).padStart(5)} | 30+: ${pct(gte30Count).padStart(5)} | Max: ${maxPts.toFixed(1).padStart(5)} | Rating: ${meanRating.toFixed(2)}`
      );
    }

    console.log('\n--- BY POSITION GROUP (Minutes >= 45) ---');
    console.log('Group      | Count  | Mean  | Med   | Std   | 0 pts  | <10 pts| 15+   | 20+   | 30+   | Max   | Mean Rating');
    console.log('-----------|--------|-------|-------|-------|--------|--------|-------|-------|-------|-------|------------');
    for (const [grp, posList] of Object.entries(GROUPS)) {
      const grpRows = validRows.filter((r) => {
        const p = playerMap.get(r.player_id);
        return p && posList.includes(p.primary_position);
      });
      computeStatsForFilter(grp, grpRows);
    }

    console.log('\n--- BY GRANULAR POSITION (Minutes >= 45) ---');
    console.log('Pos        | Count  | Mean  | Med   | Std   | 0 pts  | <10 pts| 15+   | 20+   | 30+   | Max   | Mean Rating');
    console.log('-----------|--------|-------|-------|-------|--------|--------|-------|-------|-------|-------|------------');
    for (const pos of POSITIONS) {
      const posRows = validRows.filter((r) => {
        const p = playerMap.get(r.player_id);
        return p && p.primary_position === pos;
      });
      computeStatsForFilter(pos, posRows);
    }

    // Clean sheet rates and match environment
    const csCount = validRows.filter((r) => r.stats?.clean_sheet).length;
    const goalsCount = validRows.reduce((sum, r) => sum + (r.stats?.goals || 0), 0);
    const avgGoalsConceded = validRows.filter(r => {
      const p = playerMap.get(r.player_id);
      return p && GROUPS.DEF.includes(p.primary_position);
    }).reduce((sum, r) => sum + (r.stats?.goals_conceded || 0), 0) / validRows.filter(r => {
      const p = playerMap.get(r.player_id);
      return p && GROUPS.DEF.includes(p.primary_position);
    }).length;

    console.log(`\nMatch Environment:`);
    console.log(`  Defender Clean Sheet Rate: ${((csCount / validRows.length) * 100).toFixed(1)}%`);
    console.log(`  Avg Goals Conceded per Defender Appearance: ${avgGoalsConceded.toFixed(2)}`);
  }

  analyzeDataset('2026-27 (GW1 & GW2 Only)', stats27);
  if (stats26.length > 0) {
    analyzeDataset('2025-26 (Full Season Archive)', stats26);
  }
}

run().catch(console.error);
