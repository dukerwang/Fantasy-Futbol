import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications/createNotification';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  let { leagueId } = await request.json() as { leagueId?: string };
  if (!leagueId) {
    const { data: team } = await admin
      .from('teams')
      .select('league_id')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    leagueId = team?.league_id;
  }
  if (!leagueId) return NextResponse.json({ error: 'No league found for this user' }, { status: 400 });

  await createNotification(admin, {
    leagueId,
    userId: user.id,
    title: 'Test notification',
    content: "If you can see this, push notifications are working.",
    url: `/league/${leagueId}`,
  });

  return NextResponse.json({ ok: true });
}
