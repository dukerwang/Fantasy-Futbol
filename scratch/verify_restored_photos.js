process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function verifyAllRestored() {
  const { data: players } = await supabase
    .from('players')
    .select('name, web_name, photo_url')
    .in('web_name', ['Hincapie', 'Virgil', 'Meslier', 'Scott', 'Haaland', 'Savinho', 'Cash']);

  for (const p of players) {
    if (p.photo_url) {
      const res = await fetch(p.photo_url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
      console.log(`  - ${p.name} (${p.web_name}) -> HTTP ${res.status}`);
    }
  }
}

verifyAllRestored();
