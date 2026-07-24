process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const FPL_2026_TEAM_IDS = {
  'Arsenal': 1,
  'Aston Villa': 2,
  'Bournemouth': 3,
  'Brentford': 4,
  'Brighton': 5,
  'Chelsea': 6,
  'Coventry City': 7,
  'Crystal Palace': 8,
  'Everton': 9,
  'Fulham': 10,
  'Hull City': 11,
  'Ipswich Town': 12,
  'Leeds': 13,
  'Liverpool': 14,
  'Man City': 15,
  'Man Utd': 16,
  'Newcastle': 17,
  "Nott'm Forest": 18,
  'Spurs': 19,
  'Sunderland': 20
};

async function fixDbTeamIds() {
  console.log('--- UPDATING ALL PLAYER PL_TEAM_IDS FOR 2026/27 SEASON ---');

  for (const [teamName, teamId] of Object.entries(FPL_2026_TEAM_IDS)) {
    const { data, error } = await supabase
      .from('players')
      .update({ pl_team_id: teamId })
      .eq('pl_team', teamName)
      .select('id');

    console.log(`Updated ${teamName} -> pl_team_id: ${teamId} (${data ? data.length : 0} players updated)`);
  }

  // Also fix photo_url format if missing 'p' prefix (e.g. 593117.png -> p593117.png)
  const { data: players } = await supabase.from('players').select('id, photo_url').eq('is_active', true);
  let photoFixes = 0;
  for (const p of players) {
    if (p.photo_url && p.photo_url.match(/\/(\d+)\.png$/)) {
      const fixedUrl = p.photo_url.replace(/\/(\d+)\.png$/, '/p$1.png');
      await supabase.from('players').update({ photo_url: fixedUrl }).eq('id', p.id);
      photoFixes++;
    }
  }

  console.log(`Fixed ${photoFixes} player photo CDN URLs in DB.`);
  console.log('✅ ALL TEAM IDS & PHOTO URLS UPDATED IN GAFFA DB!');
}

fixDbTeamIds().catch(console.error);
