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

async function findEderson() {
  const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' }
  });
  const fplData = await fplRes.json();
  const fplEderson = fplData.elements.filter(e => e.first_name.toLowerCase().includes('ederson') || e.second_name.toLowerCase().includes('ederson') || e.web_name.toLowerCase().includes('ederson'));
  console.log('FPL Ederson elements:', fplEderson.map(e => ({ id: e.id, name: `${e.first_name} ${e.second_name}`, web_name: e.web_name, team: e.team, element_type: e.element_type, photo: e.photo })));
}

findEderson();
