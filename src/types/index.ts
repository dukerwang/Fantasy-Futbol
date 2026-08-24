// ============================================================
// Gaffa — Core TypeScript Types
// ============================================================

// --- Granular Position System ---
export type GranularPosition = 'GK' | 'CB' | 'LB' | 'RB' | 'LWB' | 'RWB' | 'DM' | 'CM' | 'AM' | 'LW' | 'RW' | 'ST';

// Widens each flex-map entry to GranularPosition[] instead of the single-literal
// tuple type array literals would otherwise keep under `satisfies` — without this,
// indexing the map by a union-typed slot (as every caller does) infers `never` for
// element type and breaks `.includes()` at every call site.
const onlyPositions = (...positions: GranularPosition[]): GranularPosition[] => positions;

// Maps each formation slot to which player positions can fill it.
// Flexibility is intentionally strict — a slot only accepts its own position type.
// A player's ability to fill alternate slots comes from their secondary_positions (from SoFIFA),
// not from static inference rules.
export const POSITION_FLEX_MAP = {
  GK: onlyPositions('GK'),
  CB: onlyPositions('CB'),
  LB: onlyPositions('LB'),
  RB: onlyPositions('RB'),
  LWB: onlyPositions('LWB'),
  RWB: onlyPositions('RWB'),
  DM: onlyPositions('DM'),
  CM: onlyPositions('CM'),
  AM: onlyPositions('AM'),
  LW: onlyPositions('LW'),
  RW: onlyPositions('RW'),
  ST: onlyPositions('ST'),
} satisfies Record<GranularPosition, GranularPosition[]>;

// Share of their own points that an unused bench player who played contributes
// to the team total (see README § Matchups, docs/USER_GUIDE.md § 5).
//
// Lives here rather than in src/lib/scoring/matchups.ts because MatchupPitch is
// a client component and matchups.ts pulls in the scoring engine. It was
// previously written as a bare 0.20 in both the resolver and the UI, and the two
// had to be found and changed by hand together — a drift here shows managers a
// breakdown that doesn't add up to their score, so there is exactly one copy.
export const BENCH_DEPTH_BONUS = 0.25;

/** BENCH_DEPTH_BONUS rendered for UI copy, e.g. "25%". */
export const BENCH_DEPTH_BONUS_LABEL = `${Math.round(BENCH_DEPTH_BONUS * 100)}%`;

// Supported formations (slot lists)
// Slots are ordered left-to-right within each zone row for direct visual rendering.
export type Formation = '4-3-3' | '4-2-1-3' | '4-2-2-2' | '3-4-1-2' | '3-5-2' | '3-4-3' | '5-3-2' | '3-4-2-1' | '4-3-1-2' | '4-3-2-1';

export const FORMATION_SLOTS = {
  // Slots ordered left-to-right within each zone so PitchUI renders them correctly without re-sorting.
  '4-3-3': ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'DM', 'CM', 'LW', 'ST', 'RW'],
  // 4-2-1-3: double pivot (DM/DM) + central AM + wingers + ST
  '4-2-1-3': ['GK', 'LB', 'CB', 'CB', 'RB', 'DM', 'DM', 'LW', 'AM', 'ST', 'RW'],
  // 4-2-2-2: two DMs, two AMs, two STs (modern box midfield)
  '4-2-2-2': ['GK', 'LB', 'CB', 'CB', 'RB', 'DM', 'DM', 'AM', 'AM', 'ST', 'ST'],
  // 3-4-1-2: 3 CBs, 2 WBs, 2 CMs, 1 AM, 2 STs
  '3-4-1-2': ['GK', 'CB', 'CB', 'CB', 'LWB', 'CM', 'CM', 'RWB', 'AM', 'ST', 'ST'],
  // 3-5-2: 3 CBs, 2 WBs, 1 DM, 2 CMs, 2 STs
  '3-5-2': ['GK', 'CB', 'CB', 'CB', 'LWB', 'CM', 'DM', 'CM', 'RWB', 'ST', 'ST'],
  // 5-3-2: 3 CBs, 2 FBs, 3 CMs, 2 STs
  '5-3-2': ['GK', 'LB', 'CB', 'CB', 'CB', 'RB', 'CM', 'DM', 'CM', 'ST', 'ST'],
  // 3-4-3: 3 CBs, 2 WBs, 2 CMs, wingers + ST
  '3-4-3': ['GK', 'CB', 'CB', 'CB', 'LWB', 'CM', 'CM', 'RWB', 'LW', 'ST', 'RW'],
  // 3-4-2-1: 3-4-3 with the wingers swapped for two AMs
  '3-4-2-1': ['GK', 'CB', 'CB', 'CB', 'LWB', 'CM', 'CM', 'RWB', 'AM', 'AM', 'ST'],
  // 4-3-1-2: diamond midfield (DM, 2 CMs, AM) + 2 STs
  '4-3-1-2': ['GK', 'LB', 'CB', 'CB', 'RB', 'DM', 'CM', 'CM', 'AM', 'ST', 'ST'],
  // 4-3-2-1: Christmas tree — 4-3-3 with the wingers swapped for two AMs
  '4-3-2-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'DM', 'CM', 'AM', 'AM', 'ST'],
} satisfies Record<Formation, GranularPosition[]>;

export const ALL_FORMATIONS: Formation[] = Object.keys(FORMATION_SLOTS) as Formation[];

function sortedSlots(slots: GranularPosition[]): string {
  return JSON.stringify([...slots].sort());
}

/**
 * If a stored lineup's `formation` label disagrees with its starter slot multiset,
 * infer the closest matching formation (if any).
 */
export function inferFormationFromStarterSlots(
  starters: { slot: GranularPosition }[],
): Formation | null {
  const given = sortedSlots(starters.map((s) => s.slot));
  for (const f of ALL_FORMATIONS) {
    if (sortedSlots(FORMATION_SLOTS[f]) === given) return f;
  }
  return null;
}

// --- Database Types ---

export interface User {
  id: string;
  email: string;
  username: string;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface League {
  id: string;
  name: string;
  commissioner_id: string;
  season: string;
  max_teams: number;
  roster_size: number;
  bench_size: number;
  faab_budget: number;
  draft_type: 'snake' | 'auction';
  scoring_rules: ScoringRules;
  is_dynasty: boolean;
  status: 'setup' | 'drafting' | 'active' | 'completed';
  draft_scheduled_at: string | null;
  invite_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface ScoringRules {
  // Attacking
  goal: number;
  assist: number;
  shot_on_target: number;
  // Possession
  key_pass: number;
  big_chance_created: number;
  successful_dribble: number;
  pass_completion_tier_1: number; // e.g., 90%+ pass completion
  pass_completion_tier_2: number; // e.g., 80-89%
  // Defensive (per position tier)
  tackle_won: number;
  interception: number;
  clearance: number;
  clean_sheet_gk: number;
  clean_sheet_cb: number;
  clean_sheet_fb: number;
  clean_sheet_dm: number;
  // Negative
  yellow_card: number;
  red_card: number;
  own_goal: number;
  penalty_missed: number;
  // Goalkeeping
  save: number;
  penalty_save: number;
  goals_conceded_per_2: number; // points deducted per 2 goals conceded
  // Bonus
  minutes_played_60: number; // bonus for playing 60+ minutes
  minutes_played_45: number; // bonus for playing 45-59 minutes
}

export const DEFAULT_SCORING_RULES: ScoringRules = {
  goal: 6,
  assist: 4,
  shot_on_target: 1,
  key_pass: 2,
  big_chance_created: 3,
  successful_dribble: 1,
  pass_completion_tier_1: 2,
  pass_completion_tier_2: 1,
  tackle_won: 1,
  interception: 1,
  clearance: 0.5,
  clean_sheet_gk: 6,
  clean_sheet_cb: 5,
  clean_sheet_fb: 4,
  clean_sheet_dm: 2,
  yellow_card: -1,
  red_card: -3,
  own_goal: -2,
  penalty_missed: -2,
  save: 1,
  penalty_save: 5,
  goals_conceded_per_2: -1,
  minutes_played_60: 2,
  minutes_played_45: 1,
};

export interface Player {
  id: string;
  fpl_id: number | null;
  api_football_id: number | null;
  web_name: string | null;
  sofifa_common_name?: string | null;
  name: string;
  full_name: string | null;
  date_of_birth: string | null;
  nationality: string | null;
  pl_team: string; // e.g. "Arsenal", "Liverpool"
  pl_team_id: number | null;
  primary_position: GranularPosition;
  secondary_positions: GranularPosition[];
  market_value: number; // in millions EUR (from Transfermarkt)
  market_value_updated_at: string | null;
  adp: number | null;
  projected_points: number | null;
  photo_url: string | null;
  photo_version?: string | null; // cache-busts the photo URL when PL replaces the underlying image; see photo.ts
  portrait_head_top_pct?: number | null; // Portrait.tsx per-player crop correction; see portraitCrop.ts
  portrait_head_width_pct?: number | null;
  portrait_tall_head_top_pct?: number | null; // PremiumPlayerCard.tsx equivalent, tall 220x280 source
  portrait_tall_head_width_pct?: number | null;
  height_cm: number | null;
  fpl_status: string | null; // 'a'=available, 'i'=injured, 'd'=doubtful, 's'=suspended, 'u'=unavailable
  fpl_news: string | null;
  total_points: number | null; // custom scoring engine: SUM fantasy_points this season
  form: number | null;         // custom scoring engine: avg fantasy_points over last 5 GWs
  form_rating: number | null;  // custom match rating: avg match_rating over last 5 appearances
  ppg: number | null;          // custom scoring engine: total_points / matches_played
  is_active: boolean; // still in the PL
  transfermarkt_id: string | null;
  overall_rank?: number | null; // From player_rankings view
  position_ranks?: { position: string; rank: number }[] | null; // From player_rankings view
  isNewToPrem?: boolean; // Computed server-side: no player_season_clubs row for the prior season
  draftRank?: number; // Computed server-side per draft-pool load (loadDraftPool.ts) — a synthetic
                       // pre-draft ranking, not `adp` above (which is a real-historical-average
                       // concept, unpopulated, and unrelated to this).
  draftQualityScore?: number; // The 0-100 composite draftRank is sorted by (scoreDraftPool()) — the
                               // real draft room only needs draftRank, but the mock draft's bot
                               // reads this to blend with positional need per pick (pickBestCandidate()).
  created_at: string;
  updated_at: string;
}

export interface Team {
  id: string;
  league_id: string;
  user_id: string;
  team_name: string;
  faab_budget: number;
  total_points: number;
  draft_order: number | null;
  abbreviation: string | null;
  logo_url: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  user?: User;
}

export type RosterStatus = 'active' | 'bench' | 'ir' | 'taxi' | 'loan_in' | 'loan_out' | 'pending_activation';

export interface RosterEntry {
  id: string;
  team_id: string;
  player_id: string;
  status: RosterStatus;
  acquisition_type: 'draft' | 'waiver' | 'free_agent' | 'trade';
  acquisition_value: number | null; // FAAB bid or trade value
  acquired_at: string;
  // Joined fields
  player?: Player;
}

export interface Matchup {
  id: string;
  league_id: string;
  gameweek: number;
  team_a_id: string;
  team_b_id: string;
  score_a: number;
  score_b: number;
  lineup_a: MatchupLineup | null;
  lineup_b: MatchupLineup | null;
  status: 'scheduled' | 'live' | 'completed';
  created_at: string;
  // Joined fields
  team_a?: Team;
  team_b?: Team;
}

export interface MatchupLineup {
  formation: Formation;
  starters: { player_id: string; slot: GranularPosition }[];
  bench: { player_id: string; slot: BenchSlot }[]; // player_ids in priority order
}

export interface RawStats {
  // Minutes
  minutes_played: number;
  // Attacking
  goals: number;
  assists: number;
  shots_total: number;
  shots_on_target: number;
  // Possession
  passes_total: number;
  passes_accurate: number;
  pass_completion_pct: number;
  key_passes: number;
  big_chances_created: number;
  dribbles_attempted: number;
  dribbles_successful: number;
  // Defensive
  tackles_total: number;
  tackles_won: number;
  interceptions: number;
  clearances: number;
  blocks: number;
  // Goalkeeping
  saves: number;
  goals_conceded: number;
  penalty_saves: number;
  // Discipline
  yellow_cards: number;
  red_cards: number;
  own_goals: number;
  penalties_missed: number;
  // Computed/derived
  clean_sheet: boolean;
  // FPL live metrics (for match rating system)
  bps?: number;
  influence?: number;
  creativity?: number;
  threat?: number;
  ict_index?: number;
  expected_goals?: number;
  expected_assists?: number;
  expected_goals_conceded?: number;
  fpl_tackles?: number;
  fpl_cbi?: number;
  fpl_recoveries?: number;
  /**
   * FPL `defensive_contribution` — position-weighted defensive action count.
   * DEF: T+CBI; MID/FWD: T+CBI+R; GK: 0. Available from FPL live for 25/26+.
   * Use this as the primary defensive activity signal; the raw fields above
   * are retained for breakdown UI and historical compatibility.
   */
  fpl_def_contrib?: number;
}

export interface DraftPick {
  id: string;
  league_id: string;
  team_id: string;
  player_id: string;
  round: number;
  pick: number; // overall pick number (1-indexed)
  picked_at: string;
  // Joined fields
  player?: Player;
  team?: Team;
}

export type TradeProposalStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface TradeProposal {
  id: string;
  league_id: string;
  team_a_id: string;   // proposer
  team_b_id: string;   // receiver
  offered_players: string[];    // player IDs from team A
  requested_players: string[];  // player IDs from team B
  offered_rights: string[];     // departure_decisions IDs from team A — retained player rights
  requested_rights: string[];   // departure_decisions IDs from team B
  offered_faab: number;
  requested_faab: number;
  status: TradeProposalStatus;
  message: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  team_a?: Team;
  team_b?: Team;
}

export type BenchSlot = 'DEF' | 'MID' | 'ATT' | 'FLEX';

export const BENCH_FLEX_MAP = {
  DEF: onlyPositions('CB', 'LB', 'RB', 'LWB', 'RWB'),
  MID: onlyPositions('DM', 'CM', 'AM'),
  ATT: onlyPositions('ST', 'LW', 'RW'),
  /** True flex: any starter-eligible position including emergency GK. */
  FLEX: onlyPositions('CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST', 'GK'),
} satisfies Record<BenchSlot, GranularPosition[]>;

// Always returns the 4 semantic bench slots regardless of league bench_size setting
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function getExpectedBenchSlots(_benchSize?: number): BenchSlot[] {
  return ['DEF', 'MID', 'ATT', 'FLEX'];
}

export interface AuctionBid {
  team_name: string;
  faab_bid: number;
  created_at: string;
}

export interface AuctionListing {
  player: Player;
  expires_at: string;
  highest_bid: number;
  highest_bidder_team_name: string;
  highest_bidder_team_id: string | null;
  my_bid: number | null;
  my_drop_player_id: string | null;
  bid_count: number;
  bid_history: AuctionBid[];
  is_promoted_exclusive?: boolean;
  is_eligible?: boolean;
  /** Future ISO timestamp when a staggered kickoff auction opens; null means open now. */
  opens_at: string | null;
}



// ============================================================
// Match Rating System Types
// ============================================================

export type RatingComponent =
  | 'match_impact'
  | 'influence'
  | 'creativity'
  | 'threat'
  | 'defensive'
  | 'goal_involvement'
  | 'finishing'
  | 'save_score';

export const RATING_COMPONENTS: RatingComponent[] = [
  'match_impact', 'influence', 'creativity', 'threat',
  'defensive', 'goal_involvement', 'finishing', 'save_score',
];

export type PositionGroup = 'GK' | 'DEF' | 'MID' | 'ATT';

export interface RatingBreakdownItem {
  component: string;       // Display name
  key: RatingComponent;    // Machine key
  score: number;           // 0.0 – 1.0 (sigmoid-normalized)
  weight: number;          // 0.0 – 1.0 (position weight)
  weighted: number;        // score × weight
  detail: string;          // Human-readable detail string
}

export interface MatchRating {
  rating: number;          // 1.0 – 10.0
  fantasyPoints: number;
  position: GranularPosition;
  breakdown: RatingBreakdownItem[];
}

export interface ComponentRefStats {
  median: number;
  stddev: number;
}

/** Per-component median/stddev for sigmoid normalization. */
export type ReferenceStats = Record<RatingComponent, ComponentRefStats>;

// ============================================================
// Tournament Types (Phase 15)
// ============================================================

export type TournamentType = 'primary_cup' | 'secondary_cup' | 'consolation_cup';
export type TournamentStatus = 'pending' | 'active' | 'completed';
export type TournamentMatchupStatus = 'pending' | 'active' | 'completed';

export interface Tournament {
  id: string;
  league_id: string;
  name: string;
  type: TournamentType;
  status: TournamentStatus;
  season: string;
  created_at: string;
  updated_at: string;
}

export interface TournamentRound {
  id: string;
  tournament_id: string;
  name: string;
  round_number: number;
  start_gameweek: number;
  end_gameweek: number;
  is_two_leg: boolean;
  created_at: string;
  // Joined fields
  matchups?: TournamentMatchup[];
}

export interface TournamentMatchup {
  id: string;
  round_id: string;
  team_a_id: string | null;
  team_b_id: string | null;
  team_a_score_leg1: number;
  team_b_score_leg1: number;
  team_a_score_leg2: number;
  team_b_score_leg2: number;
  winner_id: string | null;
  next_matchup_id: string | null;
  bracket_position: number;
  status: TournamentMatchupStatus;
  created_at: string;
  // Joined fields
  team_a?: Team;
  team_b?: Team;
  winner?: Team;
}

/**
 * Shape of a single player element from FPL event/{gw}/live/ endpoint.
 * ICT metrics arrive as strings; callers must parseFloat.
 */
export interface FplLivePlayerStats {
  id: number;
  stats: {
    minutes: number;
    goals_scored: number;
    assists: number;
    clean_sheets: number;
    goals_conceded: number;
    own_goals: number;
    penalties_saved: number;
    penalties_missed: number;
    yellow_cards: number;
    red_cards: number;
    saves: number;
    bonus: number;
    bps: number;
    influence: string;
    creativity: string;
    threat: string;
    ict_index: string;
    expected_goals: string;
    expected_assists: string;
    expected_goals_conceded: string;
    // 25/26 — granular defensive fields.
    // `defensive_contribution` is FPL's position-weighted defensive action count:
    //   DEF: tackles + CBI
    //   MID/FWD: tackles + CBI + recoveries
    //   GK: always 0
    // Use it as the primary defensive activity signal; raw T/CBI/R are kept
    // for breakdown UI and any future use.
    tackles: number;
    clearances_blocks_interceptions: number;
    recoveries: number;
    defensive_contribution: number;
    expected_goal_involvements?: string;
    starts?: number;
  };
  explain: {
    fixture: number;
    stats: { identifier: string; value: number }[];
  }[];
}

export interface PlayerSeasonArchive {
  season: string;
  total_points: number;
  ppg: number;
  form_rating: number;
  overall_rank: number;
  position_ranks: { position: string; rank: number }[];
}

/** A fantasy club identified well enough to render its crest. */
export interface OwnerClub {
  teamId: string;
  teamName: string;
  abbreviation: string | null;
  crestConfig: unknown | null;
}

/**
 * Who holds a player in a given league. `owner` is the team that holds the
 * contract — during an active loan that stays with the lender, and
 * `loanedTo` names the borrower fielding him. Null means free agent.
 */
export interface PlayerOwnership {
  owner: OwnerClub;
  loanedTo: OwnerClub | null;
}

