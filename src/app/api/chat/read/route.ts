import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// POST: mark a conversation (league lobby, or a DM thread) as read up to now
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { leagueId, peerId } = body as { leagueId: string; peerId?: string | null };

  if (!leagueId) {
    return NextResponse.json({ error: 'leagueId is required' }, { status: 400 });
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

  const { error } = await admin
    .from('chat_read_state')
    .upsert(
      {
        user_id: user.id,
        league_id: leagueId,
        peer_id: peerId || null,
        last_read_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,league_id,peer_id' }
    );

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
