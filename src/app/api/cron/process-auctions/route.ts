/**
 * POST /api/cron/process-auctions
 *
 * Resolves all expired FAAB auctions. Call this via an external cron every 5–10 minutes.
 * Protect with: x-cron-secret header matching CRON_SECRET env var.
 *
 * Logic per expired (league_id, player_id) auction group:
 *   1. Separate system placeholder claims from real manager bids.
 *   2. Waterfall through real bids (highest first) until a manager who can afford
 *      their bid + drop-player severance fee (10% of drop player market value) is found.
 *   3. Process the winner: drop nominated player (charging severance), add won player,
 *      deduct total FAAB cost, log transactions.
 *   4. Award Scout's Rebate (20%, capped €5m) to the auction initiator if a different
 *      team won.
 *   5. Approve winning claim, reject all others.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/client';
import { getAuctionWonEmail } from '@/lib/email/templates';
export const maxDuration = 60; // 1 minute max for Vercel Hobby tier


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

  // Find all expired pending auction claims
  const { data: expiredClaims, error: fetchError } = await admin
    .from('waiver_claims')
    .select(`
      *,
      player:players!player_id(id, name),
      team:teams(id, team_name, faab_budget, user_id)
    `)
    .eq('status', 'pending')
    .eq('is_auction', true)
    .lt('expires_at', new Date().toISOString())
    .order('faab_bid', { ascending: false }); // highest bid first within each group

  if (fetchError) return NextResponse.json({ error: fetchError.message }, { status: 500 });
  if (!expiredClaims || expiredClaims.length === 0) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  // Group by (league_id, player_id)
  // Sort within each group by faab_bid DESC so winner is first element.
  type Claim = (typeof expiredClaims)[number];
  const groups = new Map<string, Claim[]>();
  for (const claim of expiredClaims) {
    const key = `${claim.league_id}::${claim.player_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(claim);
  }

  // Fetch current FPL gameweek fixtures for lock checks
  const lockedPlTeamIds = new Set<number>();
  let currentFplGw = 0;
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
    if (fplRes.ok) {
      const fplData = await fplRes.json();
      const events = fplData.events as { deadline_time: string | null; id: number; finished: boolean }[];
      const now = new Date();
      let isCurrentGwFinished = false;
      // Derive current GW: highest GW whose deadline has passed
      for (const ev of events) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
          if (ev.id > currentFplGw) {
            currentFplGw = ev.id;
            isCurrentGwFinished = ev.finished;
          } else if (ev.id === currentFplGw) {
            isCurrentGwFinished = ev.finished;
          }
        }
      }
      if (currentFplGw && !isCurrentGwFinished) {
        const fixRes = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${currentFplGw}`);
        if (fixRes.ok) {
          const fixtures = await fixRes.json();
          for (const f of fixtures) {
            if (f.kickoff_time && new Date(f.kickoff_time) <= now) {
              lockedPlTeamIds.add(f.team_h);
              lockedPlTeamIds.add(f.team_a);
            }
          }
        }
      }
    }
  } catch { /* Fail open */ }

  let processed = 0;

  for (const [, claims] of groups) {
    const { league_id, player_id } = claims[0];

    try {
      const { data: wonPlayer } = await admin
        .from('players')
        .select('id, name')
        .eq('id', player_id)
        .single();

      const realClaims = claims.filter((c) => c.team_id !== null);

      // Call the database RPC to resolve this auction atomically
      const { data: rpcRes, error: rpcError } = await admin.rpc('resolve_single_player_auction_rpc', {
        p_league_id: league_id,
        p_player_id: player_id,
        p_locked_pl_team_ids: Array.from(lockedPlTeamIds),
      });

      if (rpcError) {
        console.error('[process-auctions] RPC error resolving auction:', rpcError);
        continue;
      }

      const resData = rpcRes as {
        success: boolean;
        won: boolean;
        deferred?: boolean;
        error?: string;
        winner_claim_id?: string;
        winner_team_id?: string;
        winner_team_name?: string;
        winner_user_id?: string;
        winner_bid?: number;
        winner_severance?: number;
        winner_status?: string;
        drop_player_name?: string;
        initiator_team_name?: string;
        rebate_amount?: number;
        rebate_team_id?: string;
        losing_teams?: { team_id: string; team_name: string; user_id: string; faab_bid: number }[];
      };

      if (!resData.success) {
        console.error('[process-auctions] RPC failed to resolve:', resData.error);
        continue;
      }

      if (resData.deferred) {
        console.log(`[process-auctions] Deferring auction for player ${player_id} — locked players involved.`);
        processed++;
        continue;
      }

      if (resData.won && resData.winner_team_id) {
        // --- SEND NOTIFICATION ---
        try {
          const { data: leagueTeams } = await admin
            .from('teams')
            .select('id, team_name, user_id')
            .eq('league_id', league_id);

          const winnerTeamName = resData.winner_team_name;
          const winnerUserId = resData.winner_user_id;
          const dropPlayerName = resData.drop_player_name;
          const initiatorTeamName = resData.initiator_team_name;
          const winnerBid = resData.winner_bid!;
          
          const userIds = (leagueTeams ?? []).map(t => t.user_id);
          const { data: users } = await admin.from('users').select('email').in('id', userIds);
          const leagueEmails = (users ?? []).map(u => u.email).filter(Boolean);

          if (leagueEmails.length > 0) {
            const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
            await sendEmail({
              to: leagueEmails,
              subject: `Auction Won: ${wonPlayer?.name ?? 'Player'} signed by ${winnerTeamName ?? 'Club'}`,
              html: getAuctionWonEmail(
                wonPlayer?.name ?? 'Unknown Player',
                winnerTeamName ?? 'Unknown Club',
                winnerBid,
                realClaims.length,
                dropPlayerName || null,
                initiatorTeamName || null,
                `${baseUrl}/league/${league_id}`
              )
            });
          }

          // Create in-game notifications
          const { createNotification } = await import('@/lib/notifications/createNotification');
          
          // 1. Notify the winner
          if (winnerUserId) {
            await createNotification(admin, {
              leagueId: league_id,
              userId: winnerUserId,
              title: 'Auction Won!',
              content: `You secured **${wonPlayer?.name ?? 'Player'}** for **€${winnerBid}m** in a ${realClaims.length}-bidder auction.${resData.winner_severance ? ` **${dropPlayerName}** was dropped to waivers to clear roster space.` : ''}`,
              url: `/league/${league_id}/team`
            });
          }

          // 2. Notify the losing bidders
          const losingBidders = resData.losing_teams ?? [];
          await Promise.all(losingBidders.map(async (loser) => {
            if (loser.user_id) {
              await createNotification(admin, {
                leagueId: league_id,
                userId: loser.user_id,
                title: 'Waiver Auction Lost',
                content: `Your waiver bid of **€${loser.faab_bid}m** for **${wonPlayer?.name ?? 'Player'}** was unsuccessful. **${winnerTeamName ?? 'Another team'}** won the signature for **€${winnerBid}m**.`,
                url: `/league/${league_id}/players`
              });
            }
          }));
        } catch (emailErr) {
          console.error('[process-auctions] Failed to send auction result notifications:', emailErr);
        }
      }

      processed++;
    } catch (err) {
      console.error('[process-auctions] Error processing auction group:', err);
    }
  }

  return NextResponse.json({ ok: true, processed });
}
