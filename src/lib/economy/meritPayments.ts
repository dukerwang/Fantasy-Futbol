/**
 * Gaffa — Monthly Merit Income
 *
 * The regular-season prize pool is paid DURING the season on match results
 * rather than as a lump sum at the offseason reset. Pure arithmetic only —
 * no database access — so the period boundaries and the payment formula can
 * be tested without a Supabase client.
 *
 * Why monthly rather than per-gameweek: cadence is independent of totals, and
 * batching identical money into ten statements a season turns a rounding
 * error into an event. Real clubs receive broadcast and merit money in
 * instalments, not per match.
 *
 * Design doc: docs/superpowers/specs/2026-07-29-economy-rebalance-design.md
 */

/** Gameweeks per merit period, for every period except the final short one. */
export const MERIT_PERIOD_LENGTH = 4;

/** A Premier League season is 38 gameweeks; the schedule generator fills to it. */
export const TOTAL_GAMEWEEKS = 38;

/** Nine periods of four gameweeks, plus a final period covering GW37-38. */
export const MERIT_PERIOD_COUNT = 10;

export interface MeritRates {
    win: number;
    draw: number;
    loss: number;
    /**
     * Odd-sized leagues get a virtual BYE team (see schedule/generator.ts), so
     * a club can have no fixture in a gameweek. A bye pays the draw rate: it
     * was neither earned nor lost.
     */
    bye: number;
}

/**
 * League defaults. Two properties matter and both are asserted in the tests:
 *
 *   win + loss = 2 x draw  ->  every match pays out exactly EUR 3.0m whatever
 *   the result, so the season's total outlay is deterministic.
 *
 *   A draw pays less than half a win. The 10-point draw band exists because a
 *   narrow margin is noise in the rating engine rather than a result, so a
 *   coin flip should not pay like a win.
 *
 * Per-league overrides live in leagues.merit_win / merit_draw / merit_loss /
 * merit_bye (migration 091).
 */
export const DEFAULT_MERIT_RATES: MeritRates = {
    win: 2.5,
    draw: 1.5,
    loss: 0.5,
    bye: 1.5,
};

export interface TeamRecord {
    wins: number;
    draws: number;
    losses: number;
    byes: number;
}

/** The subset of a `matchups` row this module needs. */
export interface MatchupResultRow {
    gameweek: number;
    team_a_id: string;
    team_b_id: string;
    winner_team_id: string | null;
    status: string;
}

/**
 * The period that CLOSES on this gameweek, or null if it is not a boundary.
 * Boundaries are GW4, 8, 12, 16, 20, 24, 28, 32, 36 and 38.
 *
 * Periods are counted in gameweeks rather than calendar months so the schedule
 * needs no fixture dates and the boundary is deterministic.
 */
export function periodIndexForGameweek(gameweek: number): number | null {
    if (!Number.isInteger(gameweek) || gameweek < 1 || gameweek > TOTAL_GAMEWEEKS) return null;
    if (gameweek === TOTAL_GAMEWEEKS) return MERIT_PERIOD_COUNT;
    if (gameweek % MERIT_PERIOD_LENGTH === 0) return gameweek / MERIT_PERIOD_LENGTH;
    return null;
}

/** Every gameweek belonging to a period. Periods 1-9 hold four; period 10 holds GW37-38. */
export function gameweeksInPeriod(periodIndex: number): number[] {
    if (!Number.isInteger(periodIndex) || periodIndex < 1 || periodIndex > MERIT_PERIOD_COUNT) {
        throw new Error(`Invalid merit period index: ${periodIndex}`);
    }
    if (periodIndex === MERIT_PERIOD_COUNT) return [37, 38];
    const end = periodIndex * MERIT_PERIOD_LENGTH;
    return Array.from({ length: MERIT_PERIOD_LENGTH }, (_, i) => end - MERIT_PERIOD_LENGTH + 1 + i);
}

/**
 * What one club earns for a period. Returns an exact value; the caller is
 * responsible for flooring before writing to the INT faab_budget column.
 * With the default rates the result is always a whole number already.
 */
export function computeMeritPayment(record: TeamRecord, rates: MeritRates): number {
    const raw =
        record.wins * rates.win +
        record.draws * rates.draw +
        record.losses * rates.loss +
        record.byes * rates.bye;
    // Guard against float dust from configured rates like 1.2 or 0.4.
    return Number(raw.toFixed(2));
}

/**
 * Turn completed matchup rows into a per-team record for one period.
 *
 * A team with no completed matchup in a gameweek is credited a BYE rather than
 * a loss. That covers both the odd-league virtual bye and the case where a
 * gameweek's matchups have not resolved — paying a bye is the conservative
 * choice, since charging a loss would penalise a club for a scheduling artefact.
 */
export function tallyPeriodRecords(
    rows: MatchupResultRow[],
    teamIds: string[],
    gameweeks: number[],
): Map<string, TeamRecord> {
    const gwSet = new Set(gameweeks);
    const tally = new Map<string, TeamRecord>();
    for (const id of teamIds) tally.set(id, { wins: 0, draws: 0, losses: 0, byes: 0 });

    // Track which (team, gameweek) pairs had a real fixture, so the rest are byes.
    const played = new Set<string>();

    for (const row of rows) {
        if (!gwSet.has(row.gameweek)) continue;
        if (row.status !== 'completed') continue;

        for (const teamId of [row.team_a_id, row.team_b_id]) {
            const rec = tally.get(teamId);
            if (!rec) continue; // not a team we were asked about
            played.add(`${teamId}:${row.gameweek}`);
            if (row.winner_team_id === null) rec.draws++;
            else if (row.winner_team_id === teamId) rec.wins++;
            else rec.losses++;
        }
    }

    for (const id of teamIds) {
        const rec = tally.get(id)!;
        for (const gw of gameweeks) {
            if (!played.has(`${id}:${gw}`)) rec.byes++;
        }
    }

    return tally;
}
