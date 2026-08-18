import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { createNotification } from '@/lib/notifications/createNotification';
import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { leagueId } = await request.json() as { leagueId?: string };
  if (!leagueId) return NextResponse.json({ error: 'Missing leagueId' }, { status: 400 });

  const admin = createAdminClient();
  await createNotification(admin, {
    leagueId,
    userId: user.id,
    title: 'Test notification',
    content: "If you can see this, push notifications are working.",
    url: `/league/${leagueId}`,
  });

  return NextResponse.json({ ok: true });
}
