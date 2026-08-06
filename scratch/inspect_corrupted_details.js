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

async function inspectCorruptedDetails() {
  const ids = [
    '418a23ee-06ab-4067-9a11-efee1e2aa04e', // Alisson
    '0222027d-19f0-42b4-99da-d21c49e4d7cc', // Ederson
    '89b834d3-4564-40f3-aa5d-c68a51610f55', // Daniel Muñoz
    'dd9eefdd-65e7-417e-8dcb-f13316ba94f2', // Victor Munoz
    '55a21522-6e0a-4417-bb73-c969ed02aa98', // Harvey Cartwright
    'bdac6680-592e-4cfc-a862-270cf341d3b7', // Kjell Scherpen
    '74ee5733-c503-4cc9-bf0f-bc76c025a0a4', // Ewen Jaouen
  ];

  const { data: players } = await supabase.from('players').select('*').in('id', ids);
  console.log('--- Corrupted Player Details ---');
  players.forEach(p => {
    console.log({
      id: p.id,
      name: p.name,
      web_name: p.web_name,
      full_name: p.full_name,
      pl_team: p.pl_team,
      primary_position: p.primary_position,
      secondary_positions: p.secondary_positions,
      nationality: p.nationality,
      height_cm: p.height_cm,
      photo_url: p.photo_url,
      sofifa_common_name: p.sofifa_common_name,
      fpl_id: p.fpl_id
    });
  });
}

inspectCorruptedDetails();
