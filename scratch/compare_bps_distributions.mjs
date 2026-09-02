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
  // Fetch players
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

  // Fetch 2026-27 GW1 & GW2
  const { data: stats27 } = await admin
    .from('player_stats')
    .select('player_id, gameweek, fantasy_points, match_rating, stats')
    .eq('season', '2026-27')
    .in('gameweek', [1, 2]);

  // Fetch 2025-26 GW1 & GW2 (and all 2025-26)
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

  function analyzeBps(datasetName, rows) {
    console.log(`\n======================================================`);
    console.log(`BPS & MATCH IMPACT ANALYSIS: ${datasetName}`);
    console.log(`======================================================`);

    const starters = rows.filter(r => (r.stats?.minutes_played ?? 0) >= 45);
    console.log(`Total starter appearances (min >= 45): ${starters.length}`);

    const POSITIONS = ['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'];
    const GROUPS = {
      GK: ['GK'],
      DEF: ['CB', 'LB', 'RB', 'LWB', 'RWB'],
      MID: ['DM', 'CM', 'AM'],
      ATT: ['LW', 'RW', 'ST'],
    };

    console.log('\nGroup/Pos   | N    | Mean Raw BPS | Med Raw BPS | Mean Adj BPS | Med Adj BPS | Std Adj BPS');
    console.log('------------|------|--------------|-------------|--------------|-------------|------------');

    for (const [grp, posList] of Object.entries(GROUPS)) {
      const gRows = starters.filter(r => {
        const p = playerMap.get(r.player_id);
        return p && posList.includes(p.primary_position);
      });
      if (gRows.length === 0) continue;

      const rawBps = gRows.map(r => Number(r.stats?.bps ?? 0));
      const adjBps = gRows.map(r => {
        const st = r.stats ?? {};
        const g = st.goals ?? 0;
        const a = st.assists ?? 0;
        return Math.max(0, (st.bps ?? 0) - (g * 12 + a * 9));
      });

      const meanRaw = rawBps.reduce((a, b) => a + b, 0) / gRows.length;
      rawBps.sort((a, b) => a - b);
      const medRaw = rawBps[Math.floor(gRows.length / 2)];

      const meanAdj = adjBps.reduce((a, b) => a + b, 0) / gRows.length;
      adjBps.sort((a, b) => a - b);
      const medAdj = adjBps[Math.floor(gRows.length / 2)];

      const variance = adjBps.reduce((sum, v) => sum + Math.pow(v - meanAdj, 2), 0) / gRows.length;
      const stdAdj = Math.sqrt(variance);

      console.log(
        `${grp.padEnd(11)} | ${String(gRows.length).padStart(4)} | ${meanRaw.toFixed(2).padStart(12)} | ${medRaw.toFixed(1).padStart(11)} | ${meanAdj.toFixed(2).padStart(12)} | ${medAdj.toFixed(1).padStart(11)} | ${stdAdj.toFixed(2).padStart(11)}`
      );
    }

    console.log('\n--- BY GRANULAR POSITION ---');
    for (const pos of POSITIONS) {
      const pRows = starters.filter(r => {
        const p = playerMap.get(r.player_id);
        return p && p.primary_position === pos;
      });
      if (pRows.length === 0) continue;

      const rawBps = pRows.map(r => Number(r.stats?.bps ?? 0));
      const adjBps = pRows.map(r => {
        const st = r.stats ?? {};
        const g = st.goals ?? 0;
        const a = st.assists ?? 0;
        return Math.max(0, (st.bps ?? 0) - (g * 12 + a * 9));
      });

      const meanRaw = rawBps.reduce((a, b) => a + b, 0) / pRows.length;
      rawBps.sort((a, b) => a - b);
      const medRaw = rawBps[Math.floor(pRows.length / 2)];

      const meanAdj = adjBps.reduce((a, b) => a + b, 0) / pRows.length;
      adjBps.sort((a, b) => a - b);
      const medAdj = adjBps[Math.floor(pRows.length / 2)];

      const variance = adjBps.reduce((sum, v) => sum + Math.pow(v - meanAdj, 2), 0) / pRows.length;
      const stdAdj = Math.sqrt(variance);

      console.log(
        `${pos.padEnd(11)} | ${String(pRows.length).padStart(4)} | ${meanRaw.toFixed(2).padStart(12)} | ${medRaw.toFixed(1).padStart(11)} | ${meanAdj.toFixed(2).padStart(12)} | ${medAdj.toFixed(1).padStart(11)} | ${stdAdj.toFixed(2).padStart(11)}`
      );
    }
  }

  analyzeBps('2026-27 (GW1 & GW2)', stats27);
  const stats26_gw12 = stats26.filter(r => [1, 2].includes(r.gameweek));
  analyzeBps('2025-26 (GW1 & GW2 Only)', stats26_gw12);
  analyzeBps('2025-26 (Full Season 38 GWs)', stats26);
}

run().catch(console.error);
