import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/client';
import { getLoanProposedEmail } from '@/lib/email/templates';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export async function GET(req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // Fetch caller's team
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, team_name, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  // Fetch league settings
  const { data: league } = await admin
    .from('leagues')
    .select('loan_slot_buyback_fee, loan_bonus_cap_default, max_loan_outs, max_loan_ins, total_gameweeks, roster_locked, current_season, previous_season')
    .eq('id', leagueId)
    .single();

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  const currentSeason = league.current_season || '2025-26';
  const previousSeason = league.previous_season || '2024-25';

  // Fetch all loans in the league
  const { data: loans } = await admin
    .from('player_loans')
    .select(`
      *,
      lender_team:teams!lender_team_id(id, team_name),
      borrower_team:teams!borrower_team_id(id, team_name),
      player:players(${FULL_PLAYER_SELECT})
    `)
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false });

  // Fetch all teams in the league (except caller's team)
  const { data: allTeams } = await admin
    .from('teams')
    .select('id, team_name, user_id, faab_budget')
    .eq('league_id', leagueId)
    .neq('id', myTeam.id);

  // Fetch my roster entries with player details
  const { data: myRosterEntries } = await admin
    .from('roster_entries')
    .select(`status, player:players(${FULL_PLAYER_SELECT})`)
    .eq('team_id', myTeam.id);

  // Gather player IDs to fetch stats
  const playerIds = new Set<string>();
  (myRosterEntries ?? []).forEach(e => {
    const p = e.player as any;
    if (p?.id) playerIds.add(p.id);
  });
  (loans ?? []).forEach(l => {
    const p = l.player as any;
    if (p?.id) playerIds.add(p.id);
  });

  // Build a lookup of player market values
  const playerMarketValueMap: Record<string, number> = {};
  (myRosterEntries ?? []).forEach(e => {
    const p = e.player as any;
    if (p?.id) playerMarketValueMap[p.id] = Number(p.market_value) || 0;
  });
  (loans ?? []).forEach(l => {
    const p = l.player as any;
    if (p?.id) playerMarketValueMap[p.id] = Number(p.market_value) || 0;
  });

  // Fetch recent PPG and season PPG (excluding DNPs) for all players using the fallback chain
  let recentPpgMap: Record<string, number> = {};
  if (playerIds.size > 0) {
    const { data: stats } = await admin
      .from('player_stats')
      .select('player_id, fantasy_points, gameweek, stats, season')
      .in('player_id', Array.from(playerIds))
      .in('season', [currentSeason, previousSeason])
      .order('season', { ascending: false })
      .order('gameweek', { ascending: false });

    const playerGroups: Record<string, {
      currentSeasonStats: { points: number; minutes: number }[];
      previousSeasonStats: { points: number; minutes: number }[];
    }> = {};

    for (const s of stats ?? []) {
      const rawStats = (s.stats as any) || {};
      const minutes = Number(rawStats.minutes_played ?? 0);
      
      // Exclude DNPs (minutes_played <= 0)
      if (minutes <= 0) continue;

      if (!playerGroups[s.player_id]) {
        playerGroups[s.player_id] = {
          currentSeasonStats: [],
          previousSeasonStats: []
        };
      }

      const points = Number(s.fantasy_points) || 0;
      if (s.season === currentSeason) {
        playerGroups[s.player_id].currentSeasonStats.push({ points, minutes });
      } else if (s.season === previousSeason) {
        playerGroups[s.player_id].previousSeasonStats.push({ points, minutes });
      }
    }

    const calculateEffectivePPG = (
      currStats: { points: number; minutes: number }[],
      prevStats: { points: number; minutes: number }[],
      marketValue: number
    ): number => {
      const N = currStats.length;
      let effectivePPG = 3.0;

      // 1. Mid-Season (N >= 10 appearances)
      if (N >= 10) {
        const seasonPPG = currStats.reduce((sum, m) => sum + m.points, 0) / N;
        const recentMatches = currStats.slice(0, 10);
        const recentPPG = recentMatches.reduce((sum, m) => sum + m.points, 0) / recentMatches.length;
        effectivePPG = 0.6 * recentPPG + 0.4 * seasonPPG;
      }
      // 2. Early Season (1 <= N < 10 appearances)
      else if (N >= 1) {
        const seasonPPG_this_season = currStats.reduce((sum, m) => sum + m.points, 0) / N;
        const hasHistoricalData = prevStats.length > 0;

        if (hasHistoricalData) {
          const M_last = prevStats.reduce((sum, m) => sum + m.minutes, 0);
          const PPG_last_season = prevStats.reduce((sum, m) => sum + m.points, 0) / prevStats.length;
          const reliability = Math.min(1.0, M_last / 1500);
          const adjustedPPG_last_season = (reliability * PPG_last_season) + ((1 - reliability) * 4.0);

          const weight_this = N / 10;
          const weight_last = 1 - weight_this;
          effectivePPG = (weight_this * seasonPPG_this_season) + (weight_last * adjustedPPG_last_season);
        } else {
          // Brand new player
          let proxyPPG = 3.0;
          if (marketValue >= 80) proxyPPG = 10.0;
          else if (marketValue >= 40) proxyPPG = 8.0;
          else if (marketValue >= 20) proxyPPG = 6.0;
          else if (marketValue >= 10) proxyPPG = 4.5;
          else proxyPPG = 3.0;

          const weight_actual = Math.min(1.0, N / 5);
          effectivePPG = (weight_actual * seasonPPG_this_season) + ((1 - weight_actual) * proxyPPG);
        }
      }
      // 3. Preseason / GW1 (N == 0 appearances)
      else {
        const hasHistoricalData = prevStats.length > 0;
        if (hasHistoricalData) {
          const M_last = prevStats.reduce((sum, m) => sum + m.minutes, 0);
          const PPG_last_season = prevStats.reduce((sum, m) => sum + m.points, 0) / prevStats.length;
          const reliability = Math.min(1.0, M_last / 1500);
          const adjustedPPG_last_season = (reliability * PPG_last_season) + ((1 - reliability) * 4.0);
          effectivePPG = adjustedPPG_last_season;
        } else {
          let proxyPPG = 3.0;
          if (marketValue >= 80) proxyPPG = 10.0;
          else if (marketValue >= 40) proxyPPG = 8.0;
          else if (marketValue >= 20) proxyPPG = 6.0;
          else if (marketValue >= 10) proxyPPG = 4.5;
          else proxyPPG = 3.0;
          effectivePPG = proxyPPG;
        }
      }

      return Math.max(3.0, effectivePPG);
    };

    for (const id of playerIds) {
      const group = playerGroups[id] || { currentSeasonStats: [], previousSeasonStats: [] };
      const mv = playerMarketValueMap[id] ?? 0;
      recentPpgMap[id] = calculateEffectivePPG(group.currentSeasonStats, group.previousSeasonStats, mv);
    }
  }

  // Enrich player objects with recent_ppg
  const enrichedLoans = (loans ?? []).map((l) => {
    if (l.player) {
      return {
        ...l,
        player: {
          ...l.player,
          recent_ppg: recentPpgMap[l.player.id] ?? Math.max(3.0, l.player.ppg ?? 3.0)
        }
      };
    }
    return l;
  });

  const loansOut = enrichedLoans.filter(l => l.lender_team_id === myTeam.id);
  const loansIn = enrichedLoans.filter(l => l.borrower_team_id === myTeam.id);

  const myRoster = (myRosterEntries ?? []).map((e) => ({
    ...e,
    player: e.player ? {
      ...(e.player as any),
      recent_ppg: recentPpgMap[(e.player as any).id] ?? Math.max(3.0, (e.player as any).ppg ?? 3.0)
    } : null
  }));

  // Map of players involved in loans
  const playerMap: Record<string, any> = {};
  for (const l of enrichedLoans) {
    if (l.player) {
      playerMap[l.player.id] = l.player;
    }
  }

  return NextResponse.json({
    myTeam,
    loansOut,
    loansIn,
    allTeams: allTeams ?? [],
    myRoster,
    playerMap,
    leagueSettings: {
      loan_slot_buyback_fee: league?.loan_slot_buyback_fee ?? 25,
      loan_bonus_cap_default: league?.loan_bonus_cap_default ?? 0,
      max_loan_outs: league?.max_loan_outs ?? 1,
      max_loan_ins: league?.max_loan_ins ?? 2,
      total_gameweeks: league?.total_gameweeks ?? 38,
      roster_locked: league?.roster_locked ?? false
    }
  });
}

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

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

  // 3. Parse and validate body
  const body = await req.json();
  // requestMode = true means the CALLER is the borrower requesting a player from lenderTeamId.
  // Classic mode (requestMode = false/undefined): caller is the lender proposing to borrowerTeamId.
  const { borrowerTeamId, lenderTeamId, playerId, loanFee, startGameweek, endGameweek, bonusRate, bonusCap: clientBonusCap, hasRecall, message, requestMode } = body as {
    borrowerTeamId?: string;
    lenderTeamId?: string;
    playerId: string;
    loanFee: number;
    startGameweek: number;
    endGameweek: number;
    bonusRate: number;
    bonusCap?: number;
    hasRecall: boolean;
    message?: string;
    requestMode?: boolean;
  };

  // Resolve effective lender/borrower based on mode
  const effectiveLenderTeamId = requestMode ? (lenderTeamId ?? '') : myTeam.id;
  const effectiveBorrowerTeamId = requestMode ? myTeam.id : (borrowerTeamId ?? '');
  const proposedBy: 'lender' | 'borrower' = requestMode ? 'borrower' : 'lender';

  if (!effectiveLenderTeamId || !effectiveBorrowerTeamId || !playerId || loanFee === undefined || startGameweek === undefined || endGameweek === undefined || bonusRate === undefined || hasRecall === undefined) {
    return NextResponse.json({ error: 'Missing required loan terms parameters' }, { status: 400 });
  }

  if (effectiveLenderTeamId === effectiveBorrowerTeamId) {
    return NextResponse.json({ error: 'Cannot loan a player to yourself' }, { status: 400 });
  }

  if (requestMode && effectiveLenderTeamId === myTeam.id) {
    return NextResponse.json({ error: 'Cannot request a loan of your own player — use Propose Loan instead' }, { status: 400 });
  }

  if (!Number.isInteger(loanFee) || loanFee < 0) {
    return NextResponse.json({ error: 'loanFee must be a non-negative integer' }, { status: 400 });
  }

  if (typeof bonusRate !== 'number' || bonusRate < 0) {
    return NextResponse.json({ error: 'bonusRate must be a non-negative number' }, { status: 400 });
  }

  if (!Number.isInteger(startGameweek) || !Number.isInteger(endGameweek)) {
    return NextResponse.json({ error: 'Gameweeks must be integers' }, { status: 400 });
  }

  if (endGameweek <= startGameweek) {
    return NextResponse.json({ error: 'endGameweek must be greater than startGameweek' }, { status: 400 });
  }

  const duration = endGameweek - startGameweek;
  if (duration < 4 || duration > 16) {
    return NextResponse.json({ error: 'Loan duration must be between 4 and 16 gameweeks' }, { status: 400 });
  }

  // 4. Fetch league config
  const { data: league } = await admin
    .from('leagues')
    .select('roster_locked, total_gameweeks, loan_slot_buyback_fee, loan_bonus_cap_default, max_loan_outs, max_loan_ins')
    .eq('id', leagueId)
    .single();

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  if (league.roster_locked) {
    return NextResponse.json({ error: 'Rosters are locked. Loan proposals are not permitted.' }, { status: 403 });
  }

  // 5. Fetch current FPL GW to enforce season timing (loans blocked in final 8 GWs)
  let currentFplGw = 0;
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: { 'User-Agent': 'FantasyFutbol/1.0' },
      next: { revalidate: 3600 },
    });
    if (fplRes.ok) {
      const fplData = await fplRes.json();
      const now = new Date();
      for (const ev of fplData.events as any[]) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
          currentFplGw = Math.max(currentFplGw, ev.id);
        }
      }
    }
  } catch (err) {
    console.error('[loans] Failed to fetch current GW from FPL:', err);
  }

  const totalGws = league.total_gameweeks ?? 38;
  const lastAllowedStartGw = totalGws - 8;
  if (startGameweek > lastAllowedStartGw) {
    return NextResponse.json({ error: `Loans cannot start after GW${lastAllowedStartGw}. The final 8 gameweeks are locked for loans.` }, { status: 400 });
  }

  if (endGameweek > totalGws) {
    return NextResponse.json({ error: `Loan end GW${endGameweek} exceeds this season's ${totalGws} total GWs.` }, { status: 400 });
  }

  // 6. Player ownership and status checks (ownership is always on lender's roster)
  const { data: rosterEntry } = await admin
    .from('roster_entries')
    .select('id, status')
    .eq('team_id', effectiveLenderTeamId)
    .eq('player_id', playerId)
    .maybeSingle();

  if (!rosterEntry) {
    return NextResponse.json({
      error: requestMode ? 'The requested player is not on that team\'s roster' : 'Player is not on your roster'
    }, { status: 400 });
  }

  if (['ir', 'taxi', 'loan_in', 'loan_out'].includes(rosterEntry.status)) {
    return NextResponse.json({ error: `Cannot loan out a player who is currently in status '${rosterEntry.status}'` }, { status: 400 });
  }

  // 7. Check if player has an active/pending loan already
  const { data: activeLoanForPlayer } = await admin
    .from('player_loans')
    .select('id')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .in('status', ['pending', 'active'])
    .maybeSingle();

  if (activeLoanForPlayer) {
    return NextResponse.json({ error: 'This player is already involved in an active or pending loan' }, { status: 409 });
  }

  // 7b. A listed player can be loaned only through the seller's loan gate.
  //
  // Two distinct refusals, and the difference matters:
  //
  //   'active'  — bidding is live. Nothing can be arranged privately around an
  //               auction other managers have committed budget to, and the
  //               listing can no longer be cancelled to make way (see the DELETE
  //               handler in listings/[listingId]/route.ts). Hard no.
  //
  //   gate shut — the seller listed this player without opening him to loans.
  //               Their choice to reverse, via PATCH on the listing.
  //
  // If neither applies the loan may be proposed: accepting it cancels the still-
  // pending listing, and 080's trg_withdraw_listing_auction_anchor rejects the
  // auction anchor in the same transaction. See the accept handler, which
  // re-checks this — the listing can go live between proposal and acceptance.
  const { data: openListingForPlayer } = await admin
    .from('player_sale_listings')
    .select('id, status, open_to_loan')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .in('status', ['pending', 'active'])
    .maybeSingle();

  if (openListingForPlayer?.status === 'active') {
    return NextResponse.json(
      { error: 'Bidding is live on this player — he cannot be loaned until the auction finishes.' },
      { status: 409 },
    );
  }

  if (openListingForPlayer && !openListingForPlayer.open_to_loan) {
    return NextResponse.json(
      {
        error: requestMode
          ? 'This player is listed for transfer and his club is not accepting loan approaches.'
          : 'You have listed this player without opening him to loans. Edit the listing to accept loan approaches, or cancel it.',
      },
      { status: 409 },
    );
  }

  // 8. Check active loan limits (count active + deferred + pending_activation)
  const ACTIVE_LOAN_STATUSES = ['active', 'accepted_deferred', 'pending_activation'];

  const { count: lenderActiveLoans } = await admin
    .from('player_loans')
    .select('id', { count: 'exact', head: true })
    .eq('lender_team_id', effectiveLenderTeamId)
    .in('status', ACTIVE_LOAN_STATUSES);

  const maxOuts = league.max_loan_outs ?? 1;
  if ((lenderActiveLoans ?? 0) >= maxOuts) {
    return NextResponse.json({ error: `The lender has reached the maximum number of active loan-outs (${maxOuts})` }, { status: 400 });
  }

  const { count: borrowerActiveLoans } = await admin
    .from('player_loans')
    .select('id', { count: 'exact', head: true })
    .eq('borrower_team_id', effectiveBorrowerTeamId)
    .in('status', ACTIVE_LOAN_STATUSES);

  const maxIns = league.max_loan_ins ?? 2;
  if ((borrowerActiveLoans ?? 0) >= maxIns) {
    return NextResponse.json({ error: `The borrower has reached the maximum number of active loan-ins (${maxIns})` }, { status: 400 });
  }

  // 9. Determine bonus cap
  let bonusCap = 0;
  if (bonusRate > 0) {
    if (clientBonusCap !== undefined) {
      bonusCap = clientBonusCap;
    } else if (league.loan_bonus_cap_default > 0) {
      bonusCap = league.loan_bonus_cap_default;
    } else {
      bonusCap = loanFee * 3;
    }

    if (loanFee === 0 && bonusCap === 0) {
      return NextResponse.json({
        error: 'A performance bonus clause on a €0-fee loan is invalid because the bonus cap is calculated as 3x the loan fee (€0). Please set a loan fee of at least €1m or ask the commissioner to configure a default flat cap.'
      }, { status: 400 });
    }
  }

  // Verify the counterparty team is in this league
  const counterpartyTeamId = requestMode ? effectiveLenderTeamId : effectiveBorrowerTeamId;
  const { data: counterpartyTeam } = await admin
    .from('teams')
    .select('id, team_name, user_id')
    .eq('id', counterpartyTeamId)
    .eq('league_id', leagueId)
    .single();

  if (!counterpartyTeam) return NextResponse.json({ error: 'Target team not found in this league' }, { status: 404 });

  // 10. Fetch player details
  const { data: player } = await admin
    .from('players')
    .select('id, name')
    .eq('id', playerId)
    .single();

  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  // 11. Create the loan proposal/request
  const { data: loan, error: insertError } = await admin
    .from('player_loans')
    .insert({
      league_id: leagueId,
      lender_team_id: effectiveLenderTeamId,
      borrower_team_id: effectiveBorrowerTeamId,
      player_id: playerId,
      loan_fee: loanFee,
      start_gameweek: startGameweek,
      end_gameweek: endGameweek,
      bonus_rate: bonusRate,
      bonus_cap: bonusCap,
      has_recall: hasRecall,
      status: 'pending',
      proposed_by: proposedBy,
      message: message ?? null
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // 12. Send notifications & private DM to the counterparty (the one who needs to accept)
  try {
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
    const actionUrl = `${baseUrl}/league/${leagueId}/transfers/deals`;

    const { data: targetUser } = await admin.from('users').select('email').eq('id', counterpartyTeam.user_id).single();
    if (targetUser?.email) {
      if (requestMode) {
        await sendEmail({
          to: targetUser.email,
          subject: `Loan Request from ${myTeam.team_name}`,
          html: getLoanProposedEmail(myTeam.team_name, player.name, loanFee, startGameweek, endGameweek, actionUrl)
        });
      } else {
        await sendEmail({
          to: targetUser.email,
          subject: `New Loan Proposal from ${myTeam.team_name}`,
          html: getLoanProposedEmail(myTeam.team_name, player.name, loanFee, startGameweek, endGameweek, actionUrl)
        });
      }
    }

    // Create in-game notification for the counterparty
    const { createNotification } = await import('@/lib/notifications/createNotification');
    if (requestMode) {
      await createNotification(admin, {
        leagueId,
        userId: counterpartyTeam.user_id,
        title: 'Loan Request Received!',
        content: `**${myTeam.team_name}** is requesting to loan **${player.name}** for GW${startGameweek}-GW${endGameweek}. Proposed fee: €${loanFee}m.${message ? ` Message: "${message}"` : ''}`,
        url: `/league/${leagueId}/transfers/deals`
      });
    } else {
      await createNotification(admin, {
        leagueId,
        userId: counterpartyTeam.user_id,
        title: 'New Loan Proposal!',
        content: `**${myTeam.team_name}** has proposed to loan **${player.name}** to your club for GW${startGameweek}-GW${endGameweek}. Fee: €${loanFee}m.${message ? ` Message: "${message}"` : ''}`,
        url: `/league/${leagueId}/transfers/deals`
      });
    }

    // Private DM to counterparty manager
    await admin.from('chat_messages').insert({
      league_id: leagueId,
      sender_id: user.id,
      recipient_id: counterpartyTeam.user_id,
      message: `[SYSTEM:LOAN_PROPOSAL:${JSON.stringify({
        loanId: loan.id,
        lenderName: requestMode ? counterpartyTeam.team_name : myTeam.team_name,
        borrowerName: requestMode ? myTeam.team_name : counterpartyTeam.team_name,
        playerName: player.name,
        loanFee: loanFee,
        startGw: startGameweek,
        endGw: endGameweek,
        isRequest: requestMode ?? false
      })}]`
    });

  } catch (err) {
    console.error('Failed to send loan notifications:', err);
  }

  return NextResponse.json({ loan }, { status: 201 });
}
