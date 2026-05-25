import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([\w]+)=(.*)/);
    if (m) process.env[m[1]] = m[2].trim();
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  const { data: players } = await sb.from('players').select('id,name,primary_position').in('primary_position', ['DM','CM']);
  const ids = (players ?? []).map((p: any) => p.id);

  const { data: rows } = await sb.from('player_stats').select('player_id,gameweek,stats').in('player_id', ids).not('stats','is',null);

  let nullGc = 0, nullXgc = 0;
  let gcVals: number[] = [], xgcVals: number[] = [], diffVals: number[] = [];

  for (const r of (rows ?? [])) {
    const s = r.stats as any;
    if (!s || s.minutes_played < 60) continue;
    const gc = s.goals_conceded;
    const xgc = s.expected_goals_conceded ?? null;
    if (gc === null || gc === undefined) { nullGc++; continue; }
    if (xgc === null) { nullXgc++; continue; }
    gcVals.push(gc);
    xgcVals.push(parseFloat(xgc));
    diffVals.push(parseFloat(xgc) - gc); // positive = outperformed (kept below xGC)
  }

  const avg = (arr: number[]) => arr.reduce((a,b)=>a+b,0)/arr.length;
  const posOutperf = diffVals.filter(d => d > 0);
  const negOutperf = diffVals.filter(d => d < 0);

  console.log(`Total qualifying games: ${gcVals.length}`);
  console.log(`Games with null GC: ${nullGc} | null xGC: ${nullXgc}`);
  console.log(`\nGC distribution:`);
  console.log(`  CS (gc=0): ${gcVals.filter(g=>g===0).length}`);
  console.log(`  1 goal:    ${gcVals.filter(g=>g===1).length}`);
  console.log(`  2 goals:   ${gcVals.filter(g=>g===2).length}`);
  console.log(`  3+ goals:  ${gcVals.filter(g=>g>=3).length}`);
  console.log(`  Avg GC:    ${avg(gcVals).toFixed(3)}`);
  console.log(`  Avg xGC:   ${avg(xgcVals).toFixed(3)}`);
  console.log(`\nxGC vs GC delta (positive = team outperformed / kept below xGC):`);
  console.log(`  Outperformed (xgc > gc): ${posOutperf.length} games, avg delta = +${avg(posOutperf).toFixed(2)}`);
  console.log(`  Underperformed (gc > xgc): ${negOutperf.length} games, avg delta = -${Math.abs(avg(negOutperf)).toFixed(2)}`);
  console.log(`\nWith multiplier = 5 (current "fix"):`);
  console.log(`  Avg outperf bonus:  +${(avg(posOutperf) * 5).toFixed(2)} raw`);
  console.log(`  Avg penalty:        -${(Math.abs(avg(negOutperf)) * 5).toFixed(2)} raw`);
  console.log(`  Max bonus (95th pct): +${(posOutperf.sort((a,b)=>b-a)[Math.floor(posOutperf.length*0.05)] * 5).toFixed(2)} raw`);
  console.log(`  Max penalty (95th pct): -${(Math.abs(negOutperf.sort((a,b)=>a-b)[Math.floor(negOutperf.length*0.05)]) * 5).toFixed(2)} raw`);
  
  // Now show what the DM defensive reference median/stddev is, so we can understand the impact
  const { data: refData } = await sb.from('rating_reference_stats').select('*').eq('season', '2025/26').in('position', ['DM','CM']);
  if (refData) {
    console.log(`\nReference stats (for context on scale):`);
    for (const r of refData) {
      console.log(`  ${r.position} defensive median=${r.defensive_median?.toFixed(2)}, stddev=${r.defensive_stddev?.toFixed(2)}`);
    }
  }
})();
