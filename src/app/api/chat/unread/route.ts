import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET: unread chat summary for the league (lobby + per-DM-peer), for the nav badge and chat sidebar
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const leagueId = searchParams.get('league_id');
  if (!leagueId) {
    return NextResponse.json({ error: 'league_id is required' }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
  }

  const { data: myTeam } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam && league.commissioner_id !== user.id) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const [{ data: readRows }, { data: membership }] = await Promise.all([
    admin
      .from('chat_read_state')
      .select('peer_id, last_read_at')
      .eq('user_id', user.id)
      .eq('league_id', leagueId),
    admin
      .from('league_members')
      .select('joined_at')
      .eq('user_id', user.id)
      .eq('league_id', leagueId)
      .maybeSingle(),
  ]);

  // A conversation with no read-state row yet (a brand-new member, or a DM
  // thread never opened) defaults to "unread since joining the league" rather
  // than "unread since the dawn of time".
  const fallback = membership?.joined_at ?? new Date().toISOString();

  const lobbyLastRead = readRows?.find((r) => r.peer_id === null)?.last_read_at ?? fallback;
  const dmLastRead = new Map(
    (readRows ?? []).filter((r) => r.peer_id !== null).map((r) => [r.peer_id as string, r.last_read_at])
  );

  const floor = [lobbyLastRead, ...Array.from(dmLastRead.values())].reduce(
    (min, c) => (c < min ? c : min),
    fallback
  );

  const { data: candidates } = await admin
    .from('chat_messages')
    .select('sender_id, recipient_id, created_at')
    .eq('league_id', leagueId)
    .or(`recipient_id.is.null,recipient_id.eq.${user.id}`)
    .gt('created_at', floor)
    .order('created_at', { ascending: true });

  let lobbyUnreadCount = 0;
  const dmUnreadCounts: Record<string, number> = {};

  for (const m of candidates ?? []) {
    if (m.sender_id === user.id) continue; // your own messages are never "unread" for you
    if (m.recipient_id === null) {
      if (m.created_at > lobbyLastRead) lobbyUnreadCount++;
    } else if (m.sender_id) {
      const cursor = dmLastRead.get(m.sender_id) ?? fallback;
      if (m.created_at > cursor) {
        dmUnreadCounts[m.sender_id] = (dmUnreadCounts[m.sender_id] ?? 0) + 1;
      }
    }
  }

  const totalUnread = lobbyUnreadCount + Object.values(dmUnreadCounts).reduce((a, b) => a + b, 0);

  return NextResponse.json(
    {
      lobbyUnread: lobbyUnreadCount > 0,
      lobbyUnreadCount,
      dmUnreadCounts,
      dmUnreadPeerIds: Object.keys(dmUnreadCounts),
      totalUnread,
    },
    {
      headers: {
        'Cache-Control': 'private, max-age=5, stale-while-revalidate=10',
      },
    }
  );
}
