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

async function deepAudit() {
  console.log('--- Checking for any player with "Daniel", "Munoz", "Mejía" or fpl_id 201 ---');
  const { data: p201 } = await supabase.from('players').select('*').eq('fpl_id', 201);
  console.log('fpl_id 201 row:', p201);

  const { data: pDaniel } = await supabase.from('players').select('id, fpl_id, name, web_name, pl_team, primary_position, is_active, photo_url').ilike('name', '%daniel%');
  console.log('\nPlayers with "Daniel" in name:', pDaniel.length);
  console.log(pDaniel);

  // Check rosters/squads or player_stats for Daniel Munoz or old IDs
  console.log('\n--- Checking roster_players for any player_id ---');
  const { data: rosterPlayers } = await supabase.from('roster_players').select('player_id, rosters(team_name, league_id)');
  console.log(`Total rostered players: ${rosterPlayers?.length}`);

  // Fetch player details for all rostered players
  if (rosterPlayers && rosterPlayers.length > 0) {
    const rosterPlayerIds = rosterPlayers.map(r => r.player_id);
    const { data: rDbPlayers } = await supabase.from('players').select('id, name, web_name, pl_team, primary_position, fpl_id, photo_url').in('id', rosterPlayerIds);
    console.log('Rostered players sample:');
    console.table(rDbPlayers.slice(0, 10));
    
    // Check if Alisson or Munoz is in any roster
    const alissonRoster = rDbPlayers.filter(p => p.name.toLowerCase().includes('alisson'));
    console.log('Alisson in rosters:', alissonRoster);
    const munozRoster = rDbPlayers.filter(p => p.name.toLowerCase().includes('munoz'));
    console.log('Munoz in rosters:', munozRoster);
  }

  // Check player_stats for Daniel Munoz or photo code 247348
  const { data: statsMunoz } = await supabase.from('player_stats').select('player_id, player_name, season').ilike('player_name', '%munoz%');
  console.log('\nPlayer stats for Munoz:', statsMunoz);

  // Check all players where photo_url contains 247348 (Daniel Muñoz's FPL photo code)
  const { data: photo247348 } = await supabase.from('players').select('*').ilike('photo_url', '%247348%');
  console.log('\nPlayer with photo 247348 (Daniel Muñoz FPL photo code):', photo247348);
}

deepAudit();
