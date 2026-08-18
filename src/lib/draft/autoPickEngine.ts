/**
 * Shared bot decision-making for auto-drafting — used by the mock draft
 * simulator (client-side) and mirrored in
 * `auto_pick_expired_drafts()` (supabase/migrations/089_autopick_stats_weighting.sql)
 * for the real draft's timeout/autopilot auto-picks. Keep the two in sync if
 * either changes.
 *
 * Philosophy:
 * - Early picks are Best Player Available (quality-heavy). Forcing a GK at #1
 *   just because the roster has zero GKs is wrong — that's how Donnarumma was
 *   going first overall.
 * - Need weight ramps up as a team's roster fills, so late picks fill holes.
 * - Quality = 55% market value + 45% season stats (total points & PPG), each
 *   as a percentile within the candidate pool so the scales combine cleanly.
 */

import type { GranularPosition } from '@/types';

export type PositionCategory = 'GK' | 'DEF' | 'MID' | 'FWD';

const DEF_POSITIONS: GranularPosition[] = ['CB', 'LB', 'RB', 'LWB', 'RWB'];
const MID_POSITIONS: GranularPosition[] = ['DM', 'CM', 'AM'];
const FWD_POSITIONS: GranularPosition[] = ['LW', 'RW', 'ST'];

export function categoryOf(position: GranularPosition): PositionCategory {
  if (position === 'GK') return 'GK';
  if (DEF_POSITIONS.includes(position)) return 'DEF';
  if (MID_POSITIONS.includes(position)) return 'MID';
  return 'FWD';
}

export type PositionCounts = Partial<Record<GranularPosition, number>>;

export interface DraftCandidate {
  id: string;
  primaryPosition: GranularPosition;
  marketValue: number | null;
  totalPoints: number | null;
  ppg: number | null;
}

export interface ScoredDraftCandidate extends DraftCandidate {
  /** 0-100 blend of market value (55%) and season stats — total points & PPG averaged (45%). */
  qualityScore: number;
}

export function picksMade(counts: PositionCounts): number {
  return Object.values(counts).reduce((sum, n) => sum + (n ?? 0), 0);
}

// Percentile rank (0-1) of each value within the full array, ties sharing the
// lower rank — matches SQL PERCENT_RANK() semantics closely enough for a
// practice-mode heuristic.
function percentileRanks(values: number[]): number[] {
  const n = values.length;
  if (n <= 1) return values.map(() => 0);
  const sorted = [...values].sort((a, b) => a - b);
  return values.map((v) => {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid] < v) lo = mid + 1;
      else hi = mid;
    }
    return lo / (n - 1);
  });
}

/**
 * Precompute a static quality score for the whole draftable pool. Value/stats
 * percentiles don't shift as picks happen, so this only needs to run once per
 * mock draft session rather than on every pick.
 */
export function scoreDraftPool(candidates: DraftCandidate[]): ScoredDraftCandidate[] {
  const values = candidates.map((c) => c.marketValue ?? 0);
  const points = candidates.map((c) => c.totalPoints ?? 0);
  const ppgs = candidates.map((c) => c.ppg ?? 0);

  const valuePct = percentileRanks(values);
  const pointsPct = percentileRanks(points);
  const ppgPct = percentileRanks(ppgs);

  return candidates.map((c, i) => {
    const statsPct = (pointsPct[i] + ppgPct[i]) / 2;
    const qualityScore = 0.55 * (valuePct[i] * 100) + 0.45 * (statsPct * 100);
    return { ...c, qualityScore };
  });
}

/**
 * Positional need score (0-90). Hard-caps a category once a roster has
 * enough of it (GK max 2; DEF/MID capped ~33% of roster; FWD ~27%).
 *
 * GK with zero on the roster is deliberately mild early and escalates as the
 * team drafts other positions without a keeper — so #1 overall is never a GK
 * just because the sheet is empty.
 */
export function needScore(
  primaryPosition: GranularPosition,
  counts: PositionCounts,
  rosterSize: number,
): number {
  const category = categoryOf(primaryPosition);
  const made = picksMade(counts);
  const gkCount = counts.GK ?? 0;

  if (category === 'GK') {
    if (gkCount >= 2) return 0;
    if (gkCount === 0) {
      // Pick 0: 25 · pick 4: 57 · pick 8+: 90
      return Math.min(90, 25 + made * 8);
    }
    return 20;
  }

  if (category === 'DEF') {
    const defCount = DEF_POSITIONS.reduce((sum, p) => sum + (counts[p] ?? 0), 0);
    if (defCount >= Math.ceil(rosterSize * 0.33)) return 0;
  } else if (category === 'MID') {
    const midCount = MID_POSITIONS.reduce((sum, p) => sum + (counts[p] ?? 0), 0);
    if (midCount >= Math.ceil(rosterSize * 0.33)) return 0;
  } else {
    const fwdCount = FWD_POSITIONS.reduce((sum, p) => sum + (counts[p] ?? 0), 0);
    if (fwdCount >= Math.ceil(rosterSize * 0.27)) return 0;
  }

  const own = counts[primaryPosition] ?? 0;
  return Math.max(10, 80 - own * 25);
}

/**
 * Need vs quality blend. Early picks are BPA (quality-heavy); need weight
 * ramps as the roster fills so later picks plug holes.
 *   picksMade 0 → need 0.25 / quality 0.75
 *   picksMade 6 → need 0.55 / quality 0.45 (capped)
 */
type NeedQualityWeights = { needWeight: number; qualityWeight: number };

export function needQualityWeights(counts: PositionCounts): NeedQualityWeights {
  const made = picksMade(counts);
  const needWeight = Math.min(0.55, 0.25 + made * 0.05);
  return { needWeight, qualityWeight: 1 - needWeight };
}

/**
 * Picks the best available candidate for a team on the clock. Falls back to
 * the single best quality score if every position category is currently capped.
 */
export function pickBestCandidate(
  candidates: ScoredDraftCandidate[],
  counts: PositionCounts,
  rosterSize: number,
): ScoredDraftCandidate | null {
  const { needWeight, qualityWeight } = needQualityWeights(counts);
  let best: ScoredDraftCandidate | null = null;
  let bestComposite = -1;

  for (const c of candidates) {
    const need = needScore(c.primaryPosition, counts, rosterSize);
    if (need === 0) continue;
    const composite = need * needWeight + c.qualityScore * qualityWeight;
    if (composite > bestComposite) {
      bestComposite = composite;
      best = c;
    }
  }

  if (!best) {
    for (const c of candidates) {
      if (!best || c.qualityScore > best.qualityScore) best = c;
    }
  }

  return best;
}
