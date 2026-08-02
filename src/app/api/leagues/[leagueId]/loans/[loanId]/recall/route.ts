import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

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

  // 3. Fetch loan details
  const { data: loan, error: fetchError } = await admin
    .from('player_loans')
    .select('*')
    .eq('id', loanId)
    .eq('league_id', leagueId)
    .single();

  if (fetchError || !loan) {
    return NextResponse.json({ error: 'Loan not found' }, { status: 404 });
  }

  // 4. Verify permission: caller must be the lender
  if (loan.lender_team_id !== myTeam.id) {
    return NextResponse.json({ error: 'Only the lender can recall a loan' }, { status: 403 });
  }

  if (loan.status !== 'active') {
    return NextResponse.json({ error: 'Only active loans can be recalled' }, { status: 400 });
  }

  if (!loan.has_recall) {
    return NextResponse.json({ error: 'This loan does not have a recall clause' }, { status: 400 });
  }

  // 5. Fetch league settings to check roster_size
  const { data: league } = await admin
    .from('leagues')
    .select('roster_size, loan_slot_buyback_fee')
    .eq('id', leagueId)
    .single();

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  const rosterSize = league.roster_size ?? 20;

  // 6. Fetch player details
  const { data: player } = await admin
    .from('players')
    .select('id, name, pl_team_id')
    .eq('id', loan.player_id)
    .single();

  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  // 7. Lock check: cannot recall during an active gameweek (recheck if any matches have kicked off for the current GW)
  let isPlayerLocked = false;
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { next: { revalidate: 60 } });
    if (fplRes.ok) {
      const fplData = await fplRes.json();
      const now = new Date();
      let currentGw = 0;
      let isCurrentGwFinished = false;
      for (const ev of fplData.events as any[]) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
          if (ev.id > currentGw) {
            currentGw = ev.id;
            isCurrentGwFinished = !!ev.finished;
          }
        }
      }

      if (currentGw && !isCurrentGwFinished) {
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
    console.error('[loans/recall] Failed to perform kickoff lock check:', err);
  }

  if (isPlayerLocked) {
    return NextResponse.json({ error: 'Cannot recall player during an active gameweek after their match has kicked off.' }, { status: 403 });
  }

  // 8. Execute the recall atomically via database RPC
  const { data: rpcRes, error: rpcError } = await admin.rpc('execute_loan_recall_rpc', {
    p_loan_id: loanId,
    p_league_id: leagueId,
    p_roster_size: rosterSize
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const resData = rpcRes as {
    success: boolean;
    error?: string;
    pending_activation?: boolean;
    penalty?: number;
    bonus_paid?: number;
    bonus_forgiven?: number;
  };

  if (!resData.success) {
    return NextResponse.json({ error: resData.error || 'Failed to recall loan' }, { status: 400 });
  }

  // 9. Send notifications
  try {
    const { data: borrowerTeam } = await admin
      .from('teams')
      .select('team_name, user_id')
      .eq('id', loan.borrower_team_id)
      .single();

    if (borrowerTeam) {
      const { createNotification } = await import('@/lib/notifications/createNotification');
      
      // Notify borrower
      await createNotification(admin, {
        leagueId,
        userId: borrowerTeam.user_id,
        title: 'Loan Recalled Early',
        content: `**${myTeam.team_name}** has recalled **${player.name}** early. You received €${resData.penalty}m recall penalty.${resData.bonus_paid && resData.bonus_paid > 0 ? ` Paid €${resData.bonus_paid}m performance bonus.` : ''}`,
        url: `/league/${leagueId}/transfers/deals`
      });

      // Send league lobby announcement
      await admin.from('chat_messages').insert({
        league_id: leagueId,
        is_system: true,
        message: `[SYSTEM:ANNOUNCEMENT] Recall activated — **${myTeam.team_name}** has recalled **${player.name}** early from **${borrowerTeam.team_name}**. Lender pays €${resData.penalty}m penalty to borrower.`,
      });

      // Notify lender about pending activation if applicable
      if (resData.pending_activation) {
        await createNotification(admin, {
          leagueId,
          userId: user.id,
          title: 'Roster Over Capacity!',
          content: `**${player.name}** has returned from loan but your roster is full. Please drop a player to activate them.`,
          url: `/league/${leagueId}/team`
        });
      }
    }
  } catch (err) {
    console.error('Failed to send recall notifications:', err);
  }

  return NextResponse.json({ 
    ok: true, 
    pendingActivation: resData.pending_activation, 
    penalty: resData.penalty,
    bonusPaid: resData.bonus_paid,
    bonusForgiven: resData.bonus_forgiven
  });
}
