/**
 * Gaffa — Merit period payout
 *
 * Called from the matchup processor when a gameweek finishes. If that gameweek
 * closes a merit period (GW4, 8, ... 36, 38) every club in the league is paid
 * for its results across that period.
 *
 * Deliberately hooked into gameweek resolution rather than a new cron route:
 * vercel.json does not schedule every /api/cron/* route (process-auctions,
 * process-loans and others are triggered externally), so a payment on its own
 * schedule could silently never fire. Tying it to the resolution it depends on
 * means it cannot drift.
 *
 * Safe to call for every finished gameweek — non-boundary gameweeks return
 * immediately, and the credit RPC rejects a period that has already been paid.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import {
    DEFAULT_MERIT_RATES,
    computeMeritPayment,
    gameweeksInPeriod,
    periodIndexForGameweek,
    tallyPeriodRecords,
} from './meritPayments';
import type { MatchupResultRow, MeritRates } from './meritPayments';

export interface MeritPeriodResult {
    paid: boolean;
    periodIndex: number | null;
    payments: { teamId: string; teamName: string; amount: number }[];
}

export async function payMeritPeriod(
    admin: SupabaseClient,
    leagueId: string,
    gameweek: number,
): Promise<MeritPeriodResult> {
    const periodIndex = periodIndexForGameweek(gameweek);
    if (periodIndex === null) return { paid: false, periodIndex: null, payments: [] };

    const gameweeks = gameweeksInPeriod(periodIndex);

    const { data: league, error: leagueErr } = await admin
        .from('leagues')
        .select('current_season, season, merit_win, merit_draw, merit_loss, merit_bye')
        .eq('id', leagueId)
        .single();

    if (leagueErr || !league) {
        throw new Error(`payMeritPeriod: failed to load league ${leagueId}: ${leagueErr?.message}`);
    }

    // Never hardcode the season string; the league row is the resolved value.
    const season = league.current_season ?? league.season;
    if (!season) throw new Error(`payMeritPeriod: league ${leagueId} has no season`);

    // Fall back to code defaults if a column is null — a league created before
    // migration 091 was applied would otherwise pay nothing at all.
    const rates: MeritRates = {
        win: Number(league.merit_win ?? DEFAULT_MERIT_RATES.win),
        draw: Number(league.merit_draw ?? DEFAULT_MERIT_RATES.draw),
        loss: Number(league.merit_loss ?? DEFAULT_MERIT_RATES.loss),
        bye: Number(league.merit_bye ?? DEFAULT_MERIT_RATES.bye),
    };

    const { data: teams, error: teamsErr } = await admin
        .from('teams')
        .select('id, team_name')
        .eq('league_id', leagueId);

    if (teamsErr || !teams?.length) {
        throw new Error(`payMeritPeriod: no teams for league ${leagueId}: ${teamsErr?.message}`);
    }

    const { data: matchups, error: matchupsErr } = await admin
        .from('matchups')
        .select('gameweek, team_a_id, team_b_id, winner_team_id, status')
        .eq('league_id', leagueId)
        .in('gameweek', gameweeks);

    if (matchupsErr) {
        throw new Error(`payMeritPeriod: failed to load matchups: ${matchupsErr.message}`);
    }

    const teamIds = teams.map((t) => t.id);
    const nameById = new Map(teams.map((t) => [t.id, t.team_name as string]));
    const records = tallyPeriodRecords((matchups ?? []) as MatchupResultRow[], teamIds, gameweeks);

    const payments: MeritPeriodResult['payments'] = [];
    const label = periodIndex === 10 ? 'GW37–38' : `GW${gameweeks[0]}–${gameweeks[3]}`;

    for (const teamId of teamIds) {
        const record = records.get(teamId)!;
        // faab_budget is INT. Floor here; the remainder is not paid.
        const amount = Math.floor(computeMeritPayment(record, rates));

        const { data: res, error } = await admin.rpc('credit_merit_payment', {
            p_league_id: leagueId,
            p_team_id: teamId,
            p_season: season,
            p_period_index: periodIndex,
            p_amount: amount,
            p_notes: `TV & Matchday Revenue — ${label} (${record.wins}W ${record.draws}D ${record.losses}L${record.byes > 0 ? ` ${record.byes}B` : ''})`,
            p_wins: record.wins,
            p_draws: record.draws,
            p_losses: record.losses,
            p_byes: record.byes,
        });

        if (error) {
            // One club failing must not abort the rest of the league's payout;
            // the unique constraint makes a later retry safe.
            console.error(`[payMeritPeriod] league ${leagueId} team ${teamId} failed:`, error.message);
            continue;
        }

        const credited = (res as { credited?: boolean } | null)?.credited;
        if (credited) {
            payments.push({ teamId, teamName: nameById.get(teamId) ?? 'Unknown', amount });
        }
    }

    return { paid: payments.length > 0, periodIndex, payments };
}
