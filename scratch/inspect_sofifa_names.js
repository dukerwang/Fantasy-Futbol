const fs = require('fs');
const path = require('path');
process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectSofifaNames() {
  const raw = fs.readFileSync(path.join(__dirname, '../scraped-sofifa.json'), 'utf-8');
  const teams = JSON.parse(raw);

  const sofifaPlayers = [];
  teams.forEach(t => {
    (t.players || []).forEach(p => {
      sofifaPlayers.push({
        id: p.id,
        commonName: p.commonName,
        fullName: p.fullName,
        team: t.name
      });
    });
  });

  console.log(`Total SoFIFA players in scraped-sofifa.json: ${sofifaPlayers.length}`);

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, full_name, pl_team')
    .eq('is_active', true);

  console.log(`Total active DB players: ${dbPlayers.length}`);

  // Inspect sample matches
  const beto = sofifaPlayers.find(p => p.commonName === 'Beto' || p.fullName?.includes('Betuncal'));
  console.log('\nBeto in SoFIFA:', beto);

  const sampleMatches = [];
  let matchedCount = 0;

  function norm(str) {
    if (!str) return '';
    return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
  }

  for (const dbP of dbPlayers) {
    const dbNormName = norm(dbP.name);
    const dbNormWeb = norm(dbP.web_name);
    const dbNormFull = norm(dbP.full_name);

    const match = sofifaPlayers.find(sp => {
      const sfNormFull = norm(sp.fullName);
      const sfNormCommon = norm(sp.commonName);
      return sfNormFull === dbNormName || sfNormFull === dbNormFull || sfNormCommon === dbNormWeb || sfNormCommon === dbNormName;
    });

    if (match) {
      matchedCount++;
      sampleMatches.push({
        db_name: dbP.name,
        db_web_name: dbP.web_name,
        db_full_name: dbP.full_name,
        sofifa_common: match.commonName,
        sofifa_full: match.fullName,
      });
    }
  }

  console.log(`\nMatched ${matchedCount} / ${dbPlayers.length} active DB players with SoFIFA`);
  console.log('\nSample comparison (first 15):');
  console.table(sampleMatches.slice(0, 15));
}

inspectSofifaNames().catch(console.error);
