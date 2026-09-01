import type { GranularPosition, OutlookCareerPhase } from '../types/outlook';

/**
 * The facet vocabulary — closed enums shared by two producers.
 *
 * **Futbolpedia judges them.** These are scout calls, and the numbers are a poor
 * proxy for them rather than a cheap version of them. Trying to calculate them
 * failed in a way worth remembering: ranking a centre-back on xGI called Saliba
 * "limited", and switching to defensive volume put him in the 34th percentile
 * among defenders, below Dunk, because an elite defender in a dominant side
 * makes FEWER defensive actions. No free statistic separates that from being
 * mediocre. A scout answers it in one sentence.
 *
 * **The computed layer is now the input, not the answer.** Facts — set-piece
 * order, starts, appearances, minutes, availability, age, xG — are calculated
 * and handed to synthesis as locked context, so the judgment is made with them
 * in hand rather than in place of them. `computeFallbackFacets` also stands in
 * for the players who have no outlook yet, flagged low confidence, because a
 * computed guess is exactly what that is.
 *
 * The enums stay closed either way: that was always the fix for the 158-tag
 * sprawl, and it is what the index filters and card chips are built on.
 */

/** How good he actually is, at his position. Position-agnostic on purpose. */
export type QualityTier = 'elite' | 'high' | 'solid' | 'squad';

/** How securely he holds a starting place when available. */
export type MinutesRole = 'nailed' | 'likely_starter' | 'rotation_risk' | 'fringe';

/** Multi-year asset read. Gaffa is a dynasty league, so this is explicit. */
export type DynastyValue = 'cornerstone' | 'long_term_hold' | 'win_now' | 'declining_asset';

/** Premier League roster mobility — a PL exit ends eligibility outright. */
export type PlMobility =
  | 'stable'
  | 'recent_pl_arrival'
  | 'linked_exit'
  | 'confirmed_exit'
  | 'linked_pl_move'
  | 'unknown';

export type RiskFlag =
  | 'injury_prone'
  | 'minutes_competition'
  | 'contract_year'
  | 'tactical_misfit';

/**
 * Set-piece duty. The one facet that stays a pure computed FACT: FPL publishes
 * the hierarchy authoritatively, so having the model search for who takes the
 * penalties would be slower, less reliable and billed.
 */
export type SetPieceDuty = 'penalties' | 'direct_free_kicks' | 'corners_wide';

/**
 * Bounded archetype vocabulary — display-only chips, never a filter facet.
 * Twenty values, drawn from what the free-text runs actually produced.
 */
export const OUTLOOK_STYLES = [
  'ball_playing_cb',
  'stopper',
  'aerial_threat',
  'sweeper_keeper',
  'shot_stopper',
  'overlapping_fullback',
  'inverted_fullback',
  'deep_playmaker',
  'ball_winner',
  'box_to_box',
  'press_resistant',
  'tempo_controller',
  'creative_hub',
  'second_striker',
  'target_man',
  'poacher',
  'inverted_winger',
  'direct_winger',
  'transition_threat',
  'pressing_forward',
] as const;

export type OutlookStyle = (typeof OUTLOOK_STYLES)[number];

/**
 * Which archetypes a position may be given.
 *
 * Without this every player was offered all twenty, and a right-back came back
 * tagged `ball_playing_cb` — a position he does not hold in Gaffa. The prompt
 * also claimed to supply "the list" and never did, so the model was choosing
 * from the response schema's enum with no guidance at all.
 */
export const STYLES_BY_POSITION: Record<string, readonly OutlookStyle[]> = {
  GK: ['shot_stopper', 'sweeper_keeper'],
  CB: ['ball_playing_cb', 'stopper', 'aerial_threat', 'press_resistant'],
  LB: ['overlapping_fullback', 'inverted_fullback', 'transition_threat', 'press_resistant'],
  RB: ['overlapping_fullback', 'inverted_fullback', 'transition_threat', 'press_resistant'],
  LWB: ['overlapping_fullback', 'inverted_fullback', 'transition_threat', 'press_resistant'],
  RWB: ['overlapping_fullback', 'inverted_fullback', 'transition_threat', 'press_resistant'],
  DM: ['ball_winner', 'deep_playmaker', 'tempo_controller', 'press_resistant', 'box_to_box', 'aerial_threat'],
  CM: ['box_to_box', 'deep_playmaker', 'tempo_controller', 'press_resistant', 'ball_winner', 'creative_hub'],
  AM: ['creative_hub', 'deep_playmaker', 'second_striker', 'transition_threat', 'tempo_controller', 'press_resistant'],
  LW: ['inverted_winger', 'direct_winger', 'transition_threat', 'pressing_forward', 'creative_hub'],
  RW: ['inverted_winger', 'direct_winger', 'transition_threat', 'pressing_forward', 'creative_hub'],
  ST: ['target_man', 'poacher', 'second_striker', 'pressing_forward', 'aerial_threat', 'transition_threat'],
};

/** Archetypes valid for a player, primary plus any secondary positions. */
export function stylesFor(
  primary: string,
  secondary: readonly string[] = [],
): readonly OutlookStyle[] {
  const set = new Set<OutlookStyle>();
  for (const pos of [primary, ...secondary]) {
    for (const style of STYLES_BY_POSITION[pos] ?? []) set.add(style);
  }
  return set.size > 0 ? [...set] : OUTLOOK_STYLES;
}

/** Display labels. Football terms carry their own capitalisation. */
export const STYLE_LABEL: Record<OutlookStyle, string> = {
  ball_playing_cb: 'Ball-Playing CB',
  stopper: 'Stopper',
  aerial_threat: 'Aerial Threat',
  sweeper_keeper: 'Sweeper Keeper',
  shot_stopper: 'Shot Stopper',
  overlapping_fullback: 'Overlapping Fullback',
  inverted_fullback: 'Inverted Fullback',
  deep_playmaker: 'Deep Playmaker',
  ball_winner: 'Ball Winner',
  box_to_box: 'Box-to-Box',
  press_resistant: 'Press-Resistant',
  tempo_controller: 'Tempo Controller',
  creative_hub: 'Creative Hub',
  second_striker: 'Second Striker',
  target_man: 'Target Man',
  poacher: 'Poacher',
  inverted_winger: 'Inverted Winger',
  direct_winger: 'Direct Winger',
  transition_threat: 'Transition Threat',
  pressing_forward: 'Pressing Forward',
};

/** The judged facets, as they land in the sidecar. */
export interface JudgedFacets {
  quality: QualityTier;
  minutes_role: MinutesRole;
  career_phase: OutlookCareerPhase;
  dynasty_value: DynastyValue;
  pl_mobility: PlMobility;
  risk_flags: RiskFlag[];
  style: OutlookStyle[];
}

/** What the fact layer can produce on its own, as fallback or as prompt input. */
export interface FallbackFacets {
  minutes_role: MinutesRole;
  career_phase: OutlookCareerPhase;
  dynasty_value: DynastyValue;
  set_pieces: SetPieceDuty[];
  risk_flags: RiskFlag[];
}

/** One season's playing-time sample. */
export interface MinutesSample {
  starts: number;
  appearances: number;
  /** Matches the player's club has played that season — the denominator. */
  team_matches: number;
}

export interface FacetInputs {
  age: number | null;
  primary_position: GranularPosition;
  current: MinutesSample | null;
  prior: MinutesSample | null;

  /**
   * xGI/90 percentile WITHIN his position group, 0–1.
   *
   * Carried as a number, never as a verdict. Raw xGI/90 is nearly a pure
   * function of position (2025-26 medians: ATT 0.388, MID 0.208, DEF 0.112,
   * GK 0.002), and even ranked position-relative it says nothing about a
   * defender's quality. It is shown as a stat and passed to synthesis as
   * evidence — it is not a facet.
   */
  xgi_percentile: number | null;

  penalties_order: number | null;
  direct_fk_order: number | null;
  corners_order: number | null;

  /** Gameweeks missed through injury across the sample. Null when unknown. */
  injury_gameweeks: number | null;
  contract_year?: boolean;
}
