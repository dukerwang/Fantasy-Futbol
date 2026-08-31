import type { GranularPosition, OutlookCareerPhase } from '../types/outlook';

/**
 * Football-layer facets, COMPUTED from structured data rather than generated.
 *
 * The distinction that matters is derived-vs-raw, not Gaffa-vs-real-world.
 * Everything feeding these comes from real match data (FPL's bootstrap, per
 * gameweek stats, Transfermarkt valuations). Gaffa's own two derived columns —
 * `fantasy_points` and `match_rating` — are never inputs here, because a facet
 * carrying the Futbolpedia name must be a football judgment, not a statement
 * about how this league's point curve treats a position.
 *
 * A computed facet cannot hallucinate, and passing it to synthesis as a locked
 * fact also stops the model spending a search call rediscovering it.
 */

/** How securely the player holds a starting place. */
export type MinutesRole = 'nailed' | 'likely_starter' | 'rotation_risk' | 'fringe';

/** Share of his position's attacking output, measured against his own position. */
export type AttackingInvolvement =
  | 'primary_outlet'
  | 'secondary_threat'
  | 'limited'
  | 'peripheral';

/** Multi-year asset read. Gaffa is a dynasty league, so this is explicit rather than derived. */
export type DynastyValue = 'cornerstone' | 'long_term_hold' | 'win_now' | 'declining_asset';

/**
 * Set-piece duty, straight from FPL's own hierarchy.
 *
 * `aerial_target` was in the original facet proposal and is deliberately absent:
 * nothing in the free structured sources establishes it, and inferring it from
 * height and position would be a guess wearing a computed facet's clothes. It
 * belongs in `style`, which is search-derived and gated.
 */
export type SetPieceDuty = 'penalties' | 'direct_free_kicks' | 'corners_wide';

/** Durable risk patterns. `contract_year` is search-derived and merged in by the caller. */
export type RiskFlag = 'injury_prone' | 'minutes_competition' | 'contract_year';

export interface ComputedFacets {
  minutes_role: MinutesRole;
  attacking_involvement: AttackingInvolvement;
  career_phase: OutlookCareerPhase;
  dynasty_value: DynastyValue;
  set_pieces: SetPieceDuty[];
  risk_flags: RiskFlag[];
}

/** One season's playing-time sample. */
export interface MinutesSample {
  starts: number;
  appearances: number;
  /** Matches the player's club has played in that season — the denominator. */
  team_matches: number;
}

export interface FacetInputs {
  age: number | null;
  primary_position: GranularPosition;

  /** Current season to date. Null before a ball is kicked. */
  current: MinutesSample | null;
  /** Prior season, used while the current sample is too thin to mean anything. */
  prior: MinutesSample | null;

  /**
   * The player's xGI/90 percentile WITHIN HIS POSITION GROUP, 0–1.
   *
   * Position-relative on purpose. Raw xGI/90 is almost entirely a function of
   * position (2025-26 medians: ATT 0.388, MID 0.208, DEF 0.112, GK 0.002), so a
   * global threshold would re-encode the position filter and tell nobody
   * anything. The caller computes this across the pool.
   */
  xgi_percentile: number | null;

  /** FPL set-piece hierarchy. 1 is first choice; null means no listed duty. */
  penalties_order: number | null;
  direct_fk_order: number | null;
  corners_order: number | null;

  /** Gameweeks missed through injury across the sample, for the injury_prone pattern. */
  injury_gameweeks: number | null;

  /** Search-derived, merged rather than computed. */
  contract_year?: boolean;
}
