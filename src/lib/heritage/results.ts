/**
 * src/lib/heritage/results.ts
 *
 * Every competitive result the league has ever produced, in one shape.
 *
 * WHY THIS EXISTS. A Gaffa result lives in four places depending on when it
 * happened and what competition it was:
 *
 *   league, this season   → matchups
 *   league, past seasons  → season_matchups_archive
 *   cup, this season      → tournament_matchups (+ rounds, + tournaments)
 *   cup, past seasons     → season_cup_matchups_archive   (migration 156)
 *
 * Head-to-head records, the record book and the honours board all need to read
 * across all four, so they read this instead. Load once per page, derive the
 * rest in memory: six clubs over a handful of seasons is a few hundred rows.
 *
 * THE LIVE SEASON IS THE AWKWARD ONE. `matchups` has no season column — it is
 * wiped and regenerated at every reset, so its rows are implicitly the current
 * season and nothing in the table says so. Every caller therefore passes the
 * season in; nothing here guesses it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type Competition = 'league' | 'primary_cup' | 'secondary_cup' | 'consolation_cup';

export type Outcome = 'win' | 'draw' | 'loss';

/**
 * The league's draw band. A regular-season matchup inside 10 points is a draw
 * (DRAW_THRESHOLD in src/lib/scoring/matchupProcessor.ts). Cup ties never draw.
 */
export const DRAW_THRESHOLD = 10;

export interface Result {
  season: string;
  competition: Competition;
  /** 'League' or the cup's archived display name. */
  competitionLabel: string;
  /** 'Gameweek 14' or 'Semi-final' — what to print in a results list. */
  stage: string;
  /** Present for league fixtures; null for cup ties, which span a round. */
  gameweek: number | null;
  teamAId: string;
  teamBId: string;
  /** Aggregate over both legs for a two-legged tie. */
  scoreA: number;
  scoreB: number;
  /**
   * Cup ties never draw: the bracket resolves a level tie on best individual
   * performer, then on seed. So the winner is stored rather than derived, and
   * is null only for a league fixture (use `outcomeFor`) or an unplayed tie.
   */
  winnerId: string | null;
  /** Per-leg figures, kept because the record book measures single scores. */
  legs: { a: number; b: number }[];
  /** True while the fixture has not been resolved yet. */
  provisional: boolean;
}

/** The result from one club's point of view. */
export function outcomeFor(r: Result, teamId: string): Outcome {
  const isA = r.teamAId === teamId;
  const mine = isA ? r.scoreA : r.scoreB;
  const theirs = isA ? r.scoreB : r.scoreA;

  if (r.competition !== 'league') {
    // A cup tie is won or lost, never drawn — including 0–0, where the bracket
    // seed decides it. Trust the stored winner over the scoreline.
    if (!r.winnerId) return mine > theirs ? 'win' : 'loss';
    return r.winnerId === teamId ? 'win' : 'loss';
  }
  if (Math.abs(mine - theirs) < DRAW_THRESHOLD) return 'draw';
  return mine > theirs ? 'win' : 'loss';
}

const num = (v: unknown) => Number(v ?? 0);

const CUP_TYPES: Competition[] = ['primary_cup', 'secondary_cup', 'consolation_cup'];
const isCupType = (t: unknown): t is Competition =>
  typeof t === 'string' && (CUP_TYPES as string[]).includes(t);

/**
 * Every result in the league, newest season first. Includes the season in
 * progress; `currentSeason` names it, because `matchups` cannot.
 */
export async function loadAllResults(
  admin: SupabaseClient,
  leagueId: string,
  currentSeason: string,
): Promise<Result[]> {
  const [liveLeague, archivedLeague, liveCups, archivedCups] = await Promise.all([
    admin
      .from('matchups')
      .select('gameweek, team_a_id, team_b_id, score_a, score_b, status')
      .eq('league_id', leagueId),

    admin
      .from('season_matchups_archive')
      .select('season, gameweek, team_a_id, team_b_id, score_a, score_b')
      .eq('league_id', leagueId),

    // The live bracket, two joins up to the tournament. `!inner` on both hops
    // is load-bearing: tournament_matchups has no league_id of its own, so
    // without inner joins this would fetch every league's bracket and filter
    // in memory.
    admin
      .from('tournament_matchups')
      .select(
        `team_a_id, team_b_id, winner_id, status,
         team_a_score_leg1, team_b_score_leg1, team_a_score_leg2, team_b_score_leg2,
         round:tournament_rounds!round_id!inner(
           name, round_number, is_two_leg,
           tournament:tournaments!tournament_id!inner(name, type, season, league_id)
         )`,
      )
      .eq('round.tournament.league_id', leagueId),

    admin
      .from('season_cup_matchups_archive')
      .select(
        `season, tournament_name, tournament_type, round_name, is_two_leg,
         team_a_id, team_b_id, winner_id,
         team_a_score_leg1, team_b_score_leg1, team_a_score_leg2, team_b_score_leg2`,
      )
      .eq('league_id', leagueId),
  ]);

  const out: Result[] = [];

  for (const m of (liveLeague.data ?? []) as any[]) {
    out.push({
      season: currentSeason,
      competition: 'league',
      competitionLabel: 'League',
      stage: `Gameweek ${m.gameweek}`,
      gameweek: m.gameweek,
      teamAId: m.team_a_id,
      teamBId: m.team_b_id,
      scoreA: num(m.score_a),
      scoreB: num(m.score_b),
      winnerId: null,
      legs: [{ a: num(m.score_a), b: num(m.score_b) }],
      provisional: m.status !== 'completed',
    });
  }

  for (const m of (archivedLeague.data ?? []) as any[]) {
    out.push({
      season: m.season,
      competition: 'league',
      competitionLabel: 'League',
      stage: `Gameweek ${m.gameweek}`,
      gameweek: m.gameweek,
      teamAId: m.team_a_id,
      teamBId: m.team_b_id,
      scoreA: num(m.score_a),
      scoreB: num(m.score_b),
      winnerId: null,
      legs: [{ a: num(m.score_a), b: num(m.score_b) }],
      provisional: false,
    });
  }

  for (const m of (liveCups.data ?? []) as any[]) {
    const round = m.round;
    const tournament = round?.tournament;
    // The bracket join carries no league filter of its own, so scope here.
    if (!tournament || tournament.league_id !== leagueId) continue;
    if (!m.team_a_id || !m.team_b_id) continue;      // a bye is not a meeting
    if (!isCupType(tournament.type)) continue;
    out.push(cupResult({
      season: tournament.season,
      name: tournament.name,
      type: tournament.type,
      roundName: round.name,
      isTwoLeg: round.is_two_leg,
      m,
      provisional: m.status !== 'completed',
    }));
  }

  for (const m of (archivedCups.data ?? []) as any[]) {
    if (!m.team_a_id || !m.team_b_id) continue;
    if (!isCupType(m.tournament_type)) continue;
    out.push(cupResult({
      season: m.season,
      name: m.tournament_name,
      type: m.tournament_type,
      roundName: m.round_name,
      isTwoLeg: m.is_two_leg,
      m,
      provisional: false,
    }));
  }

  // Newest first: season descending, then gameweek. Cup ties sort after the
  // league fixtures of the same season, which is how a season reads back.
  return out.sort((x, y) =>
    y.season.localeCompare(x.season) || (y.gameweek ?? -1) - (x.gameweek ?? -1));
}

function cupResult(o: {
  season: string;
  name: string;
  type: Competition;
  roundName: string;
  isTwoLeg: boolean;
  m: any;
  provisional: boolean;
}): Result {
  const { m } = o;
  const legs = [{ a: num(m.team_a_score_leg1), b: num(m.team_b_score_leg1) }];
  if (o.isTwoLeg) legs.push({ a: num(m.team_a_score_leg2), b: num(m.team_b_score_leg2) });

  return {
    season: o.season,
    competition: o.type,
    competitionLabel: o.name,
    stage: o.roundName,
    gameweek: null,
    teamAId: m.team_a_id,
    teamBId: m.team_b_id,
    // A two-legged tie is ONE meeting decided on aggregate, so that is what a
    // head-to-head counts. The legs stay on the row for the record book, which
    // measures single scores.
    scoreA: legs.reduce((s, l) => s + l.a, 0),
    scoreB: legs.reduce((s, l) => s + l.b, 0),
    winnerId: m.winner_id ?? null,
    legs,
    provisional: o.provisional,
  };
}
