import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmailToUsers } from '@/lib/email/sendEmailToUsers';
import { getDraftStartedEmail } from '@/lib/email/templates';

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

  // Verify league exists, user is commissioner, status is 'setup'
  const { data: league } = await admin
    .from('leagues')
    .select('id, commissioner_id, status, name')
    .eq('id', leagueId)
    .single();

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });
  if (league.commissioner_id !== user.id) return NextResponse.json({ error: 'Not commissioner' }, { status: 403 });
  if (league.status !== 'setup') return NextResponse.json({ error: 'League is not in setup phase' }, { status: 400 });

  const body = await req.json();
  const order: { teamId: string; draftOrder: number }[] = body.order;

  if (!Array.isArray(order) || order.length === 0) {
    return NextResponse.json({ error: 'Invalid draft order' }, { status: 400 });
  }

  // Verify all teams in this league are accounted for
  const { data: teams } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId);

  if (!teams || teams.length !== order.length) {
    return NextResponse.json({ error: 'Draft order does not match team count' }, { status: 400 });
  }

  // Enforce 4-team minimum capacity constraint unless demo/test league
  if (teams.length < 4) {
    const isDemoOrTest = league.name?.toLowerCase().includes('demo') || league.name?.toLowerCase().includes('test');
    if (!isDemoOrTest) {
      return NextResponse.json(
        { error: `Leagues require at least 4 registered managers to start drafting. Currently only ${teams.length} teams have joined.` },
        { status: 400 }
      );
    }
  }

  // Update each team's draft_order
  for (const { teamId, draftOrder } of order) {
    const { error } = await admin
      .from('teams')
      .update({ draft_order: draftOrder })
      .eq('id', teamId)
      .eq('league_id', leagueId);

    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Set league status to 'drafting'
  const { error: leagueErr } = await admin
    .from('leagues')
    .update({ status: 'drafting' })
    .eq('id', leagueId);

  if (leagueErr) return NextResponse.json({ error: leagueErr.message }, { status: 500 });

  // ── SEND NOTIFICATION ──
  try {
    const { data: allTeams } = await admin
      .from('teams')
      .select('user_id')
      .eq('league_id', leagueId);
      
      if (allTeams && allTeams.length > 0) {
        const userIds = allTeams.map(t => t.user_id);
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
        await sendEmailToUsers(admin, {
          userIds,
          kind: 'club',
          subject: 'Gaffa Draft: THE DRAFT HAS BEGUN!',
          html: getDraftStartedEmail(league.name ?? 'Your League', `${baseUrl}/league/${leagueId}/draft`),
        });

        // Create in-game notifications
        const { createNotification } = await import('@/lib/notifications/createNotification');
        for (const t of allTeams) {
          await createNotification(admin, {
            kind: 'club',
            leagueId,
            userId: t.user_id,
            title: 'Draft Started',
            content: `The commissioner has officially started the draft for **${league.name}**! The Draft Room is now open.`,
            url: `/league/${leagueId}/draft`
          });
        }
      }
    } catch (err) {
      console.error('[draft/start] Failed to send draft started notifications:', err);
    }

  return NextResponse.json({ ok: true });
}
