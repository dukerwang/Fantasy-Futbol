process.loadEnvFile('.env.local');
const { createClient } = require('@supabase/supabase-js');
const { syncPlayersFromFpl } = require('../src/lib/players/syncPlayers');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

async function testSyncIdempotency() {
  console.log('Testing syncPlayersFromFpl idempotency...');
  const res = await syncPlayersFromFpl(supabase);
  console.log('Sync result:', res);

  // Verify duplicates in DB
  const { data: dbPlayers } = await supabase.from('players').select('id, name');
  const nameGroups = new Map();
  dbPlayers.forEach(p => {
    const norm = p.name.toLowerCase().trim();
    if (!nameGroups.has(norm)) nameGroups.set(norm, []);
    nameGroups.get(norm).push(p);
  });

  const duplicates = Array.from(nameGroups.entries()).filter(([_, list]) => list.length > 1);
  console.log(`Duplicates in DB after sync: ${duplicates.length}`);

  // Check Bruno & Hall
  const { data: bruno } = await supabase.from('players').select('id, fpl_id, name, web_name, pl_team, primary_position, photo_url').ilike('name', 'Bruno Fernandes');
  console.log('Bruno Fernandes:', bruno);

  const { data: hall } = await supabase.from('players').select('id, fpl_id, name, web_name, pl_team, primary_position, photo_url').ilike('name', 'Lewis Hall');
  console.log('Lewis Hall:', hall);

  if (duplicates.length === 0 && bruno.length === 1 && bruno[0].fpl_id === 426 && bruno[0].pl_team === 'Man Utd' && hall.length === 1 && hall[0].fpl_id === 449 && hall[0].pl_team === 'Newcastle') {
    console.log('✅ SYNC IDEMPOTENCY AND INTEGRITY TEST PASSED PERFECTLY!');
  } else {
    console.error('❌ INTEGRITY TEST FAILED');
  }
}

testSyncIdempotency().catch(console.error);
