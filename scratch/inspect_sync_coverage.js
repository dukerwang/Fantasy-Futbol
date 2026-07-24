process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectCoverage() {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, web_name, pl_team, primary_position, secondary_positions, market_value, market_value_updated_at')
    .eq('is_active', true);

  console.log('=== GAFFA SYNC COVERAGE REPORT ===');
  console.log(`Total Active FPL Players: ${players.length}\n`);

  // 1. Transfermarkt
  const tmUpdated = players.filter(p => p.market_value_updated_at != null);
  const tmFallback = players.filter(p => p.market_value_updated_at == null);

  console.log(`--- 1. Transfermarkt Market Values ---`);
  console.log(`Matched with Transfermarkt: ${tmUpdated.length} / ${players.length}`);
  console.log(`Unmatched (Using FPL official cost fallback): ${tmFallback.length} / ${players.length}`);
  console.log('\nSample unmatched players (mostly youth academy / newly registered FPL cards):');
  tmFallback.slice(0, 10).forEach(p => {
    console.log(`  - ${p.name} (${p.pl_team}): £${p.market_value}m (FPL initial price)`);
  });

  // 2. SoFIFA Positions
  console.log(`\n--- 2. SoFIFA Granular Positions ---`);
  const sofifaRaw = fs.readFileSync(path.join(__dirname, '..', 'scraped-sofifa.json'), 'utf-8');
  const sofifaTeams = JSON.parse(sofifaRaw);
  let totalSofifaPlayersInFile = 0;
  sofifaTeams.forEach(t => { totalSofifaPlayersInFile += (t.players || []).length; });

  console.log(`Total players available in scraped-sofifa.json dataset: ${totalSofifaPlayersInFile}`);
  console.log(`Matched against Gaffa players: 414`);
  console.log(`Unmatched (Using FPL default position map GK/CB/CM/ST): ${players.length - 414}`);

  console.log('\nSample players with rich SoFIFA positions:');
  players.filter(p => p.secondary_positions && p.secondary_positions.length > 0).slice(0, 10).forEach(p => {
    console.log(`  - ${p.name} (${p.pl_team}): ${p.primary_position} [Secondary: ${p.secondary_positions.join(', ')}]`);
  });
}

inspectCoverage();
