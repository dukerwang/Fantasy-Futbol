import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const dynamic = 'force-dynamic';

// GET: fetch notifications for the current user
export async function GET(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const leagueId = searchParams.get('league_id');

  const admin = createAdminClient();
  let query = admin
    .from('notifications')
    .select('*')
    .eq('user_id', user.id);

  if (leagueId) {
    query = query.eq('league_id', leagueId);
  }

  const { data: notifications, error } = await query.order('created_at', { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ notifications: notifications ?? [] });
}

// POST: mark notification(s) as read
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { notificationId, leagueId, markAll } = body as {
    notificationId?: string;
    leagueId?: string;
    markAll?: boolean;
  };

  const admin = createAdminClient();

  if (markAll && leagueId) {
    // Mark all read for this league
    const { error } = await admin
      .from('notifications')
      .update({ read: true })
      .eq('user_id', user.id)
      .eq('league_id', leagueId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (notificationId) {
    // Mark single notification read
    const { error } = await admin
      .from('notifications')
      .update({ read: true })
      .eq('id', notificationId)
      .eq('user_id', user.id); // security check

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
}

// DELETE: delete a notification or clear all
export async function DELETE(req: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { notificationId, leagueId, clearAll } = body as {
    notificationId?: string;
    leagueId?: string;
    clearAll?: boolean;
  };

  const admin = createAdminClient();

  if (clearAll && leagueId) {
    // Clear all for this league
    const { error } = await admin
      .from('notifications')
      .delete()
      .eq('user_id', user.id)
      .eq('league_id', leagueId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  if (notificationId) {
    // Delete single notification
    const { error } = await admin
      .from('notifications')
      .delete()
      .eq('id', notificationId)
      .eq('user_id', user.id);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
}
