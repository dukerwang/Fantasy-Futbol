import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmailToUsers } from '@/lib/email/sendEmailToUsers';
import { getDraftStartedEmail } from '@/lib/email/templates';

export const maxDuration = 60; // 1 minute execution limit

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  const cronSecret = req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // Find all leagues in setup phase whose scheduled draft time has arrived
  const { data: eligibleLeagues, error: fetchError } = await admin
    .from('leagues')
    .select('*')
    .eq('status', 'setup')
    .lte('draft_scheduled_at', new Date().toISOString())
    .not('draft_scheduled_at', 'is', null);

  if (fetchError) {
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!eligibleLeagues || eligibleLeagues.length === 0) {
    return NextResponse.json({ ok: true, startedLeaguesCount: 0 });
  }

  let startedLeaguesCount = 0;
  const { createNotification } = await import('@/lib/notifications/createNotification');

  for (const league of eligibleLeagues) {
    try {
      // Fetch all teams registered in this league
      const { data: teams, error: teamsError } = await admin
        .from('teams')
        .select('*')
        .eq('league_id', league.id);

      if (teamsError || !teams) {
        console.error(`[start-scheduled-drafts] Error fetching teams for league ${league.id}:`, teamsError);
        continue;
      }

      // ── MINIMUM CAPACITY CHECK (4 Teams Required) ──
      if (teams.length < 4) {
        console.warn(`[start-scheduled-drafts] Aborting draft start for league ${league.id}: only ${teams.length} teams (minimum 4 required).`);

        // Clear schedule in database
        await admin
          .from('leagues')
          .update({ draft_scheduled_at: null })
          .eq('id', league.id);

        await sendEmailToUsers(admin, {
          userIds: [league.commissioner_id],
          kind: 'club',
          subject: 'Draft Postponed',
          html: `
              <p>The scheduled draft kickoff for <strong>${league.name}</strong> was aborted because the league doesn't meet the minimum requirements to start.</p>
              <p><strong>Gaffa leagues require at least 4 registered managers to start drafting.</strong> Only ${teams.length} manager(s) have joined so far.</p>
              <p>The draft schedule has been cleared. Once you have at least 4 managers, schedule a new draft kickoff time in the League lobby.</p>
            `,
          leagueId: league.id,
        });

        // Add in-game notification for commissioner
        await createNotification(admin, {
          kind: 'club',
          leagueId: league.id,
          userId: league.commissioner_id,
          title: 'Draft Delayed',
          content: `Draft kickoff cancelled: only ${teams.length} of the minimum 4 managers joined. Invite more managers, then reschedule.`,
          url: `/league/${league.id}`
        });

        continue;
      }

      // ── CAPACITY RESIZING ──
      // If the joined teams count is less than the current max_teams, shrink max_teams
      if (teams.length < league.max_teams) {
        console.log(`[start-scheduled-drafts] Resizing league ${league.id} max_teams from ${league.max_teams} to ${teams.length}`);
        await admin
          .from('leagues')
          .update({ max_teams: teams.length })
          .eq('id', league.id);
      }

      // ── DRAFT ORDER CONFIGURATION ──
      // Check if any team has an unconfigured draft order or if there are duplicates
      const hasAllOrders = teams.every(t => t.draft_order !== null);
      const orders = teams.map(t => t.draft_order).filter(Boolean);
      const hasDuplicates = new Set(orders).size !== orders.length;

      if (!hasAllOrders || hasDuplicates) {
        console.log(`[start-scheduled-drafts] Randomizing draft order for league ${league.id}`);
        const shuffledTeams = [...teams];
        for (let i = shuffledTeams.length - 1; i > 0; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [shuffledTeams[i], shuffledTeams[j]] = [shuffledTeams[j], shuffledTeams[i]];
        }

        // Persist draft order
        for (let i = 0; i < shuffledTeams.length; i++) {
          await admin
            .from('teams')
            .update({ draft_order: i + 1 })
            .eq('id', shuffledTeams[i].id);
        }
      }

      // ── START THE DRAFT ──
      // Set status to 'drafting' and clear the scheduled field
      const { error: startError } = await admin
        .from('leagues')
        .update({
          status: 'drafting',
          draft_scheduled_at: null
        })
        .eq('id', league.id);

      if (startError) {
        console.error(`[start-scheduled-drafts] Failed to set status to 'drafting' for league ${league.id}:`, startError);
        continue;
      }

      // ── SEND START NOTIFICATIONS ──
      const userIds = teams.map(t => t.user_id);
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
      await sendEmailToUsers(admin, {
        userIds,
        kind: 'club',
        subject: 'Gaffa Draft: THE DRAFT HAS BEGUN!',
        html: getDraftStartedEmail(league.name ?? 'Your League', `${baseUrl}/league/${league.id}/draft`),
        leagueId: league.id,
      });

      // Create in-game notifications for all members
      for (const t of teams) {
        await createNotification(admin, {
          kind: 'club',
          leagueId: league.id,
          userId: t.user_id,
          title: 'Draft Started',
          content: `The draft for **${league.name}** has started. The Draft Room is open.`,
          url: `/league/${league.id}/draft`
        });
      }

      startedLeaguesCount++;
    } catch (err) {
      console.error(`[start-scheduled-drafts] Error starting draft for league ${league.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, startedLeaguesCount });
}
