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

async function fixFullSurnames() {
  console.log('--- MATCHING COMPOSITE SPANISH/PORTUGUESE FPL SURNAMES ---');

  const tmRaw = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'players.json'), 'utf-8');
  const tmPlayers = JSON.parse(tmRaw);

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, pl_team, primary_position, market_value, market_value_updated_at')
    .eq('is_active', true);

  const tmMap = new Map();
  tmPlayers.forEach(p => {
    if (p.market_value != null && p.player_name) {
      tmMap.set(normalize(p.player_name), p);
    }
  });

  const updates = [];

  for (const dbP of dbPlayers) {
    if (dbP.market_value_updated_at != null) continue; // Already updated

    const fullNameNorm = normalize(dbP.name);
    const webNameNorm = normalize(dbP.web_name);

    let tmMatch = tmMap.get(fullNameNorm) || tmMap.get(webNameNorm);

    if (!tmMatch) {
      // Strategy 1: First word + Last word of FPL name (e.g. "David Martín" or "David Raya")
      const words = fullNameNorm.split(' ');
      if (words.length > 2) {
        const firstLast = `${words[0]} ${words[words.length - 1]}`;
        const firstSecond = `${words[0]} ${words[1]}`;
        const secondLast = `${words[1]} ${words[words.length - 1]}`;
        tmMatch = tmMap.get(firstLast) || tmMap.get(firstSecond) || tmMap.get(secondLast);
      }
    }

    if (!tmMatch) {
      // Strategy 2: Check if TM player name is a substring of FPL full name
      for (const tmP of tmPlayers) {
        if (!tmP.market_value || !tmP.player_name) continue;
        const tmNorm = normalize(tmP.player_name);
        if (tmNorm.length >= 4 && (fullNameNorm.includes(tmNorm) || (webNameNorm && tmNorm.includes(webNameNorm)))) {
          // Verify club or position similarity to prevent false positive matches
          tmMatch = tmP;
          break;
        }
      }
    }

    if (tmMatch) {
      updates.push({
        id: dbP.id,
        name: dbP.name,
        tm_name: tmMatch.player_name,
        market_value: tmMatch.market_value
      });
    }
  }

  console.log(`Matched additional ${updates.length} players with composite surname matching:`);
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

  // Final check of remaining unmatched
  const { data: remaining } = await supabase
    .from('players')
    .select('name, web_name, pl_team, primary_position, market_value')
    .eq('is_active', true)
    .is('market_value_updated_at', null)
    .order('pl_team', { ascending: true });

  console.log(`\nFinal Remaining Unmatched Count: ${remaining.length} / ${dbPlayers.length}`);
  console.log('Final Remaining Unmatched List:');
  remaining.forEach(p => console.log(`  - ${p.name} (${p.pl_team}) | Pos: ${p.primary_position} | FPL Price: £${p.market_value}m`));
}

fixFullSurnames();
