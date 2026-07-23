const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');

// Simple env file parser
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

async function checkStatus() {
  try {
    console.log('Connecting to Supabase...');
    
    // 1. Get leagues status
    const { data: leagues, error: lErr } = await supabase
      .from('leagues')
      .select('id, name, status, current_season, previous_season, roster_locked');
      
    if (lErr) throw lErr;
    console.log('\n--- Leagues ---');
    console.log(leagues);

    // 2. Check season_standings_archive
    const { data: archives, error: aErr } = await supabase
      .from('season_standings_archive')
      .select('id, league_id, season, team_id, final_rank, total_points');
      
    if (aErr) throw aErr;
    console.log('\n--- Season Standings Archive ---');
    console.log(`Total archived rows: ${archives.length}`);
    if (archives.length > 0) {
      console.log('Sample archive rows:', archives.slice(0, 5));
    }

    // 3. Count player_stats by season
    const { data: statsGrouped, error: sErr } = await supabase
      .from('player_stats')
      .select('season');
      
    if (sErr) throw sErr;
    
    console.log('\n--- Player Stats Count by Season ---');
    const counts = {};
    statsGrouped.forEach(row => {
      counts[row.season] = (counts[row.season] || 0) + 1;
    });
    console.log(counts);

  } catch (err) {
    console.error('Error checking database status:', err);
  }
}

checkStatus();
