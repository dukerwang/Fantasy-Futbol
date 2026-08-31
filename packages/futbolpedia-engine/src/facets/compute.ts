import type { OutlookCareerPhase } from '../types/outlook';
import type {
  DynastyValue,
  FacetInputs,
  FallbackFacets,
  MinutesRole,
  MinutesSample,
  RiskFlag,
  SetPieceDuty,
} from './types';

/**
 * Thresholds live here, named, so they can be argued with.
 *
 * These drive the FALLBACK read — the answer for a player with no outlook yet.
 * When an outlook exists, Futbolpedia's judgment wins and these values are only
 * evidence handed to it.
 */
export const FACET_THRESHOLDS = {
  /** Start share (starts ÷ team matches) boundaries for minutes_role. */
  nailed: 0.75,
  likelyStarter: 0.5,
  rotationRisk: 0.2,


  /**
   * Team matches before the current season can speak for itself. Under this,
   * the prior season is blended in proportionally — at gameweek 2 a player has
   * two starts or none, and neither says anything about his role.
   */
  currentSeasonConfidenceMatches: 6,

  /**
   * Share of his club's matches he must have appeared in before a high
   * start-rate counts. Without it, a player who appeared five times and started
   * all five would read "nailed" off a five-match career.
   */
  availabilityFloor: 0.25,

  /** Gameweeks missed through injury before the injury_prone pattern applies. */
  injuryProneGameweeks: 6,

  /** A set-piece order at or below this counts as a real duty. */
  setPieceOrder: 2,
} as const;

/** Share of his APPEARANCES that were starts — role, independent of fitness. */
function roleShare(sample: MinutesSample | null): number | null {
  if (!sample || sample.appearances <= 0) return null;
  return sample.starts / sample.appearances;
}

/** Share of his club's matches he appeared in at all — fitness and selection. */
function availabilityShare(sample: MinutesSample | null): number | null {
  if (!sample || sample.team_matches <= 0) return null;
  return Math.min(sample.appearances / sample.team_matches, 1);
}

function blend(
  inputs: FacetInputs,
  pick: (s: MinutesSample | null) => number | null,
): number | null {
  const cur = pick(inputs.current);
  const prior = pick(inputs.prior);
  if (cur == null) return prior;
  if (prior == null) return cur;
  const played = inputs.current?.team_matches ?? 0;
  const w = Math.min(played / FACET_THRESHOLDS.currentSeasonConfidenceMatches, 1);
  return cur * w + prior * (1 - w);
}

/**
 * Blend the current season against the prior one by how far the current season
 * has actually run. Full weight once the club has played
 * `currentSeasonConfidenceMatches`; before that the prior season carries the
 * remainder. With only one sample available, that sample is the answer.
 */
export function resolveRoleShare(inputs: FacetInputs): number | null {
  return blend(inputs, roleShare);
}

export function resolveAvailabilityShare(inputs: FacetInputs): number | null {
  return blend(inputs, availabilityShare);
}

export function computeMinutesRole(inputs: FacetInputs): MinutesRole {
  const role = resolveRoleShare(inputs);
  // No sample at all reads as fringe rather than nailed: an unknown player has
  // not shown he starts, and the optimistic default is the harmful one here.
  if (role == null) return 'fringe';

  let level: MinutesRole =
    role >= FACET_THRESHOLDS.nailed
      ? 'nailed'
      : role >= FACET_THRESHOLDS.likelyStarter
        ? 'likely_starter'
        : role >= FACET_THRESHOLDS.rotationRisk
          ? 'rotation_risk'
          : 'fringe';

  // A high start rate off a handful of appearances is not evidence of a role.
  const availability = resolveAvailabilityShare(inputs);
  if (availability != null && availability < FACET_THRESHOLDS.availabilityFloor) {
    if (level === 'nailed' || level === 'likely_starter') level = 'rotation_risk';
  }
  return level;
}

/**
 * Age bands, with one override that matters: a thirty-something still starting
 * every week is on a plateau, not declining. Tarkowski at 33 played 3,330
 * minutes in 2025-26 — calling that decline_risk on age alone would be wrong.
 */
/**
 * Age bands per position, because footballers do not peak at one age.
 * Goalkeepers and centre-backs mature late and last; wingers and attacking
 * midfielders arrive early and decline earlier. Flat bands called Saliba "peak"
 * at 25, when a centre-back at 25 still has his best years in front of him.
 *
 * `emergingMax` is the last age still counted as ascending; `peakMax` the last
 * at peak; `plateauMax` the last before decline is the default read.
 */
const AGE_BANDS: Record<string, { emergingMax: number; peakMax: number; plateauMax: number }> = {
  GK:  { emergingMax: 24, peakMax: 33, plateauMax: 36 },
  CB:  { emergingMax: 25, peakMax: 31, plateauMax: 34 },
  LB:  { emergingMax: 24, peakMax: 30, plateauMax: 33 },
  RB:  { emergingMax: 24, peakMax: 30, plateauMax: 33 },
  LWB: { emergingMax: 24, peakMax: 30, plateauMax: 33 },
  RWB: { emergingMax: 24, peakMax: 30, plateauMax: 33 },
  DM:  { emergingMax: 24, peakMax: 31, plateauMax: 34 },
  CM:  { emergingMax: 24, peakMax: 30, plateauMax: 33 },
  AM:  { emergingMax: 24, peakMax: 29, plateauMax: 32 },
  LW:  { emergingMax: 23, peakMax: 29, plateauMax: 32 },
  RW:  { emergingMax: 23, peakMax: 29, plateauMax: 32 },
  ST:  { emergingMax: 24, peakMax: 30, plateauMax: 33 },
};

export function computeCareerPhase(inputs: FacetInputs): OutlookCareerPhase {
  const age = inputs.age;
  if (age == null) return 'unknown';

  const band = AGE_BANDS[inputs.primary_position] ?? AGE_BANDS.CM;
  const role = resolveRoleShare(inputs);
  // A veteran who is genuinely still ever-present is on a plateau, not
  // declining. Tarkowski at 33 played 3,330 minutes last season.
  const entrenched = role != null && role >= FACET_THRESHOLDS.nailed;

  if (age <= band.emergingMax) return 'emerging';
  if (age <= band.peakMax) return 'peak';
  if (age <= band.plateauMax) return 'plateau';
  return entrenched ? 'plateau' : 'decline_risk';
}

export function computeDynastyValue(
  inputs: FacetInputs,
  minutesRole: MinutesRole,
  phase: OutlookCareerPhase,
): DynastyValue {
  const age = inputs.age;
  // Age is deliberately NOT re-tested here. computeCareerPhase already decided
  // whether a thirty-something is declining or merely plateauing, and testing
  // age again overrode it — Tarkowski came out nailed and plateau but
  // declining_asset, two facets contradicting each other on the same player.
  // An entrenched veteran is a win-now asset, not a declining one.
  if (phase === 'decline_risk') return 'declining_asset';
  if (age == null) return 'win_now';

  // Minutes alone, at this layer. Quality is Futbolpedia's call, and guessing
  // it from output would repeat the mistake that labelled Saliba "limited".
  if (age <= 26 && minutesRole === 'nailed') return 'cornerstone';
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
    const role = resolveRoleShare(inputs);
    if (role != null && role < FACET_THRESHOLDS.nailed) flags.push('minutes_competition');
  }

  if (inputs.contract_year) flags.push('contract_year');

  return flags;
}

/**
 * The fact-only read of a player, for the two jobs facts are good at:
 * standing in for a player who has no outlook yet, and being handed to
 * synthesis as evidence. It carries no quality judgment — that is the whole
 * point of the split.
 */
export function computeFallbackFacets(inputs: FacetInputs): FallbackFacets {
  const minutes_role = computeMinutesRole(inputs);
  const career_phase = computeCareerPhase(inputs);

  return {
    minutes_role,
    career_phase,
    dynasty_value: computeDynastyValue(inputs, minutes_role, career_phase),
    set_pieces: computeSetPieces(inputs),
    risk_flags: computeRiskFlags(inputs, minutes_role),
  };
}

const DUTY_LABEL: Record<SetPieceDuty, string> = {
  penalties: 'first-choice penalties',
  direct_free_kicks: 'direct free kicks',
  corners_wide: 'corners and wide set pieces',
};

/**
 * Render the computed facts for the synthesis prompt.
 *
 * These go in as LOCKED FACTS, not as conclusions: the model is told what he
 * plays, how often, and what he takes, then makes the football judgment itself.
 * Passing them also stops it spending a grounded search call rediscovering what
 * FPL already publishes.
 */
export function buildComputedFactsBlock(inputs: FacetInputs): string {
  const role = resolveRoleShare(inputs);
  const availability = resolveAvailabilityShare(inputs);
  const duties = computeSetPieces(inputs);
  const sample = inputs.current ?? inputs.prior;

  const lines = [
    '=== MEASURED PLAYING RECORD (fact — do not contradict) ===',
    sample
      ? `Sample: ${sample.starts} starts from ${sample.appearances} appearances, of ${sample.team_matches} club matches`
      : 'Sample: no recorded appearances',
    role != null
      ? `Started ${Math.round(role * 100)}% of the matches he appeared in`
      : 'Start rate: unknown',
    availability != null
      ? `Appeared in ${Math.round(availability * 100)}% of his club's matches`
      : 'Availability: unknown',
    `Set-piece duty per the official list: ${duties.length ? duties.map((d) => DUTY_LABEL[d]).join(', ') : 'none listed'}`,
    inputs.xgi_percentile != null
      ? `Expected goal involvement per 90 ranks in the ${Math.round(inputs.xgi_percentile * 100)}th percentile among players in his position group`
      : 'Expected goal involvement per 90: not enough minutes to rank',
    '',
    'Read these as evidence, not as a verdict. A low expected-goal-involvement',
    'rank is normal and uninformative for a defender or goalkeeper — judge his',
    'quality on what the position is actually for.',
  ];
  return lines.join('\n');
}
