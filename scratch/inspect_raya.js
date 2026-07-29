process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const { getPlayerDisplayName } = require('../src/lib/players/displayName');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function inspectRaya() {
  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, full_name, web_name, sofifa_common_name')
    .ilike('name', '%Raya%');

  console.log('Raya records in DB:');
  console.table(dbPlayers);

  if (dbPlayers && dbPlayers.length > 0) {
    for (const p of dbPlayers) {
      console.log(`\nPlayer: ${p.name}`);
      console.log('  full display:', getPlayerDisplayName(p, 'full'));
      console.log('  initial_last display:', getPlayerDisplayName(p, 'initial_last'));
      console.log('  split display:', getPlayerDisplayName(p, 'split'));
    }
  }
}

inspectRaya().catch(console.error);
