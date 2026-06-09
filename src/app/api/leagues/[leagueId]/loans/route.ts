import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/client';
import { getLoanProposedEmail } from '@/lib/email/templates';

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

  // Fetch all loans in the league
  const { data: loans } = await admin
    .from('player_loans')
    .select(`
      *,
      lender_team:teams!lender_team_id(id, team_name),
      borrower_team:teams!borrower_team_id(id, team_name),
      player:players(id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at)
    `)
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false });

  // Split loans into loansOut (myTeam is lender) and loansIn (myTeam is borrower)
  const loansOut = (loans ?? []).filter(l => l.lender_team_id === myTeam.id);
  const loansIn = (loans ?? []).filter(l => l.borrower_team_id === myTeam.id);

  // Fetch all teams in the league (except caller's team)
  const { data: allTeams } = await admin
    .from('teams')
    .select('id, team_name, user_id, faab_budget')
    .eq('league_id', leagueId)
    .neq('id', myTeam.id);

  // Fetch my roster entries with player details
  const { data: myRosterEntries } = await admin
    .from('roster_entries')
    .select('status, player:players(id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at)')
    .eq('team_id', myTeam.id);

  const myRoster = (myRosterEntries ?? []).map((e) => ({
    ...e,
    player: e.player as any
  }));

  // Map of players involved in loans
  const playerMap: Record<string, any> = {};
  for (const l of loans ?? []) {
    if (l.player) {
      playerMap[l.player.id] = l.player;
    }
  }

  // Fetch league settings
  const { data: league } = await admin
    .from('leagues')
    .select('loan_slot_buyback_fee, loan_bonus_cap_default, max_loan_outs, max_loan_ins, total_gameweeks, roster_locked')
    .eq('id', leagueId)
    .single();

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
  const { borrowerTeamId, playerId, loanFee, startGameweek, endGameweek, bonusRate, hasRecall, message } = body as {
    borrowerTeamId: string;
    playerId: string;
    loanFee: number;
    startGameweek: number;
    endGameweek: number;
    bonusRate: number;
    hasRecall: boolean;
    message?: string;
  };

  if (!borrowerTeamId || !playerId || loanFee === undefined || startGameweek === undefined || endGameweek === undefined || bonusRate === undefined || hasRecall === undefined) {
    return NextResponse.json({ error: 'Missing required loan terms parameters' }, { status: 400 });
  }

  if (myTeam.id === borrowerTeamId) {
    return NextResponse.json({ error: 'Cannot loan a player to yourself' }, { status: 400 });
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

  // 6. Player ownership and status checks
  const { data: rosterEntry } = await admin
    .from('roster_entries')
    .select('id, status')
    .eq('team_id', myTeam.id)
    .eq('player_id', playerId)
    .maybeSingle();

  if (!rosterEntry) {
    return NextResponse.json({ error: 'Player is not on your roster' }, { status: 400 });
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

  // 8. Check active loan limits
  const { count: lenderActiveLoans } = await admin
    .from('player_loans')
    .select('id', { count: 'exact', head: true })
    .eq('lender_team_id', myTeam.id)
    .eq('status', 'active');

  const maxOuts = league.max_loan_outs ?? 1;
  if ((lenderActiveLoans ?? 0) >= maxOuts) {
    return NextResponse.json({ error: `You have reached the maximum number of active loan-outs (${maxOuts})` }, { status: 400 });
  }

  const { count: borrowerActiveLoans } = await admin
    .from('player_loans')
    .select('id', { count: 'exact', head: true })
    .eq('borrower_team_id', borrowerTeamId)
    .eq('status', 'active');

  const maxIns = league.max_loan_ins ?? 2;
  if ((borrowerActiveLoans ?? 0) >= maxIns) {
    return NextResponse.json({ error: `The borrower has reached the maximum number of active loan-ins (${maxIns})` }, { status: 400 });
  }

  // 9. Determine bonus cap
  let bonusCap = 0;
  if (bonusRate > 0) {
    if (league.loan_bonus_cap_default > 0) {
      bonusCap = league.loan_bonus_cap_default;
    } else {
      bonusCap = loanFee * 3;
    }

    if (loanFee === 0 && league.loan_bonus_cap_default === 0) {
      return NextResponse.json({
        error: 'A performance bonus clause on a €0-fee loan is invalid because the bonus cap is calculated as 3x the loan fee (€0). Please set a loan fee of at least €1m or ask the commissioner to configure a default flat cap.'
      }, { status: 400 });
    }
  }

  // Verify borrower team is in this league
  const { data: borrowerTeam } = await admin
    .from('teams')
    .select('id, team_name, user_id')
    .eq('id', borrowerTeamId)
    .eq('league_id', leagueId)
    .single();

  if (!borrowerTeam) return NextResponse.json({ error: 'Borrower team not found in this league' }, { status: 404 });

  // 10. Fetch player details
  const { data: player } = await admin
    .from('players')
    .select('id, name')
    .eq('id', playerId)
    .single();

  if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

  // 11. Create the loan proposal
  const { data: loan, error: insertError } = await admin
    .from('player_loans')
    .insert({
      league_id: leagueId,
      lender_team_id: myTeam.id,
      borrower_team_id: borrowerTeamId,
      player_id: playerId,
      loan_fee: loanFee,
      start_gameweek: startGameweek,
      end_gameweek: endGameweek,
      bonus_rate: bonusRate,
      bonus_cap: bonusCap,
      has_recall: hasRecall,
      status: 'pending',
      message: message ?? null
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // 12. Send notifications & private DM
  try {
    const { data: targetUser } = await admin.from('users').select('email').eq('id', borrowerTeam.user_id).single();
    if (targetUser?.email) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
      const actionUrl = `${baseUrl}/league/${leagueId}/trades`;

      await sendEmail({
        to: targetUser.email,
        subject: `New Loan Proposal from ${myTeam.team_name}`,
        html: getLoanProposedEmail(myTeam.team_name, player.name, loanFee, startGameweek, endGameweek, actionUrl)
      });
    }

    // Create in-game notification
    const { createNotification } = await import('@/lib/notifications/createNotification');
    await createNotification(admin, {
      leagueId,
      userId: borrowerTeam.user_id,
      title: 'New Loan Proposal!',
      content: `**${myTeam.team_name}** has proposed to loan **${player.name}** to your club for GW${startGameweek}-GW${endGameweek}. Fee: €${loanFee}m.${message ? ` Message: "${message}"` : ''}`,
      url: `/league/${leagueId}/trades`
    });

    // Private DM to borrower manager
    await admin.from('chat_messages').insert({
      league_id: leagueId,
      sender_id: user.id,
      recipient_id: borrowerTeam.user_id,
      message: `[SYSTEM:LOAN_PROPOSAL:${JSON.stringify({
        loanId: loan.id,
        lenderName: myTeam.team_name,
        borrowerName: borrowerTeam.team_name,
        playerName: player.name,
        loanFee: loanFee,
        startGw: startGameweek,
        endGw: endGameweek
      })}]`
    });

  } catch (err) {
    console.error('Failed to send loan notifications:', err);
  }

  return NextResponse.json({ loan }, { status: 201 });
}
