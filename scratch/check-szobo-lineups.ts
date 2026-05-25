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
  const { data: players } = await sb.from('players')
    .select('id, name, primary_position')
    .ilike('name', '%Szoboszlai%');

  const p = players![0];

  // Fetch all matchups in the DB
  const { data: matchups } = await sb.from('matchups').select('*');

  console.log("Checking if Szoboszlai was slotted into defensive positions in any team lineup:");
  let found = 0;

  for (const m of matchups || []) {
    const checkLineup = (lineup: any, teamLabel: string) => {
      if (!lineup?.starters) return;
      for (const starter of lineup.starters) {
        if (starter.player_id === p.id) {
          found++;
          console.log(`GW ${m.gameweek} | Team ${teamLabel} | Slotted Position: ${starter.slot} | Matchup ID: ${m.id}`);
        }
      }
    };
    checkLineup(m.lineup_a, 'A');
    checkLineup(m.lineup_b, 'B');
  }

  console.log(`Total lineups found with Szoboszlai starting: ${found}`);
})();
