import { createAdminClient } from '../src/lib/supabase/admin';

async function main() {
  const admin = createAdminClient();

  // Find Aaron Kim or similar
  const { data: allUsers, error: uErr } = await admin
    .from('users')
    .select('id, email, username, notification_prefs');

  if (uErr) {
    console.error('Error fetching users:', uErr);
    return;
  }

  const targetUsers = allUsers?.filter(u => 
    u.username?.toLowerCase().includes('aaron') || 
    u.email?.toLowerCase().includes('aaron') ||
    u.username?.toLowerCase().includes('kim')
  ) ?? [];

  console.log('Target users found:', targetUsers.length);

  for (const u of targetUsers) {
    console.log('\n================ User:', u.id, u.username, u.email);
    console.log('Notification prefs:', JSON.stringify(u.notification_prefs));

    // Push subscriptions
    const { data: subs } = await admin
      .from('push_subscriptions')
      .select('id, endpoint, created_at')
      .eq('user_id', u.id);
    console.log('Push subscriptions count:', subs?.length);
    subs?.forEach(s => console.log('  Sub endpoint:', s.endpoint.slice(0, 50), s.created_at));

    // Teams
    const { data: teams } = await admin
      .from('teams')
      .select('id, team_name, abbreviation, league_id')
      .eq('user_id', u.id);
    console.log('Teams:', teams);

    for (const t of (teams ?? [])) {
      // Recent bids
      const { data: claims } = await admin
        .from('waiver_claims')
        .select('id, player_id, faab_bid, status, is_auction, expires_at, created_at, player:players(name)')
        .eq('team_id', t.id)
        .order('created_at', { ascending: false })
        .limit(5);
      console.log(`Recent claims for team ${t.team_name} (${t.abbreviation}):`);
      claims?.forEach(c => console.log(`  Player: ${(c.player as any)?.name} (${c.player_id}), bid: ${c.faab_bid}, status: ${c.status}, expires: ${c.expires_at}`));

      // Recent bid events
      const { data: events } = await admin
        .from('auction_bid_events')
        .select('id, player_id, amount, created_at, player:players(name)')
        .eq('team_id', t.id)
        .order('created_at', { ascending: false })
        .limit(5);
      console.log(`Recent bid events for team ${t.team_name}:`);
      events?.forEach(e => console.log(`  Bid €${e.amount}m on ${(e.player as any)?.name} at ${e.created_at}`));
    }

    // Recent notifications
    const { data: notifs } = await admin
      .from('notifications')
      .select('id, kind, title, content, tag, read, created_at')
      .eq('user_id', u.id)
      .order('created_at', { ascending: false })
      .limit(10);
    console.log('Recent notifications:');
    notifs?.forEach(n => console.log(`  [${n.created_at}] [${n.kind}] tag=${n.tag} | title="${n.title}" | content="${n.content}"`));
  }

  // Also check recent bids across the entire league to see who was outbid recently
  console.log('\n--- Recent 10 auction bid events in system ---');
  const { data: recentEvents } = await admin
    .from('auction_bid_events')
    .select('id, player_id, amount, created_at, player:players(name), team:teams(team_name, abbreviation, user_id)')
    .order('created_at', { ascending: false })
    .limit(10);
  recentEvents?.forEach(e => console.log(`[${e.created_at}] ${(e.team as any)?.team_name} (${(e.team as any)?.abbreviation}) bid €${e.amount}m on ${(e.player as any)?.name} (${e.player_id})`));

  // Check recent notifications created across all users with 'outbid' or 'raise'
  console.log('\n--- Recent 10 auction notifications in system ---');
  const { data: recentNotifs } = await admin
    .from('notifications')
    .select('id, user_id, kind, title, content, tag, created_at, user:users(username, email)')
    .eq('kind', 'auctions')
    .order('created_at', { ascending: false })
    .limit(10);
  recentNotifs?.forEach(n => console.log(`[${n.created_at}] user=${(n.user as any)?.username} (${(n.user as any)?.email}) | tag=${n.tag} | title="${n.title}" | content="${n.content}"`));
}

main().catch(console.error);
