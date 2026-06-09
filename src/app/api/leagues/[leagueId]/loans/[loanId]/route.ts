import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/client';
import { getLoanAcceptedEmail } from '@/lib/email/templates';

interface Props {
  params: Promise<{ leagueId: string; loanId: string }>;
}

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId, loanId } = await params;

  // 1. Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // 2. Caller must have a team in this league
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, team_name, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  // 3. Fetch loan and verify it is pending
  const { data: loan, error: fetchError } = await admin
    .from('player_loans')
    .select('*')
    .eq('id', loanId)
    .eq('league_id', leagueId)
    .single();

  if (fetchError || !loan) {
    return NextResponse.json({ error: 'Loan proposal not found' }, { status: 404 });
  }

  if (loan.status !== 'pending') {
    return NextResponse.json({ error: 'Loan proposal is no longer pending' }, { status: 400 });
  }

  // 4. Parse action
  const body = await req.json();
  const { action } = body as { action: 'accept' | 'reject' | 'cancel' };

  if (!['accept', 'reject', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  }

  // 5. Auth check for action
  if (action === 'cancel' && loan.lender_team_id !== myTeam.id) {
    return NextResponse.json({ error: 'Only the lender can cancel a loan proposal' }, { status: 403 });
  }
  if (action === 'reject' && loan.borrower_team_id !== myTeam.id) {
    return NextResponse.json({ error: 'Only the borrower can reject a loan proposal' }, { status: 403 });
  }
  if (action === 'accept' && loan.borrower_team_id !== myTeam.id) {
    return NextResponse.json({ error: 'Only the borrower can accept a loan proposal' }, { status: 403 });
  }

  // Fetch teams and player details for emails/messages
  const { data: lenderTeam } = await admin
    .from('teams')
    .select('id, team_name, user_id, faab_budget')
    .eq('id', loan.lender_team_id)
    .single();

  const { data: borrowerTeam } = await admin
    .from('teams')
    .select('id, team_name, user_id, faab_budget')
    .eq('id', loan.borrower_team_id)
    .single();

  const { data: player } = await admin
    .from('players')
    .select('id, name, pl_team_id')
    .eq('id', loan.player_id)
    .single();

  if (!lenderTeam || !borrowerTeam || !player) {
    return NextResponse.json({ error: 'Lender, borrower, or player not found' }, { status: 500 });
  }

  // --- REJECT ACTION ---
  if (action === 'reject') {
    await admin.from('player_loans').update({ status: 'rejected' }).eq('id', loanId);

    // Send notification to lender
    try {
      const { data: lenderUser } = await admin.from('users').select('email').eq('id', lenderTeam.user_id).single();
      if (lenderUser?.email) {
        await sendEmail({
          to: lenderUser.email,
          subject: `Loan Proposal Rejected`,
          html: `<p><strong>${borrowerTeam.team_name}</strong> has rejected your proposal to loan <strong>${player.name}</strong>.</p>`
        });
      }

      const { createNotification } = await import('@/lib/notifications/createNotification');
      await createNotification(admin, {
        leagueId,
        userId: lenderTeam.user_id,
        title: 'Loan Proposal Rejected',
        content: `**${borrowerTeam.team_name}** has rejected your proposal to loan **${player.name}**.`,
        url: `/league/${leagueId}/trades`
      });
    } catch (err) {
      console.error('Failed to notify rejection:', err);
    }

    return NextResponse.json({ ok: true });
  }

  // --- CANCEL ACTION ---
  if (action === 'cancel') {
    await admin.from('player_loans').update({ status: 'cancelled' }).eq('id', loanId);
    return NextResponse.json({ ok: true });
  }

  // --- ACCEPT ACTION ---
  if (action === 'accept') {
    // A. Re-validate terms and locks
    const { data: league } = await admin
      .from('leagues')
      .select('roster_locked, total_gameweeks, max_loan_outs, max_loan_ins')
      .eq('id', leagueId)
      .single();

    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });
    if (league.roster_locked) {
      return NextResponse.json({ error: 'Rosters are locked. Loan acceptance is not permitted.' }, { status: 403 });
    }

    // Proposer (lender) active loan-outs check
    const { count: lenderActiveLoans } = await admin
      .from('player_loans')
      .select('id', { count: 'exact', head: true })
      .eq('lender_team_id', loan.lender_team_id)
      .eq('status', 'active');

    const maxOuts = league.max_loan_outs ?? 1;
    if ((lenderActiveLoans ?? 0) >= maxOuts) {
      return NextResponse.json({ error: `Lender has reached the maximum number of active loan-outs (${maxOuts})` }, { status: 400 });
    }

    // Borrower active loan-ins check
    const { count: borrowerActiveLoans } = await admin
      .from('player_loans')
      .select('id', { count: 'exact', head: true })
      .eq('borrower_team_id', loan.borrower_team_id)
      .eq('status', 'active');

    const maxIns = league.max_loan_ins ?? 2;
    if ((borrowerActiveLoans ?? 0) >= maxIns) {
      return NextResponse.json({ error: `You have reached the maximum number of active loan-ins (${maxIns})` }, { status: 400 });
    }

    // Player ownership check
    const { data: rosterEntry } = await admin
      .from('roster_entries')
      .select('id, status')
      .eq('team_id', loan.lender_team_id)
      .eq('player_id', loan.player_id)
      .maybeSingle();

    if (!rosterEntry) {
      return NextResponse.json({ error: 'Player is no longer on the lender\'s roster' }, { status: 400 });
    }

    if (['ir', 'taxi', 'loan_in', 'loan_out'].includes(rosterEntry.status)) {
      return NextResponse.json({ error: `Player is currently in status '${rosterEntry.status}' and cannot be loaned` }, { status: 400 });
    }

    // FAAB budget check
    if (borrowerTeam.faab_budget < loan.loan_fee) {
      return NextResponse.json({ error: `Insufficient Club Balance. You need €${loan.loan_fee}m, but only have €${borrowerTeam.faab_budget}m.` }, { status: 400 });
    }

    // B. Lock Check: defer if player's match has kicked off
    let isPlayerLocked = false;
    try {
      const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { next: { revalidate: 60 } });
      if (fplRes.ok) {
        const fplData = await fplRes.json();
        const now = new Date();
        let currentGw = 0;
        for (const ev of fplData.events as any[]) {
          if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
            currentGw = Math.max(currentGw, ev.id);
          }
        }

        if (currentGw) {
          const fixRes = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${currentGw}`, { next: { revalidate: 60 } });
          if (fixRes.ok) {
            const fixtures = await fixRes.json();
            const lockedPlTeamIds = new Set<number>();
            for (const f of fixtures) {
              if (f.kickoff_time && new Date(f.kickoff_time) <= now) {
                lockedPlTeamIds.add(f.team_h);
                lockedPlTeamIds.add(f.team_a);
              }
            }

            if (lockedPlTeamIds.size > 0 && player.pl_team_id && lockedPlTeamIds.has(player.pl_team_id)) {
              isPlayerLocked = true;
            }
          }
        }
      }
    } catch (err) {
      console.error('[loans/accept] Failed to perform kickoff lock check:', err);
    }

    if (isPlayerLocked) {
      // Mark as accepted_deferred
      await admin.from('player_loans').update({ status: 'accepted_deferred' }).eq('id', loanId);

      // Cancel any pending listings
      await admin
        .from('player_sale_listings')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('league_id', leagueId)
        .eq('player_id', loan.player_id)
        .eq('status', 'pending');

      // Send deferred notification
      try {
        const { createNotification } = await import('@/lib/notifications/createNotification');
        await createNotification(admin, {
          leagueId,
          userId: lenderTeam.user_id,
          title: 'Loan Agreed (Pending GW End)',
          content: `Loan of **${player.name}** has been agreed but deferred until the current gameweek completes because the player is locked.`,
          url: `/league/${leagueId}/trades`
        });
      } catch (err) {
        console.error('Failed to notify deferred loan acceptance:', err);
      }

      return NextResponse.json({ ok: true, deferred: true, message: 'Loan accepted but deferred until gameweek ends — player is locked.' });
    }

    // C. Execute loan transaction atomically
    const { data: rpcRes, error: rpcError } = await admin.rpc('execute_loan_acceptance_rpc', {
      p_loan_id: loanId,
      p_lender_team_id: loan.lender_team_id,
      p_borrower_team_id: loan.borrower_team_id,
      p_player_id: loan.player_id,
      p_loan_fee: loan.loan_fee,
      p_league_id: leagueId
    });

    if (rpcError) {
      return NextResponse.json({ error: rpcError.message }, { status: 500 });
    }

    const resData = rpcRes as { success: boolean; error?: string };
    if (!resData.success) {
      return NextResponse.json({ error: resData.error || 'Failed to accept loan' }, { status: 400 });
    }

    // D. Cancel any pending player_sale_listings for this player
    await admin
      .from('player_sale_listings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('league_id', leagueId)
      .eq('player_id', loan.player_id)
      .eq('status', 'pending');

    // E. Send email notifications & chats
    try {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
      const leagueUrl = `${baseUrl}/league/${leagueId}`;

      const { data: allTeams } = await admin.from('teams').select('user_id').eq('league_id', leagueId);
      if (allTeams && allTeams.length > 0) {
        const userIds = allTeams.map(t => t.user_id);
        const { data: users } = await admin.from('users').select('email').in('id', userIds);
        const emails = (users ?? []).map(u => u.email).filter(Boolean);

        if (emails.length > 0) {
          await sendEmail({
            to: emails,
            subject: `Player Loan Agreement Finalized`,
            html: getLoanAcceptedEmail(lenderTeam.team_name, borrowerTeam.team_name, player.name, loan.start_gameweek, loan.end_gameweek, leagueUrl)
          });
        }
      }

      // Create in-game notification for lender
      const { createNotification } = await import('@/lib/notifications/createNotification');
      await createNotification(admin, {
        leagueId,
        userId: lenderTeam.user_id,
        title: 'Loan Proposal Accepted!',
        content: `**${borrowerTeam.team_name}** has accepted your proposal to loan **${player.name}** for GW${loan.start_gameweek}-GW${loan.end_gameweek}.`,
        url: `/league/${leagueId}/trades`
      });

      // Send a public chat message to the league lobby
      await admin.from('chat_messages').insert({
        league_id: leagueId,
        message: `📢 [SYSTEM:ANNOUNCEMENT] Deal signed! **${player.name}** joins **${borrowerTeam.team_name}** on loan from **${lenderTeam.team_name}** (from GW${loan.start_gameweek} to GW${loan.end_gameweek}).`,
      });

    } catch (err) {
      console.error('Failed to send loan acceptance notifications:', err);
    }

    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unhandleable action' }, { status: 400 });
}
