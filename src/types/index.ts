// ============================================================
// Fantasy Futbol — Core TypeScript Types
// ============================================================

// --- Granular Position System ---
export type GranularPosition = 'GK' | 'CB' | 'LB' | 'RB' | 'DM' | 'CM' | 'LM' | 'RM' | 'AM' | 'LW' | 'RW' | 'ST';

// Maps each formation slot to which player positions can fill it.
// Flexibility is intentionally strict — a slot only accepts its own position type.
// A player's ability to fill alternate slots comes from their secondary_positions (from SoFIFA),
// not from static inference rules.
export const POSITION_FLEX_MAP: Record<GranularPosition, GranularPosition[]> = {
  GK: ['GK'],
  CB: ['CB'],
  LB: ['LB'],
  RB: ['RB'],
  DM: ['DM'],
  CM: ['CM'],
  LM: ['LM'],
  RM: ['RM'],
  AM: ['AM'],
  LW: ['LW'],
  RW: ['RW'],
  ST: ['ST'],
};

// Supported formations (slot lists)
// Slots are ordered left-to-right within each zone row for direct visual rendering.
export type Formation = '4-4-2' | '4-3-3' | '4-2-3-1' | '4-1-4-1' | '3-4-3' | '4-2-1-3';

export const FORMATION_SLOTS: Record<Formation, GranularPosition[]> = {
  // Slots ordered left-to-right within each zone so PitchUI renders them correctly without re-sorting.
  '4-4-2': ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'CM', 'RM', 'ST', 'ST'],
  '4-3-3': ['GK', 'LB', 'CB', 'CB', 'RB', 'CM', 'DM', 'CM', 'LW', 'ST', 'RW'],
  // 4-2-3-1: double pivot (DM/DM) + central AM + wide mids (LM/RM) + ST
  '4-2-3-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'DM', 'AM', 'DM', 'RM', 'ST'],
  '4-1-4-1': ['GK', 'LB', 'CB', 'CB', 'RB', 'LM', 'CM', 'DM', 'CM', 'RM', 'ST'],
  '3-4-3': ['GK', 'CB', 'CB', 'CB', 'LM', 'CM', 'CM', 'RM', 'LW', 'ST', 'RW'],
  // 4-2-1-3: two holders + a central 10 behind a front three
  '4-2-1-3': ['GK', 'LB', 'CB', 'CB', 'RB', 'DM', 'DM', 'AM', 'LW', 'ST', 'RW'],
};

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
  height_cm: number | null;
  fpl_status: string | null; // 'a'=available, 'i'=injured, 'd'=doubtful, 's'=suspended, 'u'=unavailable
  fpl_news: string | null;
  total_points: number | null; // custom scoring engine: SUM fantasy_points this season
  form: number | null;         // custom scoring engine: avg fantasy_points over last 3 GWs
  form_rating: number | null;  // custom match rating: avg match_rating over last 3 appearances
  ppg: number | null;          // custom scoring engine: total_points / matches_played
  is_active: boolean; // still in the PL
  transfermarkt_id: string | null;
  overall_rank?: number | null; // From player_rankings view
  position_ranks?: { position: string; rank: number }[] | null; // From player_rankings view
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
  created_at: string;
  updated_at: string;
  // Joined fields
  user?: User;
}

export type RosterStatus = 'active' | 'bench' | 'ir' | 'taxi';

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

export interface PlayerStats {
  id: string;
  player_id: string;
  match_id: number; // API-Football match ID
  gameweek: number;
  season: string;
  stats: RawStats;
  fantasy_points: number;
  match_rating?: number; // 1.0 – 10.0 (from match rating engine)
  created_at: string;
  // Joined fields
  player?: Player;
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
}

export type TransactionType =
  | 'waiver_claim'
  | 'free_agent_pickup'
  | 'drop'
  | 'trade'
  | 'transfer_compensation'
  | 'draft_pick';

export interface Transaction {
  id: string;
  league_id: string;
  team_id: string;
  player_id: string | null;
  type: TransactionType;
  faab_bid: number | null;
  compensation_amount: number | null;
  notes: string | null;
  processed_at: string;
  created_at: string;
  // Joined fields
  player?: Player;
  team?: Team;
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

export interface WaiverClaim {
  id: string;
  league_id: string;
  team_id: string;
  player_id: string; // player to add
  drop_player_id: string | null; // player to drop
  faab_bid: number;
  priority: number;
  status: 'pending' | 'approved' | 'rejected';
  gameweek: number;
  created_at: string;
}

// --- API Response Types ---

export interface ApiFootballFixture {
  fixture: {
    id: number;
    date: string;
    status: { short: string; elapsed: number | null };
  };
  league: { id: number; season: number; round: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
}

export interface ApiFootballPlayerStats {
  player: { id: number; name: string };
  statistics: {
    games: { minutes: number | null; position: string };
    goals: { total: number | null; assists: number | null };
    shots: { total: number | null; on: number | null };
    passes: { total: number | null; accuracy: string | null; key: number | null };
    tackles: { total: number | null; interceptions: number | null };
    duels: { total: number | null; won: number | null };
    dribbles: { attempts: number | null; success: number | null };
    fouls: { drawn: number | null; committed: number | null };
    cards: { yellow: number; red: number };
    penalty: { scored: number | null; missed: number | null; saved: number | null };
  }[];
}

// --- UI / Component Types ---

export interface PlayerCardProps {
  player: Player;
  rosterEntry?: RosterEntry;
  showStats?: boolean;
  onAdd?: (player: Player) => void;
  onDrop?: (player: Player) => void;
  onBid?: (player: Player) => void;
}

export type TradeProposalStatus = 'pending' | 'accepted' | 'rejected' | 'cancelled';

export interface TradeProposal {
  id: string;
  league_id: string;
  team_a_id: string;   // proposer
  team_b_id: string;   // receiver
  offered_players: string[];    // player IDs from team A
  requested_players: string[];  // player IDs from team B
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

export interface LeagueStanding {
  rank: number;
  team: Team;
  wins: number;
  losses: number;
  draws: number;
  points_for: number;
  points_against: number;
  total_points: number;
}

export type BenchSlot = 'DEF' | 'MID' | 'ATT' | 'FLEX';

export const BENCH_SLOT_LABELS: Record<BenchSlot, string> = {
  DEF: 'Defender',
  MID: 'Midfielder',
  ATT: 'Attacker',
  FLEX: 'Flex',
};

export const BENCH_FLEX_MAP: Record<BenchSlot, GranularPosition[]> = {
  DEF: ['CB', 'LB', 'RB'],
  MID: ['DM', 'CM', 'LM', 'RM', 'AM'],
  ATT: ['ST', 'LW', 'RW'],
  /** True flex: any starter-eligible position including emergency GK. */
  FLEX: ['CB', 'LB', 'RB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'ST', 'GK'],
};

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

export interface RatingCurveConfig {
  base: number;      // Points at exactly 6.0 rating
  scale: number;     // Multiplier for above-average
  penalty: number;   // Multiplier for below-average
  exponent: number;  // Convexity (higher = steeper reward curve)
}

/**
 * Shape of a single player element from FPL event/{gw}/live/ endpoint.
 * ICT metrics arrive as strings; callers must parseFloat.
 */
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

/** Full tournament with rounds and matchups loaded for bracket rendering. */
export interface TournamentWithBracket extends Tournament {
  rounds: (TournamentRound & { matchups: TournamentMatchup[] })[];
}

export const TOURNAMENT_LABELS: Record<TournamentType, { name: string; short: string }> = {
  primary_cup: { name: 'Champions League', short: 'UCL' },
  secondary_cup: { name: 'League Cup', short: 'Cup' },
  consolation_cup: { name: 'Conference League', short: 'UECL' },
};

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
  };
  explain: {
    fixture: number;
    stats: { identifier: string; value: number }[];
  }[];
}
