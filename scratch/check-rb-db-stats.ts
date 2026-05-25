import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  // Check rating_reference_stats seasons
  const { data: seasons } = await sb.from('rating_reference_stats').select('season').limit(10);
  console.log('Seasons in rating_reference_stats:', [...new Set(seasons?.map(s => s.season))]);

  // Check unique position_group in rating_reference_stats
  const { data: posGroups } = await sb.from('rating_reference_stats').select('position_group').limit(200);
  console.log('Position groups in rating_reference_stats:', [...new Set(posGroups?.map(p => p.position_group))]);

  // Inspect player_stats keys
  const { data: sampleStats } = await sb.from('player_stats').select('*').limit(1);
  if (sampleStats && sampleStats.length > 0) {
    console.log('player_stats columns:', Object.keys(sampleStats[0]));
    console.log('player_stats sample:', sampleStats[0]);
  }

  // Check some actual reference stats for RB
  const { data: rbRef } = await sb.from('rating_reference_stats').select('*').eq('position_group', 'RB');
  console.log('RB Reference Stats count:', rbRef?.length);
  if (rbRef && rbRef.length > 0) {
    console.log('RB Ref Sample (first 3):', rbRef.slice(0, 3));
  }

  // Let's query Pedro Porro, Daniel Muñoz, Reece James, Jurriën Timber from the database players table
  const { data: players } = await sb.from('players').select('id, name, primary_position').in('name', ['Pedro Porro', 'Daniel Muñoz', 'Reece James', 'Jurriën Timber']);
  
  for (const p of players ?? []) {
    const { data: stats } = await sb.from('player_stats').select('gameweek, stats, fantasy_points, fantasy_points_v2').eq('player_id', p.id).order('gameweek', { ascending: true });
    
    const overallV1 = stats?.reduce((acc, s) => acc + Number(s.fantasy_points), 0) ?? 0;
    const overallV2 = stats?.reduce((acc, s) => acc + Number(s.fantasy_points_v2), 0) ?? 0;
    const overallGp = stats?.length ?? 0;

    const fullMatchStats = stats?.filter(s => (s.stats?.minutes_played ?? 0) >= 45) ?? [];
    const fullMatchV1 = fullMatchStats.reduce((acc, s) => acc + Number(s.fantasy_points), 0);
    const fullMatchV2 = fullMatchStats.reduce((acc, s) => acc + Number(s.fantasy_points_v2), 0);
    const fullMatchGp = fullMatchStats.length;

    console.log(`\n==================================================`);
    console.log(`${p.name} (${p.primary_position})`);
    console.log(`--------------------------------------------------`);
    console.log(`Overall Season (all ${overallGp} games):`);
    console.log(`  V1 PPG: ${(overallV1 / overallGp).toFixed(2)}`);
    console.log(`  V2 PPG: ${(overallV2 / overallGp).toFixed(2)}`);
    console.log(`  Delta:  ${((overallV2 - overallV1) / overallGp).toFixed(2)}`);
    console.log(`Matches Played 45+ Mins (${fullMatchGp} games):`);
    console.log(`  V1 PPG: ${(fullMatchV1 / fullMatchGp).toFixed(2)}`);
    console.log(`  V2 PPG: ${(fullMatchV2 / fullMatchGp).toFixed(2)}`);
    console.log(`  Delta:  ${((fullMatchV2 - fullMatchV1) / fullMatchGp).toFixed(2)}`);

    if (p.name === 'Reece James') {
      console.log(`\nGW-by-GW breakdown for Reece James directly from DB:`);
      console.log('GW   Mins  V1 Points  V2 Points  Delta   Key Stats');
      console.log('-'.repeat(55));
      for (const s of stats ?? []) {
        const mins = s.stats?.minutes_played ?? 0;
        const v1 = Number(s.fantasy_points);
        const v2 = Number(s.fantasy_points_v2);
        const d = v2 - v1;
        let statNote = '';
        if (s.stats?.goals > 0 || s.stats?.assists > 0) statNote += `${s.stats.goals}G/${s.stats.assists}A `;
        if (s.stats?.clean_sheet) statNote += 'CS ';
        if (s.stats?.creativity > 25) statNote += `Cr:${s.stats.creativity.toFixed(0)} `;
        if (s.stats?.bps > 25) statNote += `BPS:${s.stats.bps} `;

        console.log(
          `${String(s.gameweek).padStart(2)}   ` +
          `${String(mins).padStart(4)}   ` +
          `${v1.toFixed(1).padStart(8)}   ` +
          `${v2.toFixed(1).padStart(8)}   ` +
          `${(d >= 0 ? '+' : '')}${d.toFixed(1).padStart(5)}   ` +
          `${statNote}`
        );
      }
      console.log('-'.repeat(55));
    }
  }
})();
