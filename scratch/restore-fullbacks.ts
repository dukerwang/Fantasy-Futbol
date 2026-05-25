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
  // Let's find all players whose primary position is currently 'RWB' or 'LWB'
  const { data: wingbacks } = await sb
    .from('players')
    .select('id, name, primary_position')
    .in('primary_position', ['RWB', 'LWB']);

  console.log('Current players in DB with RWB/LWB primary position:');
  console.log(wingbacks);

  // Revert Pedro Porro and any others to standard RB/LB
  // Since the user is highly sensitive to any non-standard primary positions,
  // we will restore any RWB/LWB back to RB/LB respectively.
  if (wingbacks && wingbacks.length > 0) {
    for (const p of wingbacks) {
      const newPos = p.primary_position === 'RWB' ? 'RB' : 'LB';
      console.log(`Reverting ${p.name} from ${p.primary_position} to ${newPos}...`);
      const { error } = await sb
        .from('players')
        .update({ primary_position: newPos })
        .eq('id', p.id);
      if (error) console.error(`Error updating ${p.name}:`, error);
    }
  }

  console.log('Restored all RWB/LWB players to standard RB/LB.');
})();
