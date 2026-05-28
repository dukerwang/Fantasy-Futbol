import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET: fetch chat logs for the league (Lobby + User DMs)
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

  // Verify that the user is actually a member of the league (has a team or is the commissioner)
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

  // Fetch all managers/teams in this league to enrich the sender context on the frontend
  const { data: leagueTeams } = await admin
    .from('teams')
    .select(`
      id, team_name, user_id, abbreviation,
      user:users(id, username, avatar_url)
    `)
    .eq('league_id', leagueId);

  // Fetch messages:
  // - Public messages (recipient_id IS NULL)
  // - Private DMs sent TO the user (recipient_id = user.id)
  // - Private DMs sent BY the user (sender_id = user.id)
  const { data: messages, error } = await admin
    .from('chat_messages')
    .select(`
      *,
      sender:users!chat_messages_sender_id_fkey(id, username, avatar_url)
    `)
    .eq('league_id', leagueId)
    .or(`recipient_id.is.null,recipient_id.eq.${user.id},sender_id.eq.${user.id}`)
    .order('created_at', { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    messages: messages ?? [],
    teams: leagueTeams ?? []
  });
}

// POST: send a chat message
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { leagueId, message, recipientId } = body as {
    leagueId: string;
    message: string;
    recipientId?: string | null;
  };

  if (!leagueId || !message?.trim()) {
    return NextResponse.json({ error: 'leagueId and message are required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Verify that the sender is a member of the league (has a team or is the commissioner)
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

  // Insert chat message
  const { data: chatMsg, error } = await admin
    .from('chat_messages')
    .insert({
      league_id: leagueId,
      sender_id: user.id,
      recipient_id: recipientId || null,
      message: message.trim(),
    })
    .select(`
      *,
      sender:users!chat_messages_sender_id_fkey(id, username, avatar_url)
    `)
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, message: chatMsg });
}
