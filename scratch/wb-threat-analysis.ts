import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  // Load reference stats so we can see where WBs sit relative to median
  const { data: refData } = await sb.from('rating_reference_stats').select('*').eq('season', '2025/26');
  const refStats: any = {};
  if (refData?.length) {
    for (const r of refData) refStats[r.position] = r;
  }

  console.log('\n=== REFERENCE STATS: Threat median/stddev by position ===');
  for (const pos of ['RB','LB','RWB','LWB','CM','AM','LW','RW','ST']) {
    const r = refStats[pos];
    if (!r) { console.log(`${pos}: no data`); continue; }
    console.log(`${pos.padEnd(4)} threat median: ${String(r.threat_median?.toFixed(2) ?? 'n/a').padStart(6)}  stddev: ${String(r.threat_stddev?.toFixed(2) ?? 'n/a').padStart(6)}`);
  }

  // Now look at raw threat values for known wingbacks
  const wbTargets = ['Jurriën Timber', 'Pedro Porro', 'Wan-Bissaka', 'Destiny Udogie', 'Trent Alexander', 'Reece James'];

  console.log('\n=== RAW THREAT STATS per game (45+ mins) ===');
  console.log(`${'Player'.padEnd(22)} ${'Pos'.padEnd(5)} ${'Games'.padEnd(6)} ${'Avg Threat'.padEnd(12)} ${'Max Threat'.padEnd(12)} ${'% games >0'.padEnd(12)} ${'% games >10'}`);
  console.log('─'.repeat(90));

  for (const name of wbTargets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position').ilike('name', `%${name}%`);
    if (!found?.length) continue;
    const p = found[0];

    const { data: statsRows } = await sb.from('player_stats').select('stats').eq('player_id', p.id).not('stats','is',null);
    if (!statsRows?.length) continue;

    const games = statsRows.filter((r: any) => (r.stats as any)?.minutes_played >= 45);
    const threats = games.map((r: any) => Number((r.stats as any)?.threat ?? 0));

    const avg = threats.reduce((a, b) => a + b, 0) / threats.length;
    const max = Math.max(...threats);
    const pctAbove0  = (threats.filter(t => t > 0).length  / threats.length * 100);
    const pctAbove10 = (threats.filter(t => t > 10).length / threats.length * 100);

    console.log(`${p.name.padEnd(22)} ${p.primary_position.padEnd(5)} ${String(games.length).padEnd(6)} ${avg.toFixed(2).padEnd(12)} ${String(max).padEnd(12)} ${pctAbove0.toFixed(0).padEnd(10)}%  ${pctAbove10.toFixed(0)}%`);
  }

  // Also show breakdown of a full RWB/LWB population
  console.log('\n=== POPULATION: All RWB/LWB primary position players (45+ min games) ===');
  const { data: wbPlayers } = await sb.from('players')
    .select('id,name,primary_position')
    .in('primary_position', ['RWB','LWB'])
    .eq('is_active', true);

  if (wbPlayers?.length) {
    const allThreats: number[] = [];
    for (const p of wbPlayers) {
      const { data: rows } = await sb.from('player_stats').select('stats').eq('player_id', p.id).not('stats','is',null);
      if (!rows?.length) continue;
      const games = rows.filter((r: any) => (r.stats as any)?.minutes_played >= 45);
      for (const r of games) allThreats.push(Number((r.stats as any)?.threat ?? 0));
    }
    allThreats.sort((a,b) => a-b);
    const avg = allThreats.reduce((a,b) => a+b, 0) / allThreats.length;
    const pctZero   = allThreats.filter(t => t === 0).length / allThreats.length * 100;
    const pctAbove0 = allThreats.filter(t => t > 0).length  / allThreats.length * 100;
    const pctAbove10= allThreats.filter(t => t > 10).length / allThreats.length * 100;
    const p50 = allThreats[Math.floor(allThreats.length * 0.50)];
    const p75 = allThreats[Math.floor(allThreats.length * 0.75)];
    const p90 = allThreats[Math.floor(allThreats.length * 0.90)];
    console.log(`  Total game-samples: ${allThreats.length}`);
    console.log(`  Avg threat:         ${avg.toFixed(2)}`);
    console.log(`  % games threat = 0: ${pctZero.toFixed(1)}%`);
    console.log(`  % games threat > 0: ${pctAbove0.toFixed(1)}%`);
    console.log(`  % games threat > 10:${pctAbove10.toFixed(1)}%`);
    console.log(`  p50 / p75 / p90:    ${p50} / ${p75} / ${p90}`);
  }
})();
