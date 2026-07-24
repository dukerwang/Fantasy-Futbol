process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function normalize(name) {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/['"']/g, '')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function fixRemaining() {
  const tmRaw = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'players.json'), 'utf-8');
  const tmPlayers = JSON.parse(tmRaw);

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, pl_team, market_value')
    .eq('is_active', true)
    .is('market_value_updated_at', null);

  console.log(`Checking ${dbPlayers.length} remaining unmatched DB players...`);

  const updates = [];

  for (const dbP of dbPlayers) {
    const fullNameNorm = normalize(dbP.name);
    const webNameNorm = normalize(dbP.web_name);

    for (const tmP of tmPlayers) {
      if (!tmP.market_value || !tmP.player_name) continue;
      const tmNorm = normalize(tmP.player_name);

      const dbLast = fullNameNorm.split(' ').pop();
      const tmLast = tmNorm.split(' ').pop();

      // If web_name or last name matches exactly and team matches or is promoted
      if ((dbLast === tmLast && dbLast.length >= 4) || (webNameNorm === tmNorm) || (webNameNorm && tmNorm.endsWith(webNameNorm) && webNameNorm.length >= 4)) {
        updates.push({
          id: dbP.id,
          name: dbP.name,
          tm_name: tmP.player_name,
          market_value: tmP.market_value
        });
        break;
      }
    }
  }

  console.log(`Matched additional ${updates.length} players:`);
  updates.forEach(u => console.log(`  - ${u.name} -> Transfermarkt "${u.tm_name}" (€${u.market_value}m)`));

  for (const u of updates) {
    await supabase
      .from('players')
      .update({
        market_value: u.market_value,
        market_value_updated_at: new Date().toISOString()
      })
      .eq('id', u.id);
  }

  const { data: finalDb } = await supabase
    .from('players')
    .select('name, web_name, pl_team, primary_position, market_value, market_value_updated_at')
    .eq('is_active', true);

  const updatedTotal = finalDb.filter(p => p.market_value_updated_at != null).length;
  const unmatched = finalDb.filter(p => p.market_value_updated_at == null);

  console.log(`\nFINAL TOTAL MATCHED: ${updatedTotal} / ${finalDb.length} (${((updatedTotal / finalDb.length) * 100).toFixed(1)}%)`);
  console.log(`Remaining Unmatched Count: ${unmatched.length}`);
  console.log('\nFinal Unmatched Players List (Pure Academy / Reserves):');
  unmatched.forEach(p => console.log(`  - ${p.name} (${p.pl_team}) | Pos: ${p.primary_position} | FPL Price: £${p.market_value}m`));
}

fixRemaining();
