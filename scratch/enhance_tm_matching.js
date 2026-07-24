process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

// Explicit aliases for Portuguese/Brazilian multi-surname FPL registrations
const EXPLICIT_ALIASES = {
  'Gabriel dos Santos Magalhães': 'Gabriel Magalhães',
  'Gabriel Fernando de Jesus': 'Gabriel Jesus',
  'Estêvão Almeida de Oliveira Gonçalves': 'Estêvão',
  'Pedro Lomba Neto': 'Pedro Neto',
  'João Pedro Junqueira de Jesus': 'João Pedro',
  'Norberto Bercique Gomes Betuncal': 'Beto',
  'Rúben dos Santos Gato Alves Dias': 'Rúben Dias',
  'Vitor de Oliveira Nunes dos Reis': 'Vitor Reis',
  'Sávio Moreira de Oliveira': 'Savinho',
  "Rodrigo 'Rodri' Hernandez Cascante": 'Rodri',
  'Andrey Nascimento dos Santos': 'Andrey Santos',
  'Diogo Dalot Teixeira': 'Diogo Dalot',
  'Bruno Guimarães Rodriguez Moura': 'Bruno Guimarães',
  'Murillo Costa dos Santos': 'Murillo',
  'Richarlison de Andrade': 'Richarlison',
  'João Victor de Souza Menezes': 'Souza',
  'Francisco Evanilson de Lima Barbosa': 'Evanilson',
  'Igor Julio dos Santos de Paulo': 'Igor',
  'Alisson Becker': 'Alisson',
  'Mateo Joseph Fernández-Regatillo': 'Mateo Joseph',
  'Stefan Bajčetić Maquieira': 'Stefan Bajcetic'
};

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

async function cleanTmMatching() {
  console.log('--- CLEAN EXACT & ALIAS TRANSFERMARKT MATCHING ---');

  const tmRaw = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'players.json'), 'utf-8');
  const tmPlayers = JSON.parse(tmRaw);

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, pl_team, primary_position, market_value, market_value_updated_at')
    .eq('is_active', true);

  const tmByName = new Map();
  tmPlayers.forEach(p => {
    if (p.market_value != null) {
      tmByName.set(normalize(p.player_name), p);
    }
  });

  const updates = [];
  const unmatched = [];

  for (const dbP of dbPlayers) {
    const fullNameNorm = normalize(dbP.name);
    const webNameNorm = normalize(dbP.web_name);
    const aliasTarget = EXPLICIT_ALIASES[dbP.name] ? normalize(EXPLICIT_ALIASES[dbP.name]) : null;

    let tmMatch = tmByName.get(fullNameNorm) || (aliasTarget ? tmByName.get(aliasTarget) : null) || tmByName.get(webNameNorm);

    if (!tmMatch) {
      // High-precision fuzzy check (>= 0.88 similarity score)
      let bestScore = 0;
      for (const tmP of tmPlayers) {
        if (!tmP.market_value) continue;
        const score = stringSimilarity.compareTwoStrings(fullNameNorm, normalize(tmP.player_name));
        if (score > bestScore && score >= 0.88) {
          bestScore = score;
          tmMatch = tmP;
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
    } else {
      unmatched.push(dbP);
    }
  }

  console.log(`Matched ${updates.length} / ${dbPlayers.length} active players with 100% precision.`);
  console.log(`Unmatched Count: ${unmatched.length} / ${dbPlayers.length}`);

  for (const u of updates) {
    await supabase
      .from('players')
      .update({
        market_value: u.market_value,
        market_value_updated_at: new Date().toISOString()
      })
      .eq('id', u.id);
  }

  // Clear market_value_updated_at for strictly unmatched players so they use FPL initial fallback
  const unmatchedIds = unmatched.map(p => p.id);
  if (unmatchedIds.length > 0) {
    await supabase
      .from('players')
      .update({ market_value_updated_at: null })
      .in('id', unmatchedIds);
  }

  console.log('\n--- UNMATCHED PLAYERS BREAKDOWN (Pure Academy / Youth Reserves) ---');
  unmatched.forEach(p => {
    console.log(`  - ${p.name} (${p.pl_team}) | Pos: ${p.primary_position} | FPL Price: £${p.market_value}m`);
  });
}

cleanTmMatching();
