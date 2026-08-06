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

async function inspectFplAndDb() {
  const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' }
  });
  const fplData = await fplRes.json();
  
  console.log('Total FPL elements:', fplData.elements.length);

  // Search FPL elements for Munoz / Alisson / Ederson
  const fplMunoz = fplData.elements.filter(e => 
    e.first_name.toLowerCase().includes('daniel') || 
    e.second_name.toLowerCase().includes('munoz') || 
    e.second_name.toLowerCase().includes('muñoz') ||
    e.web_name.toLowerCase().includes('munoz') ||
    e.web_name.toLowerCase().includes('muñoz')
  );
  console.log('\n--- FPL Munoz Elements ---');
  console.log(fplMunoz.map(e => ({ id: e.id, name: `${e.first_name} ${e.second_name}`, web_name: e.web_name, team: e.team, element_type: e.element_type, photo: e.photo })));

  const fplAlisson = fplData.elements.filter(e => 
    e.first_name.toLowerCase().includes('alisson') || 
    e.second_name.toLowerCase().includes('alisson') || 
    e.web_name.toLowerCase().includes('alisson') ||
    e.web_name.toLowerCase().includes('becker')
  );
  console.log('\n--- FPL Alisson Elements ---');
  console.log(fplAlisson.map(e => ({ id: e.id, name: `${e.first_name} ${e.second_name}`, web_name: e.web_name, team: e.team, element_type: e.element_type, photo: e.photo })));

  // Search DB for Daniel / Munoz
  const { data: dbAll } = await supabase.from('players').select('*');
  console.log('\n--- DB Total Players ---', dbAll.length);

  const dbMunoz = dbAll.filter(p => 
    p.name?.toLowerCase().includes('munoz') || 
    p.web_name?.toLowerCase().includes('munoz') ||
    p.full_name?.toLowerCase().includes('munoz')
  );
  console.log('\n--- DB Munoz Players ---');
  console.log(dbMunoz.map(p => ({ id: p.id, fpl_id: p.fpl_id, name: p.name, web_name: p.web_name, team: p.pl_team, pos: p.primary_position, photo: p.photo_url })));
}

inspectFplAndDb();
