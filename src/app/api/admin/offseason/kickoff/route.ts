import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/client';
import { getSystemAuctionsEmail } from '@/lib/email/templates';

export const maxDuration = 300;

function authorize(req: NextRequest): boolean {
  const secret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  return !!secret && !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { league_id?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { league_id: leagueId } = body;
  if (!leagueId) {
    return NextResponse.json({ error: 'league_id required in request body' }, { status: 400 });
  }

  const admin = createAdminClient();

  // 1. Fetch league and verify it's in offseason
  const { data: league, error: leagueErr } = await admin
    .from('leagues')
    .select('status, roster_locked')
    .eq('id', leagueId)
    .single();

  if (leagueErr || !league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
  }

  if (league.status !== 'offseason') {
    return NextResponse.json(
      { error: 'League is not in offseason. Cannot kickoff season.' },
      { status: 400 }
    );
  }

  const AUCTION_THRESHOLD = 40.0;
  const AUCTION_WINDOW_HOURS = 48;

  // 2. Find all unowned players >= 40m
  // We first fetch all owned players in this league
  const { data: ownedEntries } = await admin
    .from('roster_entries')
    .select('player_id')
    .eq('league_id', leagueId)
    .not('player_id', 'is', null);

  const ownedPlayerIds = new Set((ownedEntries ?? []).map(e => e.player_id));

  // Then fetch all pending auctions in this league
  const { data: pendingAuctions } = await admin
    .from('waiver_claims')
    .select('player_id')
    .eq('league_id', leagueId)
    .eq('is_auction', true)
    .eq('status', 'pending');

  const auctionPlayerIds = new Set((pendingAuctions ?? []).map(a => a.player_id));

  // Fetch all players >= 40m
  const { data: allHighValuePlayers } = await admin
    .from('players')
    .select('id, web_name, market_value')
    .gte('market_value', AUCTION_THRESHOLD);

  const playersToAuction = (allHighValuePlayers ?? []).filter(
    p => !ownedPlayerIds.has(p.id) && !auctionPlayerIds.has(p.id)
  );

  // 3. Create the auctions
  if (playersToAuction.length > 0) {
    const expiresAt = new Date();
    expiresAt.setHours(expiresAt.getHours() + AUCTION_WINDOW_HOURS);

    const auctionInserts = playersToAuction.map(p => ({
      league_id: leagueId,
      player_id: p.id,
      is_auction: true,
      status: 'pending',
      expires_at: expiresAt.toISOString(),
      amount: 0,
      team_id: null, // System generated
    }));

    const { error: insertErr } = await admin
      .from('waiver_claims')
      .insert(auctionInserts);

    if (insertErr) {
      console.error('[kickoff] Failed to insert summer auctions:', insertErr);
      return NextResponse.json({ error: 'Failed to create summer auctions' }, { status: 500 });
    }
  }

  // 4. Unlock rosters and set status to active
  const { error: updateErr } = await admin
    .from('leagues')
    .update({
      status: 'active',
      roster_locked: false,
      updated_at: new Date().toISOString(),
    })
    .eq('id', leagueId);

  if (updateErr) {
    console.error('[kickoff] Failed to activate league:', updateErr);
    return NextResponse.json({ error: 'Failed to activate league' }, { status: 500 });
  }

  // --- SEND EMAIL NOTIFICATION ---
  try {
    const { data: allTeams } = await admin.from('teams').select('user_id').eq('league_id', leagueId);
    if (allTeams && allTeams.length > 0) {
      const userIds = allTeams.map(t => t.user_id);
      const { data: users } = await admin.from('users').select('email').in('id', userIds);
      const emails = (users ?? []).map(u => u.email).filter(Boolean);

      if (emails.length > 0) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
        const playerInfo = playersToAuction.map(p => ({ name: p.web_name ?? 'Unknown', value: p.market_value as number }));
        await sendEmail({
          to: emails,
          subject: 'The Season Has Begun!',
          html: getSystemAuctionsEmail(playerInfo, true, `${baseUrl}/league/${leagueId}`)
        });
      }

      // Create in-game notifications
      const { createNotification } = await import('@/lib/notifications/createNotification');
      for (const t of allTeams) {
        await createNotification(admin, {
          leagueId,
          userId: t.user_id,
          title: 'New Season Started!',
          content: `The commissioner has officially kicked off the new season! Rosters are unlocked, and **${playersToAuction.length}** high-value summer arrivals have been added to the FAAB auction block.`,
          url: `/league/${leagueId}`
        });
      }
    }
  } catch (err) {
    console.error('[kickoff] Failed to send kickoff notifications:', err);
  }

  return NextResponse.json({
    ok: true,
    message: 'Season started successfully.',
    auctionsCreated: playersToAuction.length,
    auctionedPlayers: playersToAuction.map(p => p.web_name),
  });
}
