import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import {
  isNotificationChannel,
  isNotificationKind,
  mergePref,
  resolvePrefs,
} from '@/lib/notifications/prefs';

export const dynamic = 'force-dynamic';

export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { data, error } = await supabase
    .from('users')
    .select('notification_prefs')
    .eq('id', user.id)
    .single();

  if (error) {
    console.error('[notification-prefs] load failed:', error.message);
    return NextResponse.json({ error: 'Failed to load preferences' }, { status: 500 });
  }

  return NextResponse.json({ prefs: resolvePrefs(data?.notification_prefs) });
}

export async function PATCH(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const kind = body?.kind;
  const channel = body?.channel;
  const enabled = body?.enabled;

  if (!isNotificationKind(kind) || !isNotificationChannel(channel) || typeof enabled !== 'boolean') {
    return NextResponse.json({ error: 'Invalid preference update' }, { status: 400 });
  }

  // Chat has no email template — refuse turning that cell on or storing it.
  if (kind === 'chat' && channel === 'email') {
    return NextResponse.json({ error: 'Chat has no email notifications' }, { status: 400 });
  }

  const { data: row, error: loadError } = await supabase
    .from('users')
    .select('notification_prefs')
    .eq('id', user.id)
    .single();

  if (loadError) {
    console.error('[notification-prefs] load before patch failed:', loadError.message);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }

  const next = mergePref(row?.notification_prefs, kind, channel, enabled);

  const { error: saveError } = await supabase
    .from('users')
    .update({ notification_prefs: next })
    .eq('id', user.id);

  if (saveError) {
    console.error('[notification-prefs] save failed:', saveError.message);
    return NextResponse.json({ error: 'Failed to update preferences' }, { status: 500 });
  }

  return NextResponse.json({ prefs: next });
}
