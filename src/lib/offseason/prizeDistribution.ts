/**
 * Gaffa — Prize Distribution
 *
 * Distributes end-of-season FAAB prizes to teams for:
 * - Regular season standings (exponential curve: €40m 1st → €20m last, N-team agnostic)
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

/**
 * Cup prize defaults — season standing prizes are computed dynamically
 * via computeSeasonPrize() and are not stored here.
 * Per-league overrides for any key (including season_Nth) live in leagues.prize_config.
 *
 * Rebalanced to the Prestige Tier. Champions Cup pays €50m (€20m runner-up)
 * to establish grand trophy prestige over 1st place placement (€40m), while
 * League Cup and Consolation Cup pay €25m (€10m runner-up).
 */
export const DEFAULT_PRIZE_CONFIG: PrizeConfig = {
  champions_cup_winner: 50,
  champions_cup_runner_up: 20,
  league_cup_winner: 25,
  league_cup_runner_up: 10,
  consolation_cup_winner: 25,
  consolation_cup_runner_up: 10,
};

/**
 * Endpoints of the end-of-season placement curve, in EUR m.
 *
 * These used to be 85 and 50, when this pool carried the entire merit load.
 * The merit component now arrives monthly during the season (see
 * src/lib/economy/meritPayments.ts), so what is left at the reset is mostly
 * central revenue with a modest tilt — hence a 2:1 ratio rather than
 * something steeper.
 *
 * Why not steeper: monthly merit already pays a champion ~EUR 75m against a
 * bottom club's ~EUR 41m. Stacking a 5:1 placement curve on top produces a
 * EUR 74m gap in total annual earnings, which compounds to EUR 370m over five
 * seasons in a league where money never resets. The Premier League's own
 * central distribution is mostly an equal share for the same reason; prestige
 * differentiation is carried by the cups, which are uncorrelated with league
 * position.
 */
export const SEASON_PRIZE_FIRST = 40;
export const SEASON_PRIZE_LAST = 20;

/**
 * Exponential prize curve for regular season standings.
 * Always returns SEASON_PRIZE_FIRST for 1st and SEASON_PRIZE_LAST for last,
 * regardless of league size.
 * Formula: FIRST × (LAST/FIRST)^((rank−1)/(N−1)), rounded to nearest integer.
 */
export function computeSeasonPrize(rank: number, totalTeams: number): number {
  if (totalTeams <= 1) return SEASON_PRIZE_FIRST;
  const t = (rank - 1) / (totalTeams - 1);
  return Math.round(SEASON_PRIZE_FIRST * Math.pow(SEASON_PRIZE_LAST / SEASON_PRIZE_FIRST, t));
}

function getOrdinalSuffix(i: number): string {
  const j = i % 10, k = i % 100;
  if (j === 1 && k !== 11) return i + 'st';
  if (j === 2 && k !== 12) return i + 'nd';
  if (j === 3 && k !== 13) return i + 'rd';
  return i + 'th';
}

function ordinalKey(rank: number): string {
  return `season_${getOrdinalSuffix(rank)}`;
}

function ordinalLabel(rank: number): string {
  return `${getOrdinalSuffix(rank)} Place (Regular Season)`;
}

/**
 * Builds the prize list for regular season standings.
 * Prize amounts follow an exponential curve (€40m 1st → €20m last) scaled to
 * however many teams are in the league. Per-league prize_config overrides
 * for individual rank keys are still respected.
 */
export async function buildSeasonPrizes(
  admin: SupabaseClient,
  leagueId: string,
  prizeConfig: PrizeConfig,
): Promise<PrizeEntry[]> {
  const { data: standings, error } = await admin
    .from('league_standings')
    .select('team_id, rank, team_name')
    .eq('league_id', leagueId)
    .order('rank', { ascending: true });

  if (error || !standings) throw new Error(`Failed to fetch standings: ${error?.message}`);

  const totalTeams = standings.length;
  const entries: PrizeEntry[] = [];

  for (const row of standings) {
    const rank = row.rank ?? 1;
    const key = ordinalKey(rank);
    const label = ordinalLabel(rank);
    // Per-league config can override any individual rank; otherwise use the curve.
    const amount = prizeConfig[key] ?? computeSeasonPrize(rank, totalTeams);

    entries.push({
      teamId: row.team_id,
      teamName: row.team_name ?? 'Unknown',
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
    const { data: finalRound, error: rErr } = await admin
      .from('tournament_rounds')
      .select('id')
      .eq('tournament_id', t.id)
      .order('round_number', { ascending: false })
      .limit(1)
      .single();

    if (rErr || !finalRound) continue;

    // Find the completed final matchup
    const { data: finalMatchup, error: mErr } = await admin
      .from('tournament_matchups')
      .select('team_a_id, team_b_id, winner_id, team_a:teams!team_a_id(team_name), team_b:teams!team_b_id(team_name)')
      .eq('round_id', finalRound.id)
      .eq('status', 'completed')
      .limit(1)
      .single();

    if (mErr || !finalMatchup?.winner_id) continue;

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
