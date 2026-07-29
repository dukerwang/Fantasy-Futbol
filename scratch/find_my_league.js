const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await db.from('teams')
    .select('id, team_name, faab_budget, league_id, user_id, league:leagues(name, status)')
    .order('faab_budget', { ascending: false });
  const hits = data.filter(t => t.faab_budget === 424);
  console.log('teams with balance 424:');
  console.table(hits.map(t => ({ team: t.team_name, bal: t.faab_budget, league: t.league?.name, league_id: t.league_id })));
  console.log('\nall leagues:');
  const { data: lg } = await db.from('leagues').select('id, name, status');
  console.table(lg);
})();
