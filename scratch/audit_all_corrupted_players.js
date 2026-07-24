process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

// Load canonical 2025-26 precomputed stats
const archivedStatsFile = fs.readFileSync(path.join(__dirname, '..', 'src', 'lib', 'season', 'archived_stats_2025_26.ts'), 'utf-8');
const jsonMatch = archivedStatsFile.match(/export const PRECOMPUTED_STATS_2025_26 = ({[\s\S]*});/);
let canonical2025_26 = [];
if (jsonMatch) {
  const parsed = JSON.parse(jsonMatch[1]);
  canonical2025_26 = parsed.players || [];
}

async function auditAllCorruptedPlayers() {
  console.log('=====================================================');
  console.log('   AUDITING ALL DB PLAYERS AGAINST CANONICAL SPECS');
  console.log('=====================================================\n');

  console.log(`Loaded ${canonical2025_26.length} canonical 2025/26 players.`);

  const fplRes = await fetch(FPL_URL, { headers: { 'User-Agent': 'FantasyFutbol/1.0' } });
  const fplData = await fplRes.json();
  const fplElements = fplData.elements.filter(el => el.element_type >= 1 && el.element_type <= 4);
  const fplMap = new Map(fplElements.map(el => [el.id, el]));

  const { data: dbPlayers, error } = await supabase.from('players').select('*');
  if (error) throw error;
  console.log(`Fetched ${dbPlayers.length} rows from public.players.\n`);

  const canonicalById = new Map(canonical2025_26.map(p => [p.id, p]));

  // Check specific Mbeumo & João Pedro records
  console.log('--- Searching Mbeumo & João Pedro in DB & Canonical ---');
  const dbMbeumo = dbPlayers.filter(p => p.name.includes('Mbeumo') || p.web_name?.includes('Mbeumo'));
  console.log('DB Mbeumo:', dbMbeumo);

  const dbJoaoPedro = dbPlayers.filter(p => p.name.includes('Pedro') || p.web_name?.includes('Pedro'));
  console.log('DB Pedro count:', dbJoaoPedro.length);
  dbJoaoPedro.forEach(p => console.log(`  id: ${p.id}, name: "${p.name}", web_name: "${p.web_name}", team: "${p.pl_team}", photo: "${p.photo_url}", fpl_id: ${p.fpl_id}`));

  console.log('\n--- Checking Mismatched Attributes Across ALL DB Players ---');
  let mismatchedCount = 0;

  for (const p of dbPlayers) {
    const canonical = canonicalById.get(p.id);
    let fplEl = p.fpl_id ? fplMap.get(p.fpl_id) : null;

    // Check if player photo URL contains a photo code that belongs to a different player
    // e.g. photo URL has photo code 487838 (Lewis Hall) but name is Bruno Fernandes, or vice versa
    const photoCode = p.photo_url?.match(/\/(\d+)\.png/)?.[1];

    if (canonical) {
      const canonicalPhotoCode = canonical.photo_url?.match(/\/(\d+)\.png/)?.[1];
      if (canonicalPhotoCode && photoCode && canonicalPhotoCode !== photoCode) {
        console.log(`🚨 MISMATCH DETECTED ON ID ${p.id}:`);
        console.log(`   DB Name: "${p.name}", DB WebName: "${p.web_name}", DB Team: "${p.pl_team}"`);
        console.log(`   Canonical Name: "${canonical.name}", Canonical Photo: ${canonicalPhotoCode}`);
        console.log(`   Current DB Photo Code: ${photoCode}`);
        mismatchedCount++;
      }
    }
  }

  console.log(`\nFound ${mismatchedCount} mismatched player records by photo code.`);
}

auditAllCorruptedPlayers().catch(console.error);
