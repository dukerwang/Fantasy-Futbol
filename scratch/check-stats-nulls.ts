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
  const targets = ['Reece James', 'Pedro Porro', 'Daniel Muñoz'];

  for (const name of targets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position').ilike('name', '%' + name.replace('Muñoz', 'Mun') + '%');
    if (!found || found.length === 0) continue;
    const p = found[0];

    const { data: statsRows } = await sb
      .from('player_stats')
      .select('gameweek, stats')
      .eq('player_id', p.id)
      .not('stats','is',null)
      .order('gameweek');

    console.log(`\n========================================`);
    console.log(`${p.name} (${p.primary_position})`);
    let nullGC = 0;
    let zeroGC = 0;
    let positiveGC = 0;
    let total = 0;

    for (const r of statsRows ?? []) {
      const s = r.stats as any;
      if (!s || s.minutes_played === 0) continue;
      total++;
      if (s.goals_conceded === null || s.goals_conceded === undefined) {
        nullGC++;
      } else if (s.goals_conceded === 0) {
        zeroGC++;
      } else {
        positiveGC++;
      }
    }
    console.log(`  Total games played: ${total}`);
    console.log(`  Null/missing goals_conceded: ${nullGC}`);
    console.log(`  Zero goals_conceded: ${zeroGC}`);
    console.log(`  Positive goals_conceded: ${positiveGC}`);
    if (statsRows && statsRows.length > 0) {
      console.log(`  Sample stats keys:`, Object.keys(statsRows[0].stats as any));
    }
  }
})();
