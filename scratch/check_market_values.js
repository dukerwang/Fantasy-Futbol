const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

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

async function checkMarketValues() {
  const tmRaw = fs.readFileSync(path.join(__dirname, '../scripts/players.json'), 'utf-8');
  const tmPlayers = JSON.parse(tmRaw);

  const { data: dbPlayers } = await supabase.from('players').select('id, name, web_name, pl_team, market_value, fpl_id');

  console.log(`Total DB players: ${dbPlayers.length}`);

  const tmMap = new Map();
  tmPlayers.forEach(p => {
    tmMap.set(p.player_name.toLowerCase(), p);
  });

  const discrepancies = [];

  dbPlayers.forEach(p => {
    const tmMatch = tmMap.get(p.name.toLowerCase()) || tmMap.get(p.web_name?.toLowerCase());
    if (tmMatch) {
      if (p.market_value !== tmMatch.market_value) {
        discrepancies.push({
          id: p.id,
          name: p.name,
          web_name: p.web_name,
          pl_team: p.pl_team,
          db_value: p.market_value,
          tm_value: tmMatch.market_value,
          tm_raw: tmMatch.market_value_raw
        });
      }
    }
  });

  console.log(`\nFound ${discrepancies.length} market value discrepancies between DB and Transfermarkt JSON!`);
  console.log('Sample discrepancies (first 20):');
  console.table(discrepancies.slice(0, 20));
}

checkMarketValues();
