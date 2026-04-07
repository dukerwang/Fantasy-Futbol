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
  nextPow2,
  seedBracket,
  buildRoundSpecs,
  resolveTiebreaker,
  type SeedEntry,
} from '@/lib/tournaments/engine';
import { processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';
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
  if (action === 'resolve_stalled') return handleResolveStalled(req);

  return NextResponse.json({ error: 'Invalid action. Use ?action=create, ?action=advance, or ?action=resolve_stalled' }, { status: 400 });
}

// ─── CREATE TOURNAMENT ────────────────────────────────────────

async function handleCreate(_req: NextRequest, params: URLSearchParams) {
  const leagueId = params.get('league_id');
  const type = params.get('type') as TournamentType | null;
  const startGw = parseInt(params.get('start_gameweek') ?? '0', 10);

  if (!leagueId || !type || !startGw) {
    return NextResponse.json({ error: 'league_id, type, and start_gameweek required' }, { status: 400 });
  }

  const validTypes: TournamentType[] = ['primary_cup', 'secondary_cup', 'consolation_cup'];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, { status: 400 });
  }

  const admin = createAdminClient();

  // Determine the previous season string for dynasty seeding
  // (Assuming current season is '2025-26', previous is '2024-25'. This could be made dynamic later.)
  const PREVIOUS_SEASON = '2024-25';

  // Fetch league teams with total_points for fallback seeding
  const { data: allTeams, error: teamsErr } = await admin
    .from('teams')
    .select('id, team_name, total_points')
    .eq('league_id', leagueId);

  if (teamsErr || !allTeams || allTeams.length < 4) {
    return NextResponse.json({ error: 'Need at least 4 teams in the league', detail: teamsErr }, { status: 400 });
  }

  // Fetch previous season stats for seeding
  const { data: prevStats } = await admin
    .from('team_stats')
    .select('team_id, rank')
    .eq('season', PREVIOUS_SEASON)
    .in('team_id', allTeams.map(t => t.id));

  const hasPrevSeasonData = prevStats && prevStats.length > 0;
  let orderedTeams = [...allTeams];

  if (hasPrevSeasonData) {
    // Dynasty format: Order teams by previous season rank (unranked teams go to the bottom)
    orderedTeams.sort((a, b) => {
      const rankA = prevStats.find(s => s.team_id === a.id)?.rank ?? 999;
      const rankB = prevStats.find(s => s.team_id === b.id)?.rank ?? 999;
      return rankA - rankB;
    });
  } else {
    // Inaugural season fallback: order by current season's total points (descending)
    // Since this endpoint is triggered right before the tournament starts,
    // this accurately reflects the current standings.
    orderedTeams.sort((a, b) => (b.total_points ?? 0) - (a.total_points ?? 0));
  }

  // The teams array should now behave identically to the old one but correctly sorted
  const teams = orderedTeams;

  // Filter teams based on type and league size
  let eligible = teams;
  
  if (type === 'primary_cup' || type === 'consolation_cup') {
    if (teams.length >= 7) {
      // Standings-based split
      if (type === 'primary_cup') {
        eligible = teams.slice(0, teams.length - 2); // Top X
      } else if (type === 'consolation_cup') {
        eligible = teams.slice(teams.length - 2); // Bottom 2
      }
    } else {
      // 4-6 teams
      if (type === 'primary_cup') {
        eligible = teams; // All enter Champions
      } else if (type === 'consolation_cup') {
        // Europa fed by eliminations, so it starts empty.
        // Wait, if it starts empty, what should `eligible` be? We seed an empty bracket!
        // Because of the complicated dynamic dropping, we need the bracket size to be large enough to house the incoming drops.
        // If 5 teams: drops 1 from QF, 2 from SF = 3 teams. So Europa bracket size = 4 (for SF, F).
        // If 6 teams: drops 2 from SF = 2 teams? No wait, 2 from QF, 2 from SF = 4 teams. Europa bracket size = 4.
        // If 4 teams: drops 2 from SF = 2 teams. Europa bracket size = 2.
        // Instead of writing teams to it, we just create empty slots.
        if (teams.length === 6 || teams.length === 5) {
          eligible = new Array(4).fill({ id: null }); // Force bracket size 4
        } else if (teams.length === 4) {
          eligible = new Array(2).fill({ id: null }); // Force bracket size 2
        }
      }
    }
  }

  const seeds: SeedEntry[] = eligible.map((t, i) => ({ teamId: t.id, seed: i + 1 }));
  const bracketSize = nextPow2(seeds.length);
  const bracketSlots = seedBracket(seeds, bracketSize);
  const roundSpecs = buildRoundSpecs(bracketSize, type, teams.length);

  // Tournament name
  const names: Record<TournamentType, string> = {
    primary_cup: 'Champions Cup',
    secondary_cup: 'League Cup',
    consolation_cup: 'Consolation Cup',
  };

  // Prevent creation if the league was created midseason and the tournament schedule has already passed
  const minGwRequired = Math.min(...roundSpecs.map(r => r.startGameweek));
  if (minGwRequired < startGw) {
    return NextResponse.json({ 
      error: `Cannot create ${names[type]}: League was created midseason (gameweek ${startGw}), but this tournament requires a round starting at gameweek ${minGwRequired}.` 
    }, { status: 400 });
  }
  // 1. Insert tournament
  const { data: tournament, error: tErr } = await admin
    .from('tournaments')
    .insert({
      league_id: leagueId,
      name: names[type],
      type,
      status: 'pending',
      season: '2025-26',
    })
    .select()
    .single();

  if (tErr || !tournament) {
    return NextResponse.json({ error: 'Failed to create tournament', detail: tErr?.message }, { status: 500 });
  }

  // 2. Insert rounds
  const roundInserts = roundSpecs.map(r => ({
    tournament_id: tournament.id,
    name: r.name,
    round_number: r.roundNumber,
    start_gameweek: r.startGameweek,
    end_gameweek: r.endGameweek,
    is_two_leg: r.isTwoLeg,
  }));

  const { data: rounds, error: rErr } = await admin
    .from('tournament_rounds')
    .insert(roundInserts)
    .select()
    .order('round_number', { ascending: true });

  if (rErr || !rounds) {
    return NextResponse.json({ error: 'Failed to create rounds', detail: rErr?.message }, { status: 500 });
  }

  // 3. Build matchups round by round (need to create later rounds first for next_matchup_id linking)
  // Strategy: create all matchups without next_matchup_id, then update links.

  // Round 1 matchups from bracket slots
  const allMatchups: { roundId: string; roundNumber: number; teamA: string | null; teamB: string | null; bracketPos: number }[] = [];

  // First round: pair bracket slots
  const firstRound = rounds[0];
  for (let i = 0; i < bracketSlots.length; i += 2) {
    allMatchups.push({
      roundId: firstRound.id,
      roundNumber: 1,
      teamA: bracketSlots[i],
      teamB: bracketSlots[i + 1],
      bracketPos: i / 2,
    });
  }

  // Subsequent rounds: empty matchups (TBD)
  for (let r = 1; r < rounds.length; r++) {
    const matchCount = roundSpecs[r].matchCount;
    for (let m = 0; m < matchCount; m++) {
      allMatchups.push({
        roundId: rounds[r].id,
        roundNumber: r + 1,
        teamA: null,
        teamB: null,
        bracketPos: m,
      });
    }
  }

  // Insert all matchups
  const matchupInserts = allMatchups.map(m => ({
    round_id: m.roundId,
    team_a_id: m.teamA,
    team_b_id: m.teamB,
    bracket_position: m.bracketPos,
    status: 'pending' as const,
  }));

  const { data: insertedMatchups, error: mErr } = await admin
    .from('tournament_matchups')
    .insert(matchupInserts)
    .select()
    .order('created_at', { ascending: true });

  if (mErr || !insertedMatchups) {
    return NextResponse.json({ error: 'Failed to create matchups', detail: mErr?.message }, { status: 500 });
  }

  // 4. Link next_matchup_id: matchup at round R, position P feeds into round R+1, position floor(P/2)
  // Group matchups by round
  const matchupsByRound = new Map<string, typeof insertedMatchups>();
  for (const m of insertedMatchups) {
    const arr = matchupsByRound.get(m.round_id) || [];
    arr.push(m);
    matchupsByRound.set(m.round_id, arr);
  }

  for (let r = 0; r < rounds.length - 1; r++) {
    const currentRoundMatchups = matchupsByRound.get(rounds[r].id) || [];
    const nextRoundMatchups = matchupsByRound.get(rounds[r + 1].id) || [];

    // Sort by bracket_position
    currentRoundMatchups.sort((a, b) => a.bracket_position - b.bracket_position);
    nextRoundMatchups.sort((a, b) => a.bracket_position - b.bracket_position);

    for (const cm of currentRoundMatchups) {
      const nextPos = Math.floor(cm.bracket_position / 2);
      const nextMatchup = nextRoundMatchups.find(nm => nm.bracket_position === nextPos);
      if (nextMatchup) {
        await admin
          .from('tournament_matchups')
          .update({ next_matchup_id: nextMatchup.id })
          .eq('id', cm.id);
      }
    }
  }

  // 5. Auto-advance byes in round 1
  const firstRoundMatchups = matchupsByRound.get(rounds[0].id) || [];
  for (const m of firstRoundMatchups) {
    const aIsNull = !m.team_a_id;
    const bIsNull = !m.team_b_id;

    if (aIsNull && bIsNull) continue; // both empty — skip

    if (aIsNull || bIsNull) {
      // One team has a bye — auto-advance the non-null team
      const winnerId = m.team_a_id || m.team_b_id;
      await admin
        .from('tournament_matchups')
        .update({ winner_id: winnerId, status: 'completed' })
        .eq('id', m.id);

      // Place winner into next round matchup
      if (m.next_matchup_id && winnerId) {
        await advanceWinner(admin, m.next_matchup_id, winnerId, m.bracket_position);
      }
    }
  }

  // 6. Set tournament to active
  await admin
    .from('tournaments')
    .update({ status: 'active' })
    .eq('id', tournament.id);

  return NextResponse.json({
    ok: true,
    tournament_id: tournament.id,
    bracket_size: bracketSize,
    teams: seeds.length,
    byes: bracketSize - seeds.length,
    rounds: rounds.length,
  });
}

// ─── ADVANCE TOURNAMENT ──────────────────────────────────────

async function handleAdvance(_req: NextRequest, params: URLSearchParams) {
  const tournamentId = params.get('tournament_id');
  const gameweek = parseInt(params.get('gameweek') ?? '0', 10);

  if (!tournamentId || !gameweek) {
    return NextResponse.json({ error: 'tournament_id and gameweek required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Load tournament
  const { data: tournament } = await admin
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .single();

  if (!tournament) {
    return NextResponse.json({ error: 'Tournament not found' }, { status: 404 });
  }

  // Find rounds where this gameweek is the end_gameweek (i.e., round should be finalized)
  const { data: rounds } = await admin
    .from('tournament_rounds')
    .select('*')
    .eq('tournament_id', tournamentId)
    .eq('end_gameweek', gameweek);

  if (!rounds || rounds.length === 0) {
    return NextResponse.json({ ok: true, message: 'No rounds ending this gameweek' });
  }

  const season = '2025-26';
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

  // Check if tournament is complete (all matchups completed)
  const { data: pendingMatchups } = await admin
    .from('tournament_matchups')
    .select('id')
    .in('round_id', rounds.map(r => r.id))
    .neq('status', 'completed');

  // Also check all rounds
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

  return NextResponse.json({ ok: true, advanced, gameweek });
}

// ─── RESOLVE STALLED GAMEWEEKS ───────────────────────────────

/**
 * Detects and force-resolves stalled gameweeks.
 * If >48 hours have passed since the last non-postponed fixture's kickoff,
 * the gameweek is force-finished. Postponed players score 0, autosubs fire.
 */
async function handleResolveStalled(_req: NextRequest) {
  const admin = createAdminClient();

  // Derive current GW natively from FPL events
  let currentGw = 0;
  let gwDeadline: Date | null = null;
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { next: { revalidate: 60 } });
    if (!fplRes.ok) return NextResponse.json({ error: 'Failed to fetch FPL data' }, { status: 502 });

    const fplData = await fplRes.json();
    const now = new Date();
    for (const ev of fplData.events as any[]) {
      if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
        if (ev.id > currentGw) {
          currentGw = ev.id;
          gwDeadline = new Date(ev.deadline_time);
        }
      }
    }
  } catch (err) {
    return NextResponse.json({ error: 'FPL API error', detail: String(err) }, { status: 502 });
  }

  if (!currentGw) return NextResponse.json({ ok: true, message: 'No active gameweek found' });

  // Check if this GW has any non-completed matchups in our system
  const { data: liveMatchups } = await admin
    .from('matchups')
    .select('id')
    .eq('gameweek', currentGw)
    .neq('status', 'completed')
    .limit(1);

  if (!liveMatchups || liveMatchups.length === 0) {
    return NextResponse.json({ ok: true, message: `GW${currentGw} already resolved` });
  }

  // Check FPL fixtures: find the latest non-postponed fixture kickoff
  try {
    const fixRes = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${currentGw}`, { next: { revalidate: 60 } });
    if (!fixRes.ok) return NextResponse.json({ error: 'Failed to fetch fixtures' }, { status: 502 });

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

    // Force-resolve if all non-postponed fixtures are finished OR
    // >48 hours since the latest non-postponed kickoff
    const hoursElapsed = latestKickoff ? (now.getTime() - latestKickoff.getTime()) / (1000 * 60 * 60) : 0;
    const shouldForceResolve = allNonPostponedFinished || hoursElapsed > 48;

    if (!shouldForceResolve) {
      return NextResponse.json({
        ok: true,
        message: `GW${currentGw} still in progress. ${hoursElapsed.toFixed(1)}h since last kickoff.`,
      });
    }

    // Force-resolve: run matchup sync with finished=true
    let syncResult;
    try {
      syncResult = await processMatchupsForGameweek(currentGw, true);
    } catch (e: any) {
      syncResult = { error: 'sync failed', detail: e.message };
    }

    return NextResponse.json({
      ok: true,
      action: 'force_resolved',
      gameweek: currentGw,
      reason: allNonPostponedFinished ? 'all_non_postponed_finished' : `stalled_${hoursElapsed.toFixed(0)}h`,
      syncResult,
    });
  } catch (err) {
    return NextResponse.json({ error: 'Failed to check fixtures', detail: String(err) }, { status: 500 });
  }
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
