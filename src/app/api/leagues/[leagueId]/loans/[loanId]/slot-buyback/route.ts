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
    .select('id, team_name')
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
    return NextResponse.json({ error: 'Only the lender can activate slot buyback' }, { status: 403 });
  }

  if (loan.status !== 'active') {
    return NextResponse.json({ error: 'Slot buyback can only be activated for active loans' }, { status: 400 });
  }

  if (loan.slot_buyback_used) {
    return NextResponse.json({ error: 'Slot buyback has already been used for this loan' }, { status: 400 });
  }

  // 5. Execute the slot buyback atomically via database RPC
  const { data: rpcRes, error: rpcError } = await admin.rpc('execute_loan_slot_buyback_rpc', {
    p_loan_id: loanId,
    p_league_id: leagueId
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const resData = rpcRes as {
    success: boolean;
    error?: string;
    fee_paid?: number;
    solidarity_per_club?: number;
    solidarity_recipients?: { team_id: string; team_name: string; user_id: string }[];
  };
  if (!resData.success) {
    return NextResponse.json({ error: resData.error || 'Failed to activate slot buyback' }, { status: 400 });
  }

  // 6. Notification/Chat
  try {
    const { data: player } = await admin
      .from('players')
      .select('name')
      .eq('id', loan.player_id)
      .single();

    if (player) {
      const { createNotification } = await import('@/lib/notifications/createNotification');
      await createNotification(admin, {
        leagueId,
        userId: user.id,
        title: 'Slot Buyback',
        content: `You have successfully bought back a roster slot for €${resData.fee_paid}m. You can now sign an additional player while the loan of ${player.name} is active.`,
        url: `/league/${leagueId}/team`
      });

      await admin.from('chat_messages').insert({
        league_id: leagueId,
        is_system: true,
        message: `[SYSTEM:ANNOUNCEMENT] Slot buyback — **${myTeam.team_name}** paid €${resData.fee_paid}m to buy back and unlock a signing slot while **${player.name}** is out on loan.`,
      });

      // 20% of the buyback fee recirculates (094) — notify who actually got paid.
      const solidarityRecipients = resData.solidarity_recipients ?? [];
      if (solidarityRecipients.length > 0 && resData.solidarity_per_club) {
        const amount = resData.solidarity_per_club;
        await Promise.all(
          solidarityRecipients.map((recipient) =>
            recipient.user_id
              ? createNotification(admin, {
                  leagueId,
                  userId: recipient.user_id,
                  title: 'Solidarity Paid',
                  content: `You received **€${amount}m** in solidarity from **${myTeam.team_name}**'s loan slot buyback fee.`,
                  url: `/league/${leagueId}/finance`,
                })
              : Promise.resolve(),
          ),
        );
      }
    }
  } catch (err) {
    console.error('Failed to notify slot buyback:', err);
  }

  return NextResponse.json({ ok: true, feePaid: resData.fee_paid });
}
