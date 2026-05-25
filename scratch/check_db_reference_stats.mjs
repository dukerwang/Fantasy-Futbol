import { createClient } from '@supabase/supabase-js';
import { readFileSync, existsSync } from 'node:fs';

if (existsSync('.env.local')) {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) process.env[m[1]] = m[2].trim();
  }
}

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing env vars');
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY);

async function main() {
  const { data, error } = await supabase
    .from('rating_reference_stats')
    .select('season, position_group, component, median, stddev')
    .limit(10);

  if (error) {
    console.error('Error fetching reference stats:', error.message);
    return;
  }

  console.log(`Fetched ${data?.length || 0} rows from rating_reference_stats.`);
  if (data && data.length > 0) {
    console.log('Sample rows:');
    console.log(data);
    
    // Get total count
    const { count, error: countError } = await supabase
      .from('rating_reference_stats')
      .select('*', { count: 'exact', head: true });
    
    if (countError) {
      console.error('Error counting rows:', countError.message);
    } else {
      console.log(`Total rows in database: ${count}`);
    }
  } else {
    console.log('The rating_reference_stats table is EMPTY!');
  }
}

main().catch(console.error);
