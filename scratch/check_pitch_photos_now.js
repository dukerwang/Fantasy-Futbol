process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testPitchPhotosNow() {
  const { data: players } = await supabase
    .from('players')
    .select('name, web_name, pl_team, pl_team_id, photo_url')
    .in('web_name', ['Haaland', 'Savinho', 'Cash', 'Scott']);

  for (const p of players) {
    if (p.photo_url) {
      const res = await fetch(p.photo_url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`  - ${p.name} (${p.web_name} - ${p.pl_team} [ID ${p.pl_team_id}]) -> HTTP Status: ${res.status}`);
    }
  }
}

testPitchPhotosNow();
