import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('player_stats')
    .select('stats')
    .limit(5);

  if (error) {
    console.error(error);
    return;
  }
  
  console.log('Sample player stats keys:');
  console.log(Object.keys(data[0].stats));
  console.log('Sample player stats values:', data[0].stats);
}

main().catch(console.error);
