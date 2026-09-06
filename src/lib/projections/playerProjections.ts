/**
 * src/lib/projections/playerProjections.ts
 *
 * Calculates matchday projected points for an individual player given their
 * position, market value calibre, availability, and their club's fixture environment.
 *
 * Grounded in Gaffa's curved scoring engine (calculateFantasyPoints) and accounts
 * for non-linear minutes dampening and event bonuses.
 */

import type { GranularPosition } from '@/types';
import { GK_CURVE_SCALE } from '@/lib/scoring/matchRating';
import type { TeamMatchEnvironment } from './teamExpectations';

export interface PlayerProjectionInput {
  id?: string;
  primary_position: GranularPosition;
  market_value: number | null;
  fpl_status?: string | null;
  minutesRole?: string;
  priorP90?: number | null;
}

const DEFENSIVE_POSITIONS = new Set<GranularPosition>(['GK', 'CB', 'LB', 'RB', 'LWB', 'RWB']);
const FULLBACK_POSITIONS = new Set<GranularPosition>(['LB', 'RB', 'LWB', 'RWB']);

/**
 * Estimates expected minutes based on FPL availability status and Futbolpedia role.
 */
export function estimateExpectedMinutes(
  status: string | null | undefined,
  minutesRole: string | undefined,
  marketValue: number | null,
): number {
  const code = (status ?? 'a').toLowerCase();
  // Injured, suspended, or inactive
  if (code === 'i' || code === 's' || code === 'u' || code === 'n') return 0;

  let baseMinutes = 72;
  if (minutesRole === 'nailed') baseMinutes = 84;
  else if (minutesRole === 'likely_starter') baseMinutes = 74;
  else if (minutesRole === 'rotation_risk') baseMinutes = 38;
  else if (minutesRole === 'fringe') baseMinutes = 15;
  else if (marketValue != null && marketValue >= 35) baseMinutes = 82;
  else if (marketValue != null && marketValue >= 15) baseMinutes = 72;
  else baseMinutes = 45;

  // Doubtful status (75% or 50% chance of playing)
  if (code === 'd') baseMinutes *= 0.5;

  return baseMinutes;
}

/**
 * Calculates projected fantasy points for a single player in a specific match.
 */
export function calculatePlayerProjectedPoints(
  player: PlayerProjectionInput,
  fixtureEnv: TeamMatchEnvironment,
): number {
  const expMinutes = estimateExpectedMinutes(player.fpl_status, player.minutesRole, player.market_value);
  if (expMinutes <= 0) return 0.0;

  const pos = player.primary_position;
  const isGk = pos === 'GK';
  const isDef = DEFENSIVE_POSITIONS.has(pos);

  // Calibre normalizer (0.10 to 1.00) based on Transfermarkt valuation
  const mv = player.market_value ?? 15;
  const calibre = Math.min(1.0, Math.max(0.1, mv / 100));

  // Goal and assist shares by position and calibre
  let xgShare = 0.03;
  let xaShare = 0.03;

  if (pos === 'ST') {
    xgShare = 0.28 + 0.18 * calibre; // 0.30 to 0.46
    xaShare = 0.06 + 0.05 * calibre;
  } else if (pos === 'LW' || pos === 'RW') {
    xgShare = 0.18 + 0.14 * calibre;
    xaShare = 0.15 + 0.13 * calibre;
  } else if (pos === 'AM') {
    xgShare = 0.14 + 0.16 * calibre;
    xaShare = 0.16 + 0.14 * calibre;
  } else if (pos === 'CM') {
    xgShare = 0.06 + 0.06 * calibre;
    xaShare = 0.10 + 0.08 * calibre;
  } else if (pos === 'DM') {
    xgShare = 0.03 + 0.03 * calibre;
    xaShare = 0.05 + 0.05 * calibre;
  } else if (FULLBACK_POSITIONS.has(pos)) {
    xgShare = 0.02 + 0.03 * calibre;
    xaShare = 0.08 + 0.10 * calibre;
  } else if (pos === 'CB') {
    xgShare = 0.02 + 0.02 * calibre;
    xaShare = 0.01 + 0.02 * calibre;
  } else if (isGk) {
    xgShare = 0.0;
    xaShare = 0.0;
  }

  const pXg = fixtureEnv.expectedGoals * xgShare;
  const pXa = fixtureEnv.expectedGoals * xaShare;

  // Base rating for standard appearance before goals/assists/clean sheets
  let baseRating = 6.15 + 0.35 * calibre;
  if (pos === 'CB' || FULLBACK_POSITIONS.has(pos)) {
    // Defenders earn reliable volume from CBI, tackles, and recoveries in Gaffa
    baseRating = 6.25 + 0.25 * calibre;
  } else if (isGk) {
    baseRating = 6.20 + 0.20 * calibre;
  }

  // Add expected match impact
  let expRating = baseRating + pXg * 0.95 + pXa * 0.50;

  if (isDef) {
    // Clean sheet adds match impact and defensive flex score
    expRating += fixtureEnv.cleanSheetProb * 0.85;
    // Conceding heavily (xGA > 1.0) dings match impact
    const excessConceded = Math.max(0, fixtureEnv.expectedConceded - 1.0);
    expRating -= excessConceded * 0.35;
  }

  // Linear map display rating -> scoring scale rating (1 + 9 * composite)
  const composite = (expRating - 3.5) / 6.0;
  const scoringRating = 1.0 + 9.0 * Math.max(0, Math.min(1.0, composite));

  let curvePoints = 0;
  if (scoringRating > 4.0) {
    curvePoints = 8.6 * Math.pow((scoringRating - 4.0) / 2.0, 1.5);
  }

  // Flat bonuses (land after the curve, matching Gaffa's scoring engine)
  let flatBonuses = 0;
  if (isDef) {
    // 4.0 flat clean sheet bonus multiplied by probability
    flatBonuses += fixtureEnv.cleanSheetProb * 4.0;
  }

  // Convexity upside bonus: captures multi-goal games that spike into 8.5+ ratings
  if (pXg > 0.25) {
    flatBonuses += Math.pow(pXg, 1.4) * 3.8;
  }
  if (pXa > 0.25) {
    flatBonuses += Math.pow(pXa, 1.4) * 1.8;
  }

  if (isGk) {
    curvePoints *= GK_CURVE_SCALE;
  }

  // Minutes dampener: non-linear scaling penalizes sub appearances under 45 mins
  const minsRatio = expMinutes / 90;
  const minsFactor = Math.pow(minsRatio, 1.25);

  const total = (curvePoints + flatBonuses) * minsFactor;
  return Number(Math.max(0, total).toFixed(1));
}
