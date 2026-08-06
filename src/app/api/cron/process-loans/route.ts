import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 60; // 1 minute max for Vercel Hobby tier

export async function GET(req: NextRequest) {
  return POST(req);
}

export async function POST(req: NextRequest) {
  // 1. Cron secret check
  const cronSecret = req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  // 2. Fetch FPL bootstrap-static to find completed gameweeks
  let currentCompletedGw = 0;
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: { 'User-Agent': 'FantasyFutbol/1.0' },
      next: { revalidate: 3600 },
    });
    if (fplRes.ok) {
      const fplData = await fplRes.json();
      for (const ev of fplData.events as any[]) {
        if (ev.finished === true) {
          currentCompletedGw = Math.max(currentCompletedGw, ev.id);
        }
      }
    }
  } catch (err) {
    console.error('[process-loans] Failed to fetch FPL completed GW:', err);
    return NextResponse.json({ error: 'Failed to fetch gameweek from FPL' }, { status: 500 });
  }

  if (currentCompletedGw === 0) {
    return NextResponse.json({ ok: true, message: 'No completed gameweek found yet, skipping loan processing.' });
  }

  // 3. Fetch all active loans that have expired
  const { data: expiredLoans, error: fetchError } = await admin
    .from('player_loans')
    .select(`
      *,
      player:players(id, name),
      lender_team:teams!lender_team_id(id, team_name, user_id),
      borrower_team:teams!borrower_team_id(id, team_name, user_id)
    `)
    .eq('status', 'active')
    .lte('end_gameweek', currentCompletedGw);

  if (fetchError) {
    console.error('[process-loans] Failed to fetch expired loans:', fetchError);
    return NextResponse.json({ error: fetchError.message }, { status: 500 });
  }

  if (!expiredLoans || expiredLoans.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  let processedCount = 0;

  // 4. Settle each loan using the RPC
  for (const loan of expiredLoans) {
    try {
      // Get roster size for capacity check
      const { data: league } = await admin
        .from('leagues')
        .select('roster_size')
        .eq('id', loan.league_id)
        .single();
      
      const rosterSize = league?.roster_size ?? 20;

      const { data: rpcRes, error: rpcError } = await admin.rpc('resolve_expired_loan_rpc', {
        p_loan_id: loan.id,
        p_league_id: loan.league_id,
        p_roster_size: rosterSize
      });

      if (rpcError) {
        console.error(`[process-loans] RPC error for loan ${loan.id}:`, rpcError);
        continue;
      }

      const resData = rpcRes as {
        success: boolean;
        error?: string;
        pending_activation?: boolean;
        bonus_paid?: number;
        bonus_forgiven?: number;
      };

      if (!resData.success) {
        console.error(`[process-loans] Failed to resolve loan ${loan.id}:`, resData.error);
        continue;
      }

      processedCount++;

      // 5. Send notifications
      const player_name = (loan.player as any)?.name || 'Unknown Player';
      const lender_team_name = (loan.lender_team as any)?.team_name || 'Lender Club';
      const borrower_team_name = (loan.borrower_team as any)?.team_name || 'Borrower Club';
      const lender_user_id = (loan.lender_team as any)?.user_id;
      const borrower_user_id = (loan.borrower_team as any)?.user_id;

      const { createNotification } = await import('@/lib/notifications/createNotification');

      // Notify borrower
      if (borrower_user_id) {
        await createNotification(admin, {
          leagueId: loan.league_id,
          userId: borrower_user_id,
          title: 'Loan Concluded',
          content: `Your loan of **${player_name}** has expired and the player returned to **${lender_team_name}**.${resData.bonus_paid && resData.bonus_paid > 0 ? ` Paid €${resData.bonus_paid}m performance bonus.` : ''}`,
          url: `/league/${loan.league_id}/transfers/deals`
        });
      }

      // Notify lender
      if (lender_user_id) {
        if (resData.pending_activation) {
          await createNotification(admin, {
            leagueId: loan.league_id,
            userId: lender_user_id,
            title: 'Roster Over Capacity!',
            content: `**${player_name}** has returned from loan but your roster is full. Drop a player to activate them.`,
            url: `/league/${loan.league_id}/team`
          });
        } else {
          await createNotification(admin, {
            leagueId: loan.league_id,
            userId: lender_user_id,
            title: 'Loan Concluded',
            content: `**${player_name}** has returned to your bench from loan at **${borrower_team_name}**.${resData.bonus_paid && resData.bonus_paid > 0 ? ` Received €${resData.bonus_paid}m performance bonus.` : ''}`,
            url: `/league/${loan.league_id}/team`
          });
        }
      }

      // Send league lobby announcement
      await admin.from('chat_messages').insert({
        league_id: loan.league_id,
        is_system: true,
        message: `[SYSTEM:ANNOUNCEMENT] Loan concluded — **${player_name}** returns to **${lender_team_name}** after completing their loan term at **${borrower_team_name}**.`,
      });

    } catch (err) {
      console.error(`[process-loans] Error processing loan ${loan.id}:`, err);
    }
  }

  return NextResponse.json({ ok: true, processed: processedCount });
}
