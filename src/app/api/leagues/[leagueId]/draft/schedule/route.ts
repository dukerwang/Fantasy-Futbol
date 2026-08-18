import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/client';
import { getDraftScheduledEmail, getDraftCancelledEmail } from '@/lib/email/templates';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // Verify league exists, user is commissioner, and status is 'setup'
  const { data: league } = await admin
    .from('leagues')
    .select('id, name, commissioner_id, status')
    .eq('id', leagueId)
    .single();

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });
  if (league.commissioner_id !== user.id) return NextResponse.json({ error: 'Not commissioner' }, { status: 403 });
  if (league.status !== 'setup') return NextResponse.json({ error: 'League is not in setup phase' }, { status: 400 });

  const body = await req.json();
  const { scheduledAt } = body; // ISO String (or null to clear)

  let scheduledDate: Date | null = null;
  if (scheduledAt !== null) {
    scheduledDate = new Date(scheduledAt);
    if (isNaN(scheduledDate.getTime())) {
      return NextResponse.json({ error: 'Invalid scheduled date' }, { status: 400 });
    }
    if (scheduledDate.getTime() <= Date.now()) {
      return NextResponse.json({ error: 'Scheduled draft time must be in the future' }, { status: 400 });
    }
  }

  // Update draft_scheduled_at
  const { error: leagueErr } = await admin
    .from('leagues')
    .update({ draft_scheduled_at: scheduledDate ? scheduledDate.toISOString() : null })
    .eq('id', leagueId);

  if (leagueErr) return NextResponse.json({ error: leagueErr.message }, { status: 500 });

  // Send notifications to all league members
  try {
    const { data: allTeams } = await admin
      .from('teams')
      .select('user_id')
      .eq('league_id', leagueId);

    if (allTeams && allTeams.length > 0) {
      const userIds = allTeams.map(t => t.user_id);
      const { data: users } = await admin.from('users').select('email').in('id', userIds);
      const emails = (users ?? []).map(u => u.email).filter(Boolean);

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
      const lobbyUrl = `${baseUrl}/league/${leagueId}`;

      const { createNotification } = await import('@/lib/notifications/createNotification');

      if (scheduledDate) {
        // Formatted date string for email
        const formattedTime = scheduledDate.toLocaleString('en-US', {
          weekday: 'long',
          year: 'numeric',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZoneName: 'short'
        });

        if (emails.length > 0) {
          await sendEmail({
            to: emails,
            subject: `Draft Scheduled: ${league.name}`,
            html: getDraftScheduledEmail(league.name, formattedTime, lobbyUrl)
          });
        }

        // Create in-game notifications
        for (const t of allTeams) {
          await createNotification(admin, {
            leagueId,
            userId: t.user_id,
            title: 'Draft Set',
            content: `The commissioner has scheduled the draft for **${league.name}** for **${formattedTime}**!`,
            url: `/league/${leagueId}`
          });
        }
      } else {
        // Cancelled / Postponed schedule
        if (emails.length > 0) {
          await sendEmail({
            to: emails,
            subject: `Draft Postponed: ${league.name}`,
            html: getDraftCancelledEmail(league.name, lobbyUrl)
          });
        }

        // Create in-game notifications
        for (const t of allTeams) {
          await createNotification(admin, {
            leagueId,
            userId: t.user_id,
            title: 'Draft Delayed',
            content: `The scheduled draft for **${league.name}** has been cancelled or postponed.`,
            url: `/league/${leagueId}`
          });
        }
      }
    }
  } catch (err) {
    console.error('[draft/schedule] Failed to send notifications:', err);
  }

  return NextResponse.json({ ok: true });
}
