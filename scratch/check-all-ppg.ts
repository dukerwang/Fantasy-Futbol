import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envContent = fs.readFileSync(path.join(__dirname, '../.env.local'), 'utf8');
const env: Record<string, string> = {};
envContent.split('\n').forEach(line => {
  const match = line.match(/^\s*([\w\.\-]+)\s*=\s*(.*)?\s*$/);
  if (match) {
    let value = match[2] || '';
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (value.startsWith("'") && value.endsWith("'")) value = value.slice(1, -1);
    env[match[1]] = value;
  }
});

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

async function checkAllPpg() {
  const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

  const players = [
    "Pedro Porro",
    "Daniel Muñoz",
    "Reece James",
    "Kieran Trippier",
    "Diogo Dalot"
  ];

  console.log(`Current DB Played Games PPG for V2:`);
  console.log(`Player          | Primary Pos | Played | V2 Points PPG`);
  console.log(`----------------|-------------|--------|--------------`);

  for (const name of players) {
    const { data: p } = await supabase
      .from('players')
      .select('id, name, primary_position')
      .ilike('name', `%${name}%`)
      .maybeSingle();

    if (!p) {
      console.log(`${name.padEnd(15)} | Not found`);
      continue;
    }

    const { data: stats } = await supabase
      .from('player_stats')
      .select('fantasy_points_v2, stats')
      .eq('player_id', p.id);

    let sum = 0;
    let played = 0;

    for (const s of stats ?? []) {
      const mins = (s.stats as any)?.minutes_played ?? 0;
      if (mins > 0) {
        played++;
        sum += Number(s.fantasy_points_v2 ?? 0);
      }
    }

    const ppg = played > 0 ? (sum / played).toFixed(2) : '0.00';
    console.log(
      `${p.name.padEnd(15)} | ` +
      `${String(p.primary_position).padEnd(11)} | ` +
      `${String(played).padStart(6)} | ` +
      `${ppg.padStart(13)}`
    );
  }
}

checkAllPpg().catch(console.error);
