import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/client';
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

        // Fetch commissioner information
        const { data: commUser } = await admin
          .from('users')
          .select('email, username')
          .eq('id', league.commissioner_id)
          .single();

        if (commUser && commUser.email) {
          // Send notification email to commissioner
          await sendEmail({
            to: [commUser.email],
            subject: `Draft Postponed: ${league.name}`,
            html: `
              <p>Dear Commissioner,</p>
              <p>The scheduled draft kickoff for your Gaffa league <strong>${league.name}</strong> was aborted because the league does not meet the minimum requirements to start.</p>
              <p><strong>Gaffa leagues require at least 4 registered managers to start drafting.</strong> Currently, only ${teams.length} manager(s) have joined your league.</p>
              <p>The draft schedule has been cleared. Once you have at least 4 managers, you can schedule a new draft kickoff time in the League lobby.</p>
              <p>Best of luck,</p>
              <p>Gaffa Administration</p>
            `
          });
        }

        // Add in-game notification for commissioner
        await createNotification(admin, {
          leagueId: league.id,
          userId: league.commissioner_id,
          title: 'Draft Postponed: 4-Team Min',
          content: `Draft kickoff cancelled: only ${teams.length} of the required minimum 4 managers joined. Invite more managers to reschedule!`,
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
      const { data: users } = await admin.from('users').select('email').in('id', userIds);
      const emails = (users ?? []).map(u => u.email).filter(Boolean);

      if (emails.length > 0) {
        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
        await sendEmail({
          to: emails,
          subject: 'Gaffa Draft: THE DRAFT HAS BEGUN!',
          html: getDraftStartedEmail(league.name ?? 'Your League', `${baseUrl}/league/${league.id}/draft`)
        });
      }

      // Create in-game notifications for all members
      for (const t of teams) {
        await createNotification(admin, {
          leagueId: league.id,
          userId: t.user_id,
          title: 'Draft Started!',
          content: `The scheduled kickoff has arrived! The draft for **${league.name}** has officially started! The Draft Room is now open.`,
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
