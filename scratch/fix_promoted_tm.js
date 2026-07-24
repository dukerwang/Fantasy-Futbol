process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');

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

async function fixPromotedTm() {
  console.log('--- MATCHING PROMOTED CLUBS & REMAINING PLAYERS ---');

  const tmRaw = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'players.json'), 'utf-8');
  const tmPlayers = JSON.parse(tmRaw);

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, pl_team, primary_position, market_value, market_value_updated_at')
    .eq('is_active', true)
    .is('market_value_updated_at', null);

  const tmNames = tmPlayers.map(p => p.player_name ? normalize(p.player_name) : '');

  const updates = [];

  for (const dbP of dbPlayers) {
    const fullNameNorm = normalize(dbP.name);
    const webNameNorm = normalize(dbP.web_name);

    let bestMatch = null;
    let bestScore = 0;

    for (let i = 0; i < tmPlayers.length; i++) {
      const tmP = tmPlayers[i];
      if (!tmP.market_value || !tmP.player_name) continue;
      const tmNorm = tmNames[i];

      // Match web_name or full name or last name
      const nameScore = stringSimilarity.compareTwoStrings(fullNameNorm, tmNorm);
      const webScore = stringSimilarity.compareTwoStrings(webNameNorm, tmNorm);
      const maxScore = Math.max(nameScore, webScore);

      if (maxScore > bestScore && maxScore >= 0.65) {
        bestScore = maxScore;
        bestMatch = tmP;
      }
    }

    if (bestMatch) {
      updates.push({
        id: dbP.id,
        name: dbP.name,
        tm_name: bestMatch.player_name,
        market_value: bestMatch.market_value
      });
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
  console.log('\nFinal Unmatched Players List (Pure Academy Reserves):');
  unmatched.forEach(p => console.log(`  - ${p.name} (${p.pl_team}) | Pos: ${p.primary_position} | FPL Price: £${p.market_value}m`));
}

fixPromotedTm();
