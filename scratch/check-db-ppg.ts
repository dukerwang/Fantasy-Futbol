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
  // Check Porro's stored fantasy_points_v2 from DB
  const { data: porro } = await sb.from('players').select('id,name,primary_position').ilike('name', '%Porro%');
  if (!porro?.length) { console.log('Porro not found'); return; }
  const p = porro[0];
  console.log(`\n${p.name} (${p.primary_position})`);

  const { data: stats } = await sb.from('player_stats')
    .select('gameweek, fantasy_points_v2, stats')
    .eq('player_id', p.id)
    .not('stats', 'is', null)
    .order('gameweek');

  if (!stats?.length) { console.log('No stats'); return; }

  const played = stats.filter(r => (r.stats as any)?.minutes_played > 0);
  const gt45   = stats.filter(r => (r.stats as any)?.minutes_played >= 45);

  const totalAll  = played.reduce((s, r) => s + (Number(r.fantasy_points_v2) || 0), 0);
  const totalGt45 = gt45.reduce((s, r) => s + (Number(r.fantasy_points_v2) || 0), 0);

  console.log(`  Played games (>0 min): ${played.length}  | Total pts: ${totalAll.toFixed(1)} | PPG: ${(totalAll/played.length).toFixed(2)}`);
  console.log(`  Starter games (45+):   ${gt45.length}   | Total pts: ${totalGt45.toFixed(1)} | PPG: ${(totalGt45/gt45.length).toFixed(2)}`);

  // Also check Timber
  const { data: timber } = await sb.from('players').select('id,name,primary_position').ilike('name', '%Timber%');
  if (timber?.length) {
    const t = timber[0];
    console.log(`\n${t.name} (${t.primary_position})`);
    const { data: tstats } = await sb.from('player_stats')
      .select('gameweek, fantasy_points_v2, stats')
      .eq('player_id', t.id)
      .not('stats', 'is', null)
      .order('gameweek');
    if (tstats?.length) {
      const tp  = tstats.filter(r => (r.stats as any)?.minutes_played > 0);
      const tg  = tstats.filter(r => (r.stats as any)?.minutes_played >= 45);
      const tt  = tp.reduce((s, r) => s + (Number(r.fantasy_points_v2) || 0), 0);
      const ttg = tg.reduce((s, r) => s + (Number(r.fantasy_points_v2) || 0), 0);
      console.log(`  Played games (>0 min): ${tp.length}  | Total pts: ${tt.toFixed(1)} | PPG: ${(tt/tp.length).toFixed(2)}`);
      console.log(`  Starter games (45+):   ${tg.length}   | Total pts: ${ttg.toFixed(1)} | PPG: ${(ttg/tg.length).toFixed(2)}`);
    }
  }
})();
