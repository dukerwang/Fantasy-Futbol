import type { OutlookCareerPhase } from '../types/outlook';
import type {
  AttackingInvolvement,
  ComputedFacets,
  DynastyValue,
  FacetInputs,
  MinutesRole,
  MinutesSample,
  RiskFlag,
  SetPieceDuty,
} from './types';

/**
 * Thresholds live here, named, so they can be argued with.
 *
 * The minutes and involvement cuts were set against the 2025-26 pool (313
 * players above ten starts); the career cuts are age bands with one override.
 */
export const FACET_THRESHOLDS = {
  /** Start share (starts ÷ team matches) boundaries for minutes_role. */
  nailed: 0.75,
  likelyStarter: 0.5,
  rotationRisk: 0.2,

  /** Position-relative xGI/90 percentile boundaries for attacking_involvement. */
  primaryOutlet: 0.8,
  secondaryThreat: 0.5,
  limited: 0.2,

  /**
   * Team matches before the current season can speak for itself. Under this,
   * the prior season is blended in proportionally — at gameweek 2 a player has
   * two starts or none, and neither says anything about his role.
   */
  currentSeasonConfidenceMatches: 6,

  /** Gameweeks missed through injury before the injury_prone pattern applies. */
  injuryProneGameweeks: 6,

  /** A set-piece order at or below this counts as a real duty. */
  setPieceOrder: 2,
} as const;

/** Start share for one sample, or null when the sample cannot support one. */
function startShare(sample: MinutesSample | null): number | null {
  if (!sample || sample.team_matches <= 0) return null;
  return sample.starts / sample.team_matches;
}

/**
 * Blend the current season against the prior one by how far the current season
 * has actually run. Full weight once the club has played
 * `currentSeasonConfidenceMatches`; before that the prior season carries the
 * remainder. With only one sample available, that sample is the answer.
 */
export function resolveStartShare(inputs: FacetInputs): number | null {
  const cur = startShare(inputs.current);
  const prior = startShare(inputs.prior);

  if (cur == null) return prior;
  if (prior == null) return cur;

  const played = inputs.current?.team_matches ?? 0;
  const w = Math.min(played / FACET_THRESHOLDS.currentSeasonConfidenceMatches, 1);
  return cur * w + prior * (1 - w);
}

export function computeMinutesRole(inputs: FacetInputs): MinutesRole {
  const share = resolveStartShare(inputs);
  // No sample at all reads as fringe rather than nailed: an unknown player has
  // not shown he starts, and the optimistic default is the harmful one here.
  if (share == null) return 'fringe';
  if (share >= FACET_THRESHOLDS.nailed) return 'nailed';
  if (share >= FACET_THRESHOLDS.likelyStarter) return 'likely_starter';
  if (share >= FACET_THRESHOLDS.rotationRisk) return 'rotation_risk';
  return 'fringe';
}

export function computeAttackingInvolvement(inputs: FacetInputs): AttackingInvolvement {
  const p = inputs.xgi_percentile;
  if (p == null) return 'peripheral';
  if (p >= FACET_THRESHOLDS.primaryOutlet) return 'primary_outlet';
  if (p >= FACET_THRESHOLDS.secondaryThreat) return 'secondary_threat';
  if (p >= FACET_THRESHOLDS.limited) return 'limited';
  return 'peripheral';
}

/**
 * Age bands, with one override that matters: a thirty-something still starting
 * every week is on a plateau, not declining. Tarkowski at 33 played 3,330
 * minutes in 2025-26 — calling that decline_risk on age alone would be wrong.
 */
export function computeCareerPhase(inputs: FacetInputs): OutlookCareerPhase {
  const age = inputs.age;
  if (age == null) return 'unknown';

  const share = resolveStartShare(inputs);
  const entrenched = share != null && share >= FACET_THRESHOLDS.nailed;

  if (age <= 21) return 'emerging';
  if (age <= 24) return entrenched ? 'peak' : 'emerging';
  if (age <= 29) return 'peak';
  if (age <= 32) return 'plateau';
  return entrenched ? 'plateau' : 'decline_risk';
}

export function computeDynastyValue(
  inputs: FacetInputs,
  minutesRole: MinutesRole,
  involvement: AttackingInvolvement,
  phase: OutlookCareerPhase,
): DynastyValue {
  const age = inputs.age;
  if (phase === 'decline_risk') return 'declining_asset';
  if (age == null) return 'win_now';
  if (age >= 32) return 'declining_asset';

  const contributes = involvement === 'primary_outlet' || involvement === 'secondary_threat';
  if (age <= 26 && minutesRole === 'nailed' && contributes) return 'cornerstone';
  if (age <= 26) return 'long_term_hold';
  return 'win_now';
}

export function computeSetPieces(inputs: FacetInputs): SetPieceDuty[] {
  const duties: SetPieceDuty[] = [];
  const max = FACET_THRESHOLDS.setPieceOrder;
  // Penalties are the one duty where only first choice counts — a second-choice
  // penalty taker takes penalties roughly never.
  if (inputs.penalties_order === 1) duties.push('penalties');
  if (inputs.direct_fk_order != null && inputs.direct_fk_order <= max) {
    duties.push('direct_free_kicks');
  }
  if (inputs.corners_order != null && inputs.corners_order <= max) {
    duties.push('corners_wide');
  }
  return duties;
}

export function computeRiskFlags(inputs: FacetInputs, minutesRole: MinutesRole): RiskFlag[] {
  const flags: RiskFlag[] = [];

  if (
    inputs.injury_gameweeks != null &&
    inputs.injury_gameweeks >= FACET_THRESHOLDS.injuryProneGameweeks
  ) {
    flags.push('injury_prone');
  }

  // Genuinely contested, rather than simply not good enough: he plays often
  // enough to be in the picture but not often enough to be trusted.
  if (minutesRole === 'rotation_risk' || minutesRole === 'likely_starter') {
    const share = resolveStartShare(inputs);
    if (share != null && share < FACET_THRESHOLDS.nailed) flags.push('minutes_competition');
  }

  if (inputs.contract_year) flags.push('contract_year');

  return flags;
}

/** Every football-layer facet that can be computed instead of generated. */
export function computeFacets(inputs: FacetInputs): ComputedFacets {
  const minutes_role = computeMinutesRole(inputs);
  const attacking_involvement = computeAttackingInvolvement(inputs);
  const career_phase = computeCareerPhase(inputs);

  return {
    minutes_role,
    attacking_involvement,
    career_phase,
    dynasty_value: computeDynastyValue(inputs, minutes_role, attacking_involvement, career_phase),
    set_pieces: computeSetPieces(inputs),
    risk_flags: computeRiskFlags(inputs, minutes_role),
  };
}
