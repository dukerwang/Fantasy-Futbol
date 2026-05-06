/**
 * POST /api/sync/tournaments
 *
 * Actions (via `action` search param):
 *   - create:   Generate a new tournament for a league
 *   - advance:  Process completed gameweeks and advance winners
 *
 * Create params:
 *   league_id, type (primary_cup | secondary_cup | consolation_cup), start_gameweek
 *
 * Advance params:
 *   tournament_id, gameweek
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '@/lib/scoring/engine';
import {
  resolveTiebreaker,
} from '@/lib/tournaments/engine';
import { processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';
import { createTournament } from '@/lib/tournaments/createTournaments';
import type { TournamentType, GranularPosition, ReferenceStats, RatingComponent } from '@/types';

export const maxDuration = 60;

type RefStatsMap = Record<string, ReferenceStats>;

async function loadReferenceStats(admin: ReturnType<typeof createAdminClient>, season: string): Promise<RefStatsMap> {
  const { data, error } = await admin
    .from('rating_reference_stats')
    .select('position_group, component, median, stddev')
    .eq('season', season);

  if (error || !data || data.length === 0) {
    return DEFAULT_REFERENCE_STATS as unknown as RefStatsMap;
  }

  const ref: RefStatsMap = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
  for (const row of data as { position_group: string; component: string; median: number; stddev: number }[]) {
    const pos = row.position_group;
    const comp = row.component as RatingComponent;
    if (ref[pos] && (ref[pos] as any)[comp]) {
      (ref[pos] as any)[comp] = { median: Number(row.median), stddev: Number(row.stddev) };
    }
  }
  return ref;
}

export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  if (!secret || !process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'create') return handleCreate(req, searchParams);
  if (action === 'advance') return handleAdvance(req, searchParams);
  if (action === 'resolve_stalled') return handleResolveStalled();

  return NextResponse.json({ error: 'Invalid action. Use ?action=create, ?action=advance, or ?action=resolve_stalled' }, { status: 400 });
}

// ─── CREATE TOURNAMENT ────────────────────────────────────────

async function handleCreate(_req: NextRequest, params: URLSearchParams) {
  const leagueId = params.get('league_id');
  const type = params.get('type') as TournamentType | null;
  const startGw = parseInt(params.get('start_gameweek') ?? '1', 10);

  if (!leagueId || !type) {
    return NextResponse.json({ error: 'league_id and type required' }, { status: 400 });
  }

  const validTypes: TournamentType[] = ['primary_cup', 'secondary_cup', 'consolation_cup'];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch season from league
  const { data: leagueRow, error: leagueErr } = await admin
    .from('leagues')
    .select('current_season')
    .eq('id', leagueId)
    .single();

  if (leagueErr || !leagueRow) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
  }

  const season = leagueRow.current_season ?? '2025-26';
  const result = await createTournament(admin, leagueId, type, startGw, season);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}

// ─── ADVANCE TOURNAMENT ──────────────────────────────────────

// ─── ADVANCE TOURNAMENT ──────────────────────────────────────

async function executeAdvance(tournamentId: string, gameweek: number) {
  const admin = createAdminClient();

  // Load tournament
  const { data: tournament } = await admin
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .single();

  if (!tournament) {
    throw new Error('Tournament not found');
  }

  // Find rounds where this gameweek is between start and end inclusive
  const { data: rounds } = await admin
    .from('tournament_rounds')
    .select('*')
    .eq('tournament_id', tournamentId)
    .lte('start_gameweek', gameweek)
    .gte('end_gameweek', gameweek);

  if (!rounds || rounds.length === 0) {
    return { ok: true, message: 'No rounds overlapping this gameweek' };
  }

  const season = admin
    ? await admin
        .from('tournaments')
        .select('league:leagues(current_season)')
        .eq('id', tournamentId)
        .single()
        .then(({ data }) => (data?.league as any)?.current_season ?? '2025-26')
    : '2025-26';
  const refStats = await loadReferenceStats(admin, season);

  let advanced = 0;

  for (const round of rounds) {
    // Fetch active matchups for this round
    const { data: matchups } = await admin
      .from('tournament_matchups')
      .select('*')
      .eq('round_id', round.id)
      .eq('status', 'active');

    if (!matchups || matchups.length === 0) continue;

    for (const matchup of matchups) {
      if (!matchup.team_a_id || !matchup.team_b_id) continue;

      // Score legs from regular matchups table
      const leg1Scores = await scoreLeg(admin, tournament.league_id, round.start_gameweek, matchup.team_a_id, matchup.team_b_id, refStats);

      let leg2Scores = { scoreA: 0, scoreB: 0, teamAPlayers: [] as { playerId: string; points: number }[], teamBPlayers: [] as { playerId: string; points: number }[] };
      if (round.is_two_leg) {
        leg2Scores = await scoreLeg(admin, tournament.league_id, round.end_gameweek, matchup.team_a_id, matchup.team_b_id, refStats);
      }

      // Update scores
      await admin
        .from('tournament_matchups')
        .update({
          team_a_score_leg1: leg1Scores.scoreA,
          team_b_score_leg1: leg1Scores.scoreB,
          team_a_score_leg2: leg2Scores.scoreA,
          team_b_score_leg2: leg2Scores.scoreB,
        })
        .eq('id', matchup.id);

      // ONLY finalize if this is the end_gameweek
      if (gameweek !== round.end_gameweek) {
        continue;
      }

      // Determine winner
      const totalA = leg1Scores.scoreA + leg2Scores.scoreA;
      const totalB = leg1Scores.scoreB + leg2Scores.scoreB;

      let winnerId: string | null;
      if (totalA > totalB) {
        winnerId = matchup.team_a_id;
      } else if (totalB > totalA) {
        winnerId = matchup.team_b_id;
      } else {
        // Tiebreaker: highest individual scorer across all legs
        const allAPlayers = [...leg1Scores.teamAPlayers, ...leg2Scores.teamAPlayers];
        const allBPlayers = [...leg1Scores.teamBPlayers, ...leg2Scores.teamBPlayers];
        winnerId = resolveTiebreaker(allAPlayers, allBPlayers, matchup.team_a_id, matchup.team_b_id);
        // If still null (extremely rare), award to higher seed (team_a)
        if (!winnerId) winnerId = matchup.team_a_id;
      }

      // Mark matchup completed
      await admin
        .from('tournament_matchups')
        .update({ winner_id: winnerId, status: 'completed' })
        .eq('id', matchup.id);

      // Advance winner to next round
      if (matchup.next_matchup_id && winnerId) {
        await advanceWinner(admin, matchup.next_matchup_id, winnerId, matchup.bracket_position);
      }

      // Check Dropdown Cascades to Consolation Cup
      if (tournament.type === 'primary_cup') {
        const loserId = winnerId === matchup.team_a_id ? matchup.team_b_id : matchup.team_a_id;
        if (loserId) {
          const { count: totalLeagueTeams } = await admin.from('teams').select('id', { count: 'exact', head: true }).eq('league_id', tournament.league_id);
          
          if (totalLeagueTeams && totalLeagueTeams >= 4 && totalLeagueTeams <= 6) {
            // Find parallel consolation cup
            const { data: consolationCup } = await admin.from('tournaments')
              .select('id')
              .eq('league_id', tournament.league_id)
              .eq('type', 'consolation_cup')
              .single();
              
            if (consolationCup) {
              const nameLower = round.name.toLowerCase();
              // Inject into empty slots sequentially. (Since we seeded empty brackets of size 2 or 4)
              // This basic fill logic looks for the first null slot in the first round of the consolation cup
              if (
                 (totalLeagueTeams === 5 && (nameLower.includes('quarter') || nameLower.includes('semi'))) ||
                 ((totalLeagueTeams === 4 || totalLeagueTeams === 6) && nameLower.includes('semi'))
              ) {
                // Determine target Gameweek of the Consolation Round we are injecting into:
                // If it's a QF drop in a 5-team league, they go to Consolation SF (starts MW36)
                // If it's a SF drop in 4/6-team, they go to Consolation Final (starts MW36)
                
                const { data: targetRound } = await admin.from('tournament_rounds')
                  .select('id')
                  .eq('tournament_id', consolationCup.id)
                  .eq('start_gameweek', 36)
                  .single();

                if (targetRound) {
                  const { data: openMatchups } = await admin.from('tournament_matchups')
                    .select('id, team_a_id, team_b_id')
                    .eq('round_id', targetRound.id)
                    .order('bracket_position', { ascending: true });

                  if (openMatchups) {
                    for (const cand of openMatchups) {
                      if (!cand.team_a_id) {
                        await admin.from('tournament_matchups').update({ team_a_id: loserId }).eq('id', cand.id);
                        break;
                      } else if (!cand.team_b_id) {
                        await admin.from('tournament_matchups').update({ team_b_id: loserId, status: 'active' }).eq('id', cand.id);
                        break;
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }

      advanced++;
    }
  }

  // Check if tournament is complete — evaluate across all rounds
  const { data: allRounds } = await admin
    .from('tournament_rounds')
    .select('id')
    .eq('tournament_id', tournamentId);

  if (allRounds) {
    const allRoundIds = allRounds.map(r => r.id);
    const { count } = await admin
      .from('tournament_matchups')
      .select('id', { count: 'exact', head: true })
      .in('round_id', allRoundIds)
      .neq('status', 'completed');

    if (count === 0) {
      await admin
        .from('tournaments')
        .update({ status: 'completed' })
        .eq('id', tournamentId);
    }
  }

  return { ok: true, advanced, gameweek };
}

async function handleAdvance(_req: NextRequest, params: URLSearchParams) {
  const tournamentId = params.get('tournament_id');
  const gameweek = parseInt(params.get('gameweek') ?? '0', 10);

  if (!tournamentId || !gameweek) {
    return NextResponse.json({ error: 'tournament_id and gameweek required' }, { status: 400 });
  }

  try {
    const result = await executeAdvance(tournamentId, gameweek);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── RESOLVE STALLED GAMEWEEKS ───────────────────────────────

/**
 * Detects and force-resolves stalled gameweeks sequentially.
 * If >48 hours have passed since the last non-postponed fixture's kickoff,
 * the gameweek is force-finished. Tournament brackets are advanced automatically.
 */
async function handleResolveStalled() {
  const admin = createAdminClient();

  // Derive current GW and fetch FPL events for use as the primary completion signal
  let currentGw = 0;
  let fplEvents: any[] = [];
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { next: { revalidate: 0 } });
    if (!fplRes.ok) return NextResponse.json({ error: 'Failed to fetch FPL data' }, { status: 502 });

    const fplData = await fplRes.json();
    fplEvents = fplData.events as any[];
    const now = new Date();
    for (const ev of fplEvents) {
      if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
        if (ev.id > currentGw) {
          currentGw = ev.id;
        }
      }
    }
  } catch (err) {
    return NextResponse.json({ error: 'FPL API error', detail: String(err) }, { status: 502 });
  }

  // 1. Activation migration for current/past rounds
  const { data: activeRounds } = await admin
    .from('tournament_rounds')
    .select('id')
    .lte('start_gameweek', currentGw);
    
  if (activeRounds && activeRounds.length > 0) {
    const roundIds = activeRounds.map(r => r.id);
    await admin
      .from('tournament_matchups')
      .update({ status: 'active' })
      .in('round_id', roundIds)
      .not('team_a_id', 'is', null)
      .not('team_b_id', 'is', null)
      .eq('status', 'pending');
  }

  // 2. Future Reset: if active but in future round, reset to pending
  // This handles the user's issue where MW38 matches were accidentally marked active.
  const { data: futureRounds } = await admin
    .from('tournament_rounds')
    .select('id')
    .gt('start_gameweek', currentGw);
    
  if (futureRounds && futureRounds.length > 0) {
    const futureRoundIds = futureRounds.map(r => r.id);
    await admin
      .from('tournament_matchups')
      .update({ status: 'pending' })
      .in('round_id', futureRoundIds)
      .eq('status', 'active');
  }

  // 3. Auto-complete tournaments past their final date
  const { data: activeTourneys } = await admin
    .from('tournaments')
    .select('id')
    .eq('status', 'active');
    
  if (activeTourneys) {
    for (const t of activeTourneys) {
      const { data: lastRounds } = await admin
        .from('tournament_rounds')
        .select('end_gameweek')
        .eq('tournament_id', t.id)
        .order('end_gameweek', { ascending: false })
        .limit(1);
        
      if (lastRounds && lastRounds.length > 0 && lastRounds[0].end_gameweek < currentGw) {
        await admin.from('tournaments').update({ status: 'completed' }).eq('id', t.id);
      }
    }
  }

  // 2. Identify gameweeks to check (current and last 4)
  const gwsToCheck = [];
  for (let i = 0; i < 5; i++) {
    const gw = currentGw - i;
    if (gw >= 1) gwsToCheck.push(gw);
  }
  gwsToCheck.sort((a, b) => a - b);
  
  const results = [];

  // Check FPL fixtures per GW, sequentially
  for (const gw of gwsToCheck) {
    try {
      const fixRes = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${gw}`, { next: { revalidate: 60 } });
      if (!fixRes.ok) continue;

      const fixtures = await fixRes.json();
      const now = new Date();
      let allNonPostponedFinished = true;
      let latestKickoff: Date | null = null;

      for (const f of fixtures) {
        const isPostponed = f.event === null || f.postponed === true;
        if (isPostponed) continue;

        if (!f.finished && !f.finished_provisional) {
          allNonPostponedFinished = false;
        }

        if (f.kickoff_time) {
          const ko = new Date(f.kickoff_time);
          if (!latestKickoff || ko > latestKickoff) latestKickoff = ko;
        }
      }

      const hoursElapsed = latestKickoff ? (now.getTime() - latestKickoff.getTime()) / (1000 * 60 * 60) : 0;

      // Primary signal: FPL bootstrap-static events[gw].finished = true means bonus
      // points are applied and the GW is fully locked. This is the most reliable trigger.
      const fplGwFinished = fplEvents.find((e) => e.id === gw)?.finished === true;

      // Secondary: all non-postponed fixtures are done (fires before bonus points in some cases)
      // Emergency fallback: 48 hours elapsed since last kickoff
      const shouldForceResolve = fplGwFinished || allNonPostponedFinished || hoursElapsed > 48 || gw < currentGw;

      if (shouldForceResolve) {
        // 1. Resolve League Matchups if not yet completed
        const { data: unresolvedLeague } = await admin
          .from('matchups')
          .select('id')
          .eq('gameweek', gw)
          .neq('status', 'completed')
          .limit(1);

        let leagueSync = null;
        if (unresolvedLeague && unresolvedLeague.length > 0) {
          leagueSync = await processMatchupsForGameweek(gw, true);
        }
        
        // 2. Proactively Advance active tournaments for this gameweek
        const { data: activeTournaments } = await admin
          .from('tournaments')
          .select('id')
          .eq('status', 'active');
          
        let advancedCount = 0;
        if (activeTournaments) {
          for (const t of activeTournaments) {
            await executeAdvance(t.id, gw);
            advancedCount++;
          }
        }

        results.push({
          gw,
          status: 'processed',
          leagueSyncTriggered: !!leagueSync,
          tournamentsAdvanced: advancedCount,
          reason: fplGwFinished ? 'fpl_gw_finished' : (allNonPostponedFinished ? 'all_fixtures_done' : (gw < currentGw ? 'past_gameweek' : `stalled_${hoursElapsed.toFixed(0)}h`)),
        });
      } else {
        results.push({ gw, status: 'in_progress', hoursElapsed });
      }

    } catch (e: any) {
      results.push({ gw, error: 'sync/advance failed', detail: e.message });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: gwsToCheck,
    results
  });
}

// ─── Helpers ──────────────────────────────────────────────────

/** Place a winner into the next round matchup. */
async function advanceWinner(
  admin: ReturnType<typeof createAdminClient>,
  nextMatchupId: string,
  winnerId: string,
  fromBracketPosition: number,
) {
  // Even bracket positions fill team_a, odd fill team_b
  const isTeamA = fromBracketPosition % 2 === 0;

  await admin
    .from('tournament_matchups')
    .update(isTeamA ? { team_a_id: winnerId } : { team_b_id: winnerId })
    .eq('id', nextMatchupId);

  // If both teams are now set, activate the matchup
  const { data: nextMatchup } = await admin
    .from('tournament_matchups')
    .select('team_a_id, team_b_id')
    .eq('id', nextMatchupId)
    .single();

  if (nextMatchup?.team_a_id && nextMatchup?.team_b_id) {
    await admin
      .from('tournament_matchups')
      .update({ status: 'active' })
      .eq('id', nextMatchupId);
  }
}

/** Score a single leg (gameweek) for two teams using the existing matchup scoring logic. */
async function scoreLeg(
  admin: ReturnType<typeof createAdminClient>,
  leagueId: string,
  gw: number,
  teamAId: string,
  teamBId: string,
  refStats: RefStatsMap,
): Promise<{
  scoreA: number;
  scoreB: number;
  teamAPlayers: { playerId: string; points: number }[];
  teamBPlayers: { playerId: string; points: number }[];
}> {
  // Look up the regular-season matchup for this gameweek to get lineups
  // Teams might not play each other in H2H — find each team's matchup
  const { data: matchupA } = await admin
    .from('matchups')
    .select('lineup_a, lineup_b, team_a_id, team_b_id, score_a, score_b')
    .eq('league_id', leagueId)
    .eq('gameweek', gw)
    .or(`team_a_id.eq.${teamAId},team_b_id.eq.${teamAId}`)
    .limit(1)
    .single();

  const { data: matchupB } = await admin
    .from('matchups')
    .select('lineup_a, lineup_b, team_a_id, team_b_id, score_a, score_b')
    .eq('league_id', leagueId)
    .eq('gameweek', gw)
    .or(`team_a_id.eq.${teamBId},team_b_id.eq.${teamBId}`)
    .limit(1)
    .single();

  // Use the already-calculated scores from the matchup sync
  let scoreA = 0;
  let scoreB = 0;

  if (matchupA) {
    scoreA = matchupA.team_a_id === teamAId ? Number(matchupA.score_a) : Number(matchupA.score_b);
  }
  if (matchupB) {
    scoreB = matchupB.team_a_id === teamBId ? Number(matchupB.score_a) : Number(matchupB.score_b);
  }

  // Get individual player scores for tiebreaker
  const lineupA = matchupA
    ? (matchupA.team_a_id === teamAId ? matchupA.lineup_a : matchupA.lineup_b)
    : null;
  const lineupB = matchupB
    ? (matchupB.team_a_id === teamBId ? matchupB.lineup_a : matchupB.lineup_b)
    : null;

  const teamAPlayers = await getPlayerScores(admin, lineupA, gw, refStats);
  const teamBPlayers = await getPlayerScores(admin, lineupB, gw, refStats);

  return { scoreA, scoreB, teamAPlayers, teamBPlayers };
}

/** Get individual player scores for tiebreaker resolution. */
async function getPlayerScores(
  admin: ReturnType<typeof createAdminClient>,
  lineup: any,
  gw: number,
  refStats: RefStatsMap,
): Promise<{ playerId: string; points: number }[]> {
  if (!lineup?.starters) return [];

  const playerIds = lineup.starters.map((s: any) => s.player_id);
  if (playerIds.length === 0) return [];

  const { data: stats } = await admin
    .from('player_stats')
    .select('player_id, stats')
    .eq('gameweek', gw)
    .in('player_id', playerIds);

  if (!stats) return [];

  const result: { playerId: string; points: number }[] = [];
  for (const starter of lineup.starters as { player_id: string; slot: GranularPosition }[]) {
    const playerStat = stats.find(s => s.player_id === starter.player_id);
    if (playerStat?.stats) {
      const { fantasyPoints } = calculateMatchRating(playerStat.stats as any, starter.slot, refStats as any);
      result.push({ playerId: starter.player_id, points: fantasyPoints });
    } else {
      result.push({ playerId: starter.player_id, points: 0 });
    }
  }

  return result;
}
