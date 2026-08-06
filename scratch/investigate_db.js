const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

if (fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsIdx = trimmed.indexOf('=');
    if (equalsIdx > 0) {
      const key = trimmed.substring(0, equalsIdx).trim();
      const val = trimmed.substring(equalsIdx + 1).trim();
      process.env[key] = val;
    }
  });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function run() {
  console.log('--- Searching for Alisson ---');
  const { data: alissons, error: aErr } = await supabase
    .from('players')
    .select('*')
    .ilike('name', '%alisson%');
  console.log('Alissons in DB:', alissons, aErr);

  console.log('\n--- Searching for Munoz / Muñoz ---');
  const { data: munozes, error: mErr } = await supabase
    .from('players')
    .select('*')
    .or('name.ilike.%munoz%,web_name.ilike.%munoz%,full_name.ilike.%munoz%');
  console.log('Munozes in DB:', munozes, mErr);

  console.log('\n--- Checking for Goalkeepers with weird positions or LW ---');
  const { data: lwGks, error: lwErr } = await supabase
    .from('players')
    .select('id, name, web_name, primary_position, secondary_positions, pl_team, fpl_id, photo_url')
    .or('name.ilike.%alisson%,name.ilike.%ederson%,name.ilike.%raya%,name.ilike.%pickford%,name.ilike.%vicario%');
  console.log('Sample GKs in DB:', lwGks, lwErr);

  console.log('\n--- Checking total players count ---');
  const { count, error: cErr } = await supabase
    .from('players')
    .select('*', { count: 'exact', head: true });
  console.log('Total players count:', count, cErr);

  console.log('\n--- Checking position distribution ---');
  const { data: allPlayers, error: allErr } = await supabase
    .from('players')
    .select('id, name, web_name, primary_position, pl_team, fpl_id, photo_url, is_active');
  
  if (allPlayers) {
    const posCounts = {};
    allPlayers.forEach(p => {
      posCounts[p.primary_position] = (posCounts[p.primary_position] || 0) + 1;
    });
    console.log('Position counts:', posCounts);
  }
}

run();
