/**
 * src/lib/tournaments/advanceTournament.ts
 *
 * Core tournament advancement logic — extracted from the HTTP route so it can
 * be called directly by matchupProcessor after resolving a gameweek, keeping
 * cup brackets in sync without needing an HTTP round-trip.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { calculateMatchRating } from '@/lib/scoring/engine';
import { resolveTiebreaker } from '@/lib/tournaments/engine';
import { loadReferenceStats } from '@/lib/scoring/matchups';
import type { GranularPosition, ReferenceStats } from '@/types';

type AdminClient = ReturnType<typeof createAdminClient>;
type RefStatsMap = Record<string, ReferenceStats>;

async function getRefStats(
  admin: AdminClient,
  tournamentId: string,
): Promise<{ refStats: RefStatsMap; season: string }> {
  const { data } = await admin
    .from('tournaments')
    .select('league:leagues(current_season)')
    .eq('id', tournamentId)
    .single();
  const season = (data?.league as any)?.current_season ?? '2025-26';
  const refStats = (await loadReferenceStats(admin, season)) as RefStatsMap;
  return { refStats, season };
}

/** Place a winner into the next round matchup slot. */
async function advanceWinner(
  admin: AdminClient,
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

  // Activate the matchup once both teams are set
  const { data: next } = await admin
    .from('tournament_matchups')
    .select('team_a_id, team_b_id')
    .eq('id', nextMatchupId)
    .single();

  if (next?.team_a_id && next?.team_b_id) {
    await admin
      .from('tournament_matchups')
      .update({ status: 'active' })
      .eq('id', nextMatchupId);
  }
}

/** Score a single leg for two teams by reading already-calculated matchup scores. */
async function scoreLeg(
  admin: AdminClient,
  leagueId: string,
  gw: number,
  teamAId: string,
  teamBId: string,
  refStats: RefStatsMap,
  season: string,
): Promise<{
  scoreA: number;
  scoreB: number;
  teamAPlayers: { playerId: string; points: number }[];
  teamBPlayers: { playerId: string; points: number }[];
}> {
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

  let scoreA = 0;
  let scoreB = 0;

  if (matchupA) {
    scoreA = matchupA.team_a_id === teamAId ? Number(matchupA.score_a) : Number(matchupA.score_b);
  }
  if (matchupB) {
    scoreB = matchupB.team_a_id === teamBId ? Number(matchupB.score_a) : Number(matchupB.score_b);
  }

  const lineupA = matchupA
    ? (matchupA.team_a_id === teamAId ? matchupA.lineup_a : matchupA.lineup_b)
    : null;
  const lineupB = matchupB
    ? (matchupB.team_a_id === teamBId ? matchupB.lineup_a : matchupB.lineup_b)
    : null;

  const teamAPlayers = await getPlayerScores(admin, lineupA, gw, refStats, season);
  const teamBPlayers = await getPlayerScores(admin, lineupB, gw, refStats, season);

  return { scoreA, scoreB, teamAPlayers, teamBPlayers };
}

async function getPlayerScores(
  admin: AdminClient,
  lineup: any,
  gw: number,
  refStats: RefStatsMap,
  season: string,
): Promise<{ playerId: string; points: number }[]> {
  if (!lineup?.starters) return [];
  const playerIds = lineup.starters.map((s: any) => s.player_id).filter(Boolean);
  if (playerIds.length === 0) return [];

  const { data: stats } = await admin
    .from('player_stats')
    .select('player_id, stats, player:players(primary_position)')
    .eq('season', season)
    .eq('gameweek', gw)
    .in('player_id', playerIds);

  if (!stats) return [];

  return lineup.starters.map((starter: { player_id: string; slot: GranularPosition }) => {
    const playerStat = stats.find((s) => s.player_id === starter.player_id);
    if (playerStat?.stats) {
      const primPos = (playerStat.player as any)?.primary_position;
      const { fantasyPoints } = calculateMatchRating(
        playerStat.stats as any,
        starter.slot,
        refStats as any,
        primPos as GranularPosition,
      );
      return { playerId: starter.player_id, points: fantasyPoints };
    }
    return { playerId: starter.player_id, points: 0 };
  });
}

/**
 * Advance a single tournament by one gameweek:
 * - Updates in-progress leg scores
 * - Finalizes rounds whose end_gameweek === gw (determines winner, advances bracket)
 * - Handles consolation cup dropout cascades (4–6 team leagues)
 * - Marks the tournament complete if all matchups are done
 *
 * Idempotent: safe to call multiple times for the same (tournamentId, gameweek).
 */
export async function executeAdvanceTournament(
  tournamentId: string,
  gameweek: number,
): Promise<{ ok: boolean; advanced: number; gameweek: number }> {
  const admin = createAdminClient();

  const { data: tournament } = await admin
    .from('tournaments')
    .select('*')
    .eq('id', tournamentId)
    .single();

  if (!tournament) {
    throw new Error(`Tournament ${tournamentId} not found`);
  }

  // Rounds where gameweek falls within [start_gameweek, end_gameweek]
  const { data: rounds } = await admin
    .from('tournament_rounds')
    .select('*')
    .eq('tournament_id', tournamentId)
    .lte('start_gameweek', gameweek)
    .gte('end_gameweek', gameweek);

  if (!rounds || rounds.length === 0) {
    return { ok: true, advanced: 0, gameweek };
  }

  const { refStats, season } = await getRefStats(admin, tournamentId);
  let advanced = 0;

  for (const round of rounds) {
    const { data: matchups } = await admin
      .from('tournament_matchups')
      .select('*')
      .eq('round_id', round.id)
      .eq('status', 'active');

    if (!matchups || matchups.length === 0) continue;

    for (const matchup of matchups) {
      if (!matchup.team_a_id || !matchup.team_b_id) continue;

      const leg1Scores = await scoreLeg(
        admin,
        tournament.league_id,
        round.start_gameweek,
        matchup.team_a_id,
        matchup.team_b_id,
        refStats,
        season,
      );

      let leg2Scores = {
        scoreA: 0,
        scoreB: 0,
        teamAPlayers: [] as { playerId: string; points: number }[],
        teamBPlayers: [] as { playerId: string; points: number }[],
      };
      if (round.is_two_leg) {
        leg2Scores = await scoreLeg(
          admin,
          tournament.league_id,
          round.end_gameweek,
          matchup.team_a_id,
          matchup.team_b_id,
          refStats,
          season,
        );
      }

      // Update interim scores
      await admin
        .from('tournament_matchups')
        .update({
          team_a_score_leg1: leg1Scores.scoreA,
          team_b_score_leg1: leg1Scores.scoreB,
          team_a_score_leg2: leg2Scores.scoreA,
          team_b_score_leg2: leg2Scores.scoreB,
        })
        .eq('id', matchup.id);

      // Only finalize on the end_gameweek of this round
      if (gameweek !== round.end_gameweek) continue;

      const totalA = leg1Scores.scoreA + leg2Scores.scoreA;
      const totalB = leg1Scores.scoreB + leg2Scores.scoreB;

      let winnerId: string | null;
      if (totalA > totalB) {
        winnerId = matchup.team_a_id;
      } else if (totalB > totalA) {
        winnerId = matchup.team_b_id;
      } else {
        const allAPlayers = [...leg1Scores.teamAPlayers, ...leg2Scores.teamAPlayers];
        const allBPlayers = [...leg1Scores.teamBPlayers, ...leg2Scores.teamBPlayers];
        winnerId = resolveTiebreaker(allAPlayers, allBPlayers, matchup.team_a_id, matchup.team_b_id);
        // Fallback: higher seed (team_a) wins
        if (!winnerId) winnerId = matchup.team_a_id;
      }

      await admin
        .from('tournament_matchups')
        .update({ winner_id: winnerId, status: 'completed' })
        .eq('id', matchup.id);

      if (matchup.next_matchup_id && winnerId) {
        await advanceWinner(admin, matchup.next_matchup_id, winnerId, matchup.bracket_position);
      }

      // Consolation cup cascade for 4–6 team leagues
      if (tournament.type === 'primary_cup') {
        const loserId = winnerId === matchup.team_a_id ? matchup.team_b_id : matchup.team_a_id;
        if (loserId) {
          const { count: totalLeagueTeams } = await admin
            .from('teams')
            .select('id', { count: 'exact', head: true })
            .eq('league_id', tournament.league_id);

          if (totalLeagueTeams && totalLeagueTeams >= 4 && totalLeagueTeams <= 6) {
            const { data: consolationCup } = await admin
              .from('tournaments')
              .select('id')
              .eq('league_id', tournament.league_id)
              .eq('type', 'consolation_cup')
              .single();

            if (consolationCup) {
              const nameLower = round.name.toLowerCase();
              if (
                (totalLeagueTeams === 5 && (nameLower.includes('quarter') || nameLower.includes('semi'))) ||
                ((totalLeagueTeams === 4 || totalLeagueTeams === 6) && nameLower.includes('semi'))
              ) {
                const { data: targetRound } = await admin
                  .from('tournament_rounds')
                  .select('id')
                  .eq('tournament_id', consolationCup.id)
                  .eq('start_gameweek', 36)
                  .single();

                if (targetRound) {
                  const { data: openMatchups } = await admin
                    .from('tournament_matchups')
                    .select('id, team_a_id, team_b_id')
                    .eq('round_id', targetRound.id)
                    .order('bracket_position', { ascending: true });

                  if (openMatchups) {
                    for (const cand of openMatchups) {
                      if (!cand.team_a_id) {
                        await admin
                          .from('tournament_matchups')
                          .update({ team_a_id: loserId })
                          .eq('id', cand.id);
                        break;
                      } else if (!cand.team_b_id) {
                        await admin
                          .from('tournament_matchups')
                          .update({ team_b_id: loserId, status: 'active' })
                          .eq('id', cand.id);
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

  // Check if the entire tournament is now complete
  const { data: allRounds } = await admin
    .from('tournament_rounds')
    .select('id')
    .eq('tournament_id', tournamentId);

  if (allRounds) {
    const allRoundIds = allRounds.map((r) => r.id);
    const { count } = await admin
      .from('tournament_matchups')
      .select('id', { count: 'exact', head: true })
      .in('round_id', allRoundIds)
      .neq('status', 'completed');

    if (count === 0) {
      await admin.from('tournaments').update({ status: 'completed' }).eq('id', tournamentId);

      // Query winner/runner-up details to log activity feed announcements
      try {
        const { data: finalRound } = await admin
          .from('tournament_rounds')
          .select('id')
          .eq('tournament_id', tournamentId)
          .order('round_number', { ascending: false })
          .limit(1)
          .single();

        if (finalRound) {
          const { data: finalMatchup } = await admin
            .from('tournament_matchups')
            .select('team_a_id, team_b_id, winner_id, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
            .eq('round_id', finalRound.id)
            .eq('status', 'completed')
            .limit(1)
            .single();

          if (finalMatchup && finalMatchup.winner_id) {
            const winnerId = finalMatchup.winner_id;
            const runnerUpId = winnerId === finalMatchup.team_a_id ? finalMatchup.team_b_id : finalMatchup.team_a_id;
            
            const winnerName = (winnerId === finalMatchup.team_a_id
              ? (finalMatchup.team_a as any)?.team_name
              : (finalMatchup.team_b as any)?.team_name) ?? 'Unknown';

            const runnerUpName = (runnerUpId === finalMatchup.team_a_id
              ? (finalMatchup.team_a as any)?.team_name
              : (finalMatchup.team_b as any)?.team_name) ?? 'Unknown';

            // Log winner announcement transaction (type = prize_payout)
            await admin.from('transactions').insert({
              league_id: tournament.league_id,
              team_id: winnerId,
              type: 'prize_payout',
              notes: `🏆 Winner of the ${tournament.name} (${winnerName})!`,
            });

            // Log runner-up announcement transaction (type = prize_payout)
            if (runnerUpId) {
              await admin.from('transactions').insert({
                league_id: tournament.league_id,
                team_id: runnerUpId,
                type: 'prize_payout',
                notes: `🥈 Runner-Up of the ${tournament.name} (${runnerUpName})!`,
              });
            }
          }
        }
      } catch (logErr) {
        console.error('[advanceTournament] Failed to log tournament completion activity:', logErr);
      }
    }
  }

  return { ok: true, advanced, gameweek };
}
