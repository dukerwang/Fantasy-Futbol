const { createClient } = require('@supabase/supabase-js');
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const LEAGUE = '45b30999-1b85-4e44-aadf-268ca7f76063';
(async () => {
  const { count: activeCount } = await db.from('players').select('id', { count:'exact', head:true }).eq('is_active', true);
  const { data: teams } = await db.from('teams').select('id').eq('league_id', LEAGUE);
  const ids = teams.map(t => t.id);
  const { data: entries } = await db.from('roster_entries').select('player_id, player:players(is_active)').in('team_id', ids);

  const distinct = new Set(entries.map(e => e.player_id));
  const distinctActive = new Set(entries.filter(e => e.player?.is_active).map(e => e.player_id));
  const { data: auctions } = await db.from('auction_state').select('player_id, kind').eq('league_id', LEAGUE).eq('status','live');
  const faAuctions = auctions.filter(a => a.kind === 'free_agent').length;

  console.log('active players            :', activeCount);
  console.log('roster entries            :', entries.length);
  console.log('distinct rostered         :', distinct.size);
  console.log('distinct rostered & ACTIVE:', distinctActive.size);
  console.log('inactive rostered         :', distinct.size - distinctActive.size, '  ← the drift');
  console.log('free-agent auctions       :', faAuctions);
  console.log();
  console.log('my derived count (wrong)  :', activeCount - distinct.size - faAuctions);
  console.log('what the API returns      :', activeCount - distinctActive.size - faAuctions);
})();
