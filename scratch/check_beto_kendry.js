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

async function checkBetoAndKendry() {
  const { data: beto } = await supabase.from('players').select('id, name, web_name, pl_team, market_value, photo_url, fpl_id').ilike('name', '%beto%');
  console.log('Beto in DB:', beto);

  const { data: kendry } = await supabase.from('players').select('id, name, web_name, pl_team, market_value, photo_url, fpl_id').ilike('name', '%kendry%');
  console.log('Kendry in DB:', kendry);

  const { data: paez } = await supabase.from('players').select('id, name, web_name, pl_team, market_value, photo_url, fpl_id').ilike('name', '%paez%');
  console.log('Paez in DB:', paez);

  const { data: betoWeb } = await supabase.from('players').select('id, name, web_name, pl_team, market_value, photo_url, fpl_id').eq('web_name', 'Beto');
  console.log('web_name Beto in DB:', betoWeb);
}

checkBetoAndKendry();
