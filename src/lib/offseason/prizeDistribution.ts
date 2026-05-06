/**
 * Fantasy Futbol — Prize Distribution
 *
 * Distributes end-of-season FAAB prizes to teams for:
 * - Regular season standings (ranks 1–N, compressed distribution)
 * - Cup winners/runners-up (Champions Cup, League Cup, Consolation Cup)
 *
 * FAAB is a permanent dynasty currency — prizes compound across seasons.
 * Uses the credit_faab_prize RPC (ACID, writes transaction record too).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export interface PrizeEntry {
  teamId: string;
  teamName: string;
  prizeKey: string;
  prizeLabel: string;
  amount: number;
}

export type PrizeConfig = Record<string, number>;

/** Default prize config — overridden per-league via leagues.prize_config */
export const DEFAULT_PRIZE_CONFIG: PrizeConfig = {
  season_1st: 90,
  season_2nd: 80,
  season_3rd: 73,
  season_4th: 68,
  season_5th: 64,
  season_6th: 62,
  season_7th: 59,
  season_8th: 57,
  season_9th: 54,
  season_10th: 52,
  champions_cup_winner: 70,
  champions_cup_runner_up: 25,
  consolation_cup_winner: 40,
  consolation_cup_runner_up: 15,
  league_cup_winner: 40,
  league_cup_runner_up: 10,
};

const ORDINAL_KEYS = [
  'season_1st', 'season_2nd', 'season_3rd', 'season_4th', 'season_5th',
  'season_6th', 'season_7th', 'season_8th', 'season_9th', 'season_10th',
];
const ORDINAL_LABELS = [
  '1st Place (Regular Season)', '2nd Place (Regular Season)',
  '3rd Place (Regular Season)', '4th Place (Regular Season)',
  '5th Place (Regular Season)', '6th Place (Regular Season)',
  '7th Place (Regular Season)', '8th Place (Regular Season)',
  '9th Place (Regular Season)', '10th Place (Regular Season)',
];

/**
 * Builds the prize list for regular season standings.
 * Ranks are pulled from the league_standings view.
 * Every team gets a prize (minimum = the Nth rank prize).
 */
export async function buildSeasonPrizes(
  admin: SupabaseClient,
  leagueId: string,
  prizeConfig: PrizeConfig,
): Promise<PrizeEntry[]> {
  const { data: standings, error } = await admin
    .from('league_standings')
    .select('team_id, rank, team:teams(team_name)')
    .eq('league_id', leagueId)
    .order('rank', { ascending: true });

  if (error || !standings) throw new Error(`Failed to fetch standings: ${error?.message}`);

  const entries: PrizeEntry[] = [];
  for (const row of standings) {
    const rankIdx = (row.rank ?? 1) - 1; // 0-indexed
    const key = ORDINAL_KEYS[rankIdx];
    if (!key) continue; // league has >10 teams (shouldn't happen, but guard)

    const amount = prizeConfig[key] ?? DEFAULT_PRIZE_CONFIG[key] ?? 52;
    const label = ORDINAL_LABELS[rankIdx];
    const team = row.team as unknown as { team_name: string };

    entries.push({
      teamId: row.team_id,
      teamName: team?.team_name ?? 'Unknown',
      prizeKey: key,
      prizeLabel: label,
      amount,
    });
  }

  return entries;
}

/**
 * Builds prize entries for cups.
 * Looks at completed tournaments, finds the final matchup, extracts winner/runner-up.
 */
export async function buildCupPrizes(
  admin: SupabaseClient,
  leagueId: string,
  prizeConfig: PrizeConfig,
): Promise<PrizeEntry[]> {
  const { data: tournaments, error } = await admin
    .from('tournaments')
    .select('id, type, name, status')
    .eq('league_id', leagueId)
    .eq('status', 'completed');

  if (error || !tournaments || tournaments.length === 0) return [];

  const CUP_PRIZE_MAP: Record<string, { winner: string; runnerUp: string; winnerLabel: string; ruLabel: string }> = {
    primary_cup: {
      winner: 'champions_cup_winner',
      runnerUp: 'champions_cup_runner_up',
      winnerLabel: 'Champions Cup Winner',
      ruLabel: 'Champions Cup Runner-Up',
    },
    secondary_cup: {
      winner: 'league_cup_winner',
      runnerUp: 'league_cup_runner_up',
      winnerLabel: 'League Cup Winner',
      ruLabel: 'League Cup Runner-Up',
    },
    consolation_cup: {
      winner: 'consolation_cup_winner',
      runnerUp: 'consolation_cup_runner_up',
      winnerLabel: 'Consolation Cup Winner',
      ruLabel: 'Consolation Cup Runner-Up',
    },
  };

  const entries: PrizeEntry[] = [];

  for (const t of tournaments) {
    const prizeKeys = CUP_PRIZE_MAP[t.type];
    if (!prizeKeys) continue;

    // Find the final round (highest round_number)
    const { data: finalRound } = await admin
      .from('tournament_rounds')
      .select('id')
      .eq('tournament_id', t.id)
      .order('round_number', { ascending: false })
      .limit(1)
      .single();

    if (!finalRound) continue;

    // Find the completed final matchup
    const { data: finalMatchup } = await admin
      .from('tournament_matchups')
      .select('team_a_id, team_b_id, winner_id, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
      .eq('round_id', finalRound.id)
      .eq('status', 'completed')
      .limit(1)
      .single();

    if (!finalMatchup?.winner_id) continue;

    const loserId = finalMatchup.winner_id === finalMatchup.team_a_id
      ? finalMatchup.team_b_id
      : finalMatchup.team_a_id;

    const winnerName = (finalMatchup.winner_id === finalMatchup.team_a_id
      ? (finalMatchup.team_a as any)?.team_name
      : (finalMatchup.team_b as any)?.team_name) ?? 'Unknown';

    const loserName = (loserId === finalMatchup.team_a_id
      ? (finalMatchup.team_a as any)?.team_name
      : (finalMatchup.team_b as any)?.team_name) ?? 'Unknown';

    const winnerAmount = prizeConfig[prizeKeys.winner] ?? DEFAULT_PRIZE_CONFIG[prizeKeys.winner] ?? 0;
    const ruAmount = prizeConfig[prizeKeys.runnerUp] ?? DEFAULT_PRIZE_CONFIG[prizeKeys.runnerUp] ?? 0;

    entries.push({
      teamId: finalMatchup.winner_id,
      teamName: winnerName,
      prizeKey: prizeKeys.winner,
      prizeLabel: prizeKeys.winnerLabel,
      amount: winnerAmount,
    });

    if (loserId) {
      entries.push({
        teamId: loserId,
        teamName: loserName,
        prizeKey: prizeKeys.runnerUp,
        prizeLabel: prizeKeys.ruLabel,
        amount: ruAmount,
      });
    }
  }

  return entries;
}

/**
 * Distributes all prizes (season + cups) via the credit_faab_prize RPC.
 * Returns a summary of what was paid out.
 *
 * This is idempotent in spirit but NOT strictly protected from double-pays
 * since the transactions table doesn't enforce uniqueness on prize_payout.
 * The seasonReset should gate on `roster_locked` to prevent re-running.
 */
export async function distributeAllPrizes(
  admin: SupabaseClient,
  leagueId: string,
  seasonFrom: string,
): Promise<{ paid: PrizeEntry[]; totalFaab: number }> {
  // Fetch league prize config
  const { data: league, error: leagueErr } = await admin
    .from('leagues')
    .select('prize_config')
    .eq('id', leagueId)
    .single();

  if (leagueErr) throw new Error(`Failed to fetch league: ${leagueErr.message}`);
  const prizeConfig: PrizeConfig = (league?.prize_config as PrizeConfig) ?? DEFAULT_PRIZE_CONFIG;

  const seasonPrizes = await buildSeasonPrizes(admin, leagueId, prizeConfig);
  const cupPrizes = await buildCupPrizes(admin, leagueId, prizeConfig);
  const allPrizes = [...seasonPrizes, ...cupPrizes];

  for (const prize of allPrizes) {
    const { error } = await admin.rpc('credit_faab_prize', {
      p_team_id: prize.teamId,
      p_amount: prize.amount,
      p_prize_name: `${prize.prizeLabel} — ${seasonFrom}`,
      p_league_id: leagueId,
    });
    if (error) {
      throw new Error(`Failed to credit prize for ${prize.teamName} (${prize.prizeLabel}): ${error.message}`);
    }
  }

  const totalFaab = allPrizes.reduce((sum, p) => sum + p.amount, 0);
  return { paid: allPrizes, totalFaab };
}
