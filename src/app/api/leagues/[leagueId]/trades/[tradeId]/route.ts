import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/client';
import { getTradeAcceptedEmail } from '@/lib/email/templates';
import { buildHereWeGo, formatAssetList, pushTitleForEyebrow } from '@/lib/notifications/hereWeGo';
import { getValueTier } from '@/lib/notifications/valueTiers';

interface Props {
  params: Promise<{ leagueId: string; tradeId: string }>;
}

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId, tradeId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await req.json();
  const { action } = body as { action: 'accept' | 'reject' | 'cancel' };

  if (!['accept', 'reject', 'cancel'].includes(action)) {
    return NextResponse.json({ error: 'action must be accept, reject, or cancel' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch the trade proposal with full player details
  const { data: trade } = await admin
    .from('trade_proposals')
    .select(`
      *,
      team_a:teams!trade_proposals_team_a_id_fkey(id, team_name, faab_budget, user_id),
      team_b:teams!trade_proposals_team_b_id_fkey(id, team_name, faab_budget, user_id)
    `)
    .eq('id', tradeId)
    .eq('league_id', leagueId)
    .single();

  if (!trade) return NextResponse.json({ error: 'Trade not found' }, { status: 404 });
  if (trade.status !== 'pending') {
    return NextResponse.json({ error: `Trade is already ${trade.status}` }, { status: 400 });
  }

  const teamA = trade.team_a as { id: string; team_name: string; faab_budget: number; user_id: string };
  const teamB = trade.team_b as { id: string; team_name: string; faab_budget: number; user_id: string };

  // Authorization: only team_a can cancel, only team_b can accept/reject
  if (action === 'cancel') {
    if (teamA.user_id !== user.id) {
      return NextResponse.json({ error: 'Only the trade proposer can cancel it' }, { status: 403 });
    }
    await admin.from('trade_proposals').update({ status: 'cancelled' }).eq('id', tradeId);
    // Notify team B that the pending offer was withdrawn
    try {
      const { createNotification } = await import('@/lib/notifications/createNotification');
      await createNotification(admin, {
        leagueId,
        userId: teamB.user_id,
        title: 'Trade Withdrawn',
        content: `**${teamA.team_name}** has withdrawn their trade proposal to you.`,
        url: `/league/${leagueId}/transfers/deals`
      });
    } catch (err) {
      console.error('[trade/cancel] Failed to create notification:', err);
    }
    return NextResponse.json({ ok: true });
  }

  if (teamB.user_id !== user.id) {
    return NextResponse.json({ error: 'Only the receiving team can accept or reject this trade' }, { status: 403 });
  }

  if (action === 'reject') {
    await admin.from('trade_proposals').update({ status: 'rejected' }).eq('id', tradeId);
    // Notify team A proposer that it was rejected
    try {
      const { createNotification } = await import('@/lib/notifications/createNotification');
      await createNotification(admin, {
        leagueId,
        userId: teamA.user_id,
        title: 'Trade Rejected',
        content: `Your trade proposal to **${teamB.team_name}** has been declined.`,
        url: `/league/${leagueId}/transfers/deals`
      });
    } catch (err) {
      console.error('[trade/reject] Failed to create notification:', err);
    }
    return NextResponse.json({ ok: true });
  }

  // ── ACCEPT: transactional validation + execution ──────────────────────────

  // A listing purchase is a trade_proposals row with sale_listing_id set: team_a
  // is always the buyer (the proposer), team_b the seller (must accept — see
  // the listing.seller_team_id === targetTeamId check at proposal creation).
  // Framing it as a "trade" between two clubs is misleading when one side just
  // bought a listed player for cash, so deal copy branches on this.
  const isListingSale = !!trade.sale_listing_id;
  const offeredPlayerIds: string[] = trade.offered_players || [];
  const requestedPlayerIds: string[] = trade.requested_players || [];
  const allTradePlayerIds = [...offeredPlayerIds, ...requestedPlayerIds];

  const { data: tradePlayerRows } = allTradePlayerIds.length
    ? await admin.from('players').select('id, name, market_value').in('id', allTradePlayerIds)
    : { data: [] as { id: string; name: string; market_value: number | null }[] };
  const playerById = new Map((tradePlayerRows ?? []).map((p) => [p.id, p]));
  const offeredFaab = Number(trade.offered_faab ?? 0);
  const requestedFaab = Number(trade.requested_faab ?? 0);

  // Listing sale: buyer (team_a) pays offeredFaab for the one requested player.
  const dealAmount = isListingSale ? offeredFaab : 0;
  const soldPlayerName = isListingSale ? (requestedPlayerIds.map((id) => playerById.get(id)?.name ?? 'Unknown Player')[0] ?? 'Unknown Player') : '';

  // Tier off whichever is higher: the actual transaction (FAAB paid) or any
  // moved player's real-world market value — a bargain pickup of a genuine
  // superstar, or an inflated bidding war for a nobody, should both read right.
  const tierValue = isListingSale
    ? Math.max(offeredFaab, Number(playerById.get(requestedPlayerIds[0])?.market_value ?? 0))
    : Math.max(offeredFaab, requestedFaab, ...allTradePlayerIds.map((id) => Number(playerById.get(id)?.market_value ?? 0)));
  const dealTier = getValueTier(tierValue);
  const dealTierLabel = dealTier === 'galactico' ? `Galactico ${isListingSale ? 'Arrival' : 'Trade'}`
    : dealTier === 'blockbuster' ? `Blockbuster ${isListingSale ? 'Signing' : 'Trade'}`
    : null;
  const dealSubjectBase = isListingSale ? `${soldPlayerName} to ${teamA.team_name}` : `${teamA.team_name} & ${teamB.team_name}`;
  const dealSubject = dealTierLabel ? `${dealTierLabel}: ${dealSubjectBase}` : (isListingSale ? `Signing Confirmed: ${dealSubjectBase}` : `Trade Completed: ${dealSubjectBase}`);

  // Shams-style asset lists for a genuine two-way trade — real transfer
  // journalism has no equivalent for a trade, so this borrows the
  // "Club A send X to Club B for Y" shape of a trade report instead.
  const offeredAssetsPlain = formatAssetList(offeredPlayerIds.map((id) => playerById.get(id)?.name ?? 'Unknown Player'), offeredFaab);
  const requestedAssetsPlain = formatAssetList(requestedPlayerIds.map((id) => playerById.get(id)?.name ?? 'Unknown Player'), requestedFaab);

  // Get league roster size
  const { data: league } = await admin
    .from('leagues')
    .select('roster_size')
    .eq('id', leagueId)
    .single();

  const rosterSize = league?.roster_size ?? 20;

  // ── Lock check: defer trade if any involved player's match has kicked off ──
  let anyPlayerLocked = false;
  try {
    // Derive current GW natively
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { next: { revalidate: 60 } });
    if (fplRes.ok) {
      const fplData = await fplRes.json();
      const now = new Date();
      let currentGw = 0;
      let isCurrentGwFinished = false;
      for (const ev of fplData.events as { deadline_time: string | null; id: number; finished: boolean }[]) {
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

          if (lockedPlTeamIds.size > 0) {
            // Check all players involved in the trade
            const allTradePlayerIds = [...trade.offered_players, ...trade.requested_players];
            if (allTradePlayerIds.length > 0) {
              const { data: tradePlayers } = await admin
                .from('roster_entries')
                .select('player_id, status, player:players(pl_team_id, web_name)')
                .in('player_id', allTradePlayerIds);

              for (const entry of tradePlayers ?? []) {
                if (entry.status === 'active' || entry.status === 'bench') {
                  const plTeamId = (entry.player as unknown as { pl_team_id: number; web_name: string } | null)?.pl_team_id;
                  if (plTeamId && lockedPlTeamIds.has(plTeamId)) {
                    anyPlayerLocked = true;
                    break;
                  }
                }
              }
            }
          }
        }
      }
    }
  } catch { /* Fail open */ }

  if (anyPlayerLocked) {
    // Mark as accepted but deferred — will execute after GW ends
    const { data: updatedTrade, error: updateErr } = await admin
      .from('trade_proposals')
      .update({ status: 'accepted_deferred' })
      .eq('id', tradeId)
      .eq('status', 'pending')
      .select();

    if (updateErr || !updatedTrade || updatedTrade.length === 0) {
      return NextResponse.json({ error: 'Trade was already processed or is no longer pending.' }, { status: 400 });
    }

    // Cancel any pending listings for traded players
    const transferredPlayerIds = [...(trade.offered_players || []), ...(trade.requested_players || [])];
    if (transferredPlayerIds.length > 0) {
      await admin
        .from('player_sale_listings')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('league_id', leagueId)
        .in('player_id', transferredPlayerIds)
        .eq('status', 'pending');
    }

    // --- SEND EMAIL + CHAT NOTIFICATION ---
    try {
      const { data: allTeams } = await admin.from('teams').select('user_id').eq('league_id', leagueId);
      if (allTeams && allTeams.length > 0) {
        const userIds = allTeams.map(t => t.user_id);
        const { data: users } = await admin.from('users').select('email').in('id', userIds);
        const emails = (users ?? []).map(u => u.email).filter(Boolean);

        if (emails.length > 0) {
          const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
          await sendEmail({
            to: emails,
            subject: `${dealSubject} (Pending Gameweek Completion)`,
            html: getTradeAcceptedEmail({
              isListingSale,
              teamA: teamA.team_name,
              teamB: teamB.team_name,
              playerName: soldPlayerName,
              dealAmount,
              offeredAssets: offeredAssetsPlain,
              requestedAssets: requestedAssetsPlain,
              tierValue,
              pending: true,
              leagueUrl: `${baseUrl}/league/${leagueId}`,
            })
          });
        }
      }

      const detailMd = isListingSale
        ? `**${soldPlayerName}** to **${teamA.team_name}** for €${dealAmount}m`
        : `**${teamA.team_name}** send ${offeredAssetsPlain} to **${teamB.team_name}** for ${requestedAssetsPlain}`;
      const { lead } = buildHereWeGo(isListingSale ? 'signing' : 'trade', detailMd, tierValue, true);
      await admin.from('chat_messages').insert({
        league_id: leagueId,
        is_system: true,
        message: `[SYSTEM:ANNOUNCEMENT] ${lead}`,
      });
    } catch (err) {
      console.error('Failed to send trade accepted email:', err);
    }

    return NextResponse.json({ ok: true, deferred: true, message: 'Trade accepted but deferred until gameweek ends — one or more players are locked.' });
  }

  // Call the database RPC to execute this trade atomically
  const { data: rpcRes, error: rpcError } = await admin.rpc('execute_trade_transaction_rpc', {
    p_trade_id: tradeId,
    p_roster_size: rosterSize,
    p_min_roster_size: 15,
  });

  if (rpcError) {
    return NextResponse.json({ error: rpcError.message }, { status: 500 });
  }

  const resData = rpcRes as {
    success: boolean;
    error?: string;
  };

  if (!resData.success) {
    return NextResponse.json({ error: resData.error || 'Failed to execute trade' }, { status: 400 });
  }

  // Listing cleanup for traded players used to happen here. It now runs inside
  // the transaction, in trg_guard_trade_against_listings (migration 079), which
  // additionally rejects each cancelled listing's auction anchor — something
  // this block never did, leaving the cron free to later resolve an auction for
  // a player who had already changed clubs. The trigger also blocks the trade
  // outright if bidding is live on anyone in it.

  // --- SEND EMAIL NOTIFICATION ---
  try {
    const { data: allTeams } = await admin.from('teams').select('user_id').eq('league_id', leagueId);
    if (allTeams && allTeams.length > 0) {
      const userIds = allTeams.map(t => t.user_id);
      const { data: users } = await admin.from('users').select('email').in('id', userIds);
      const emails = (users ?? []).map(u => u.email).filter(Boolean);

      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';

      if (emails.length > 0) {
        await sendEmail({
          to: emails,
          subject: dealSubject,
          html: getTradeAcceptedEmail({
            isListingSale,
            teamA: teamA.team_name,
            teamB: teamB.team_name,
            playerName: soldPlayerName,
            dealAmount,
            offeredAssets: offeredAssetsPlain,
            requestedAssets: requestedAssetsPlain,
            tierValue,
            pending: false,
            leagueUrl: `${baseUrl}/league/${leagueId}`,
          })
        });
      }

      const detailMd = isListingSale
        ? `**${soldPlayerName}** to **${teamA.team_name}** for €${dealAmount}m`
        : `**${teamA.team_name}** send ${offeredAssetsPlain} to **${teamB.team_name}** for ${requestedAssetsPlain}`;
      const { eyebrow, lead } = buildHereWeGo(isListingSale ? 'signing' : 'trade', detailMd, tierValue);
      const pushTitle = pushTitleForEyebrow(eyebrow, isListingSale ? 'Signed' : 'Trade Done');

      // Create in-game notifications for the league
      const { createNotification } = await import('@/lib/notifications/createNotification');
      for (const t of allTeams) {
        await createNotification(admin, {
          leagueId,
          userId: t.user_id,
          title: eyebrow || (isListingSale ? 'Signing Confirmed' : 'Trade Completed'),
          pushTitle,
          content: lead,
          url: `/league/${leagueId}`
        });
      }

      // Public league lobby announcement — the live "here we go" news ticker.
      await admin.from('chat_messages').insert({
        league_id: leagueId,
        is_system: true,
        message: `[SYSTEM:ANNOUNCEMENT] ${lead}`,
      });
    }
  } catch (err) {
    console.error('Failed to send trade accepted notifications:', err);
  }

  return NextResponse.json({ ok: true });
}
