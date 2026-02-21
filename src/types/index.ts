// ============================================================
// Fantasy Futbol — Core TypeScript Types
// ============================================================

// --- Granular Position System ---
export type GranularPosition = 'GK' | 'CB' | 'LB' | 'RB' | 'DM' | 'CM' | 'AM' | 'LW' | 'RW' | 'ST';

// Positions that can fill each slot (flex rules)
export const POSITION_FLEX_MAP: Record<GranularPosition, GranularPosition[]> = {
  GK: ['GK'],
  CB: ['CB'],
  LB: ['LB', 'RB', 'CB'],
  RB: ['RB', 'LB', 'CB'],
  DM: ['DM', 'CM'],
  CM: ['CM', 'DM', 'AM'],
  AM: ['AM', 'CM', 'LW', 'RW'],
  LW: ['LW', 'RW', 'AM', 'ST'],
  RW: ['RW', 'LW', 'AM', 'ST'],
  ST: ['ST', 'LW', 'RW'],
};

// Supported formations (slot lists)
export type Formation = '4-4-2' | '4-3-3' | '3-5-2' | '4-2-3-1' | '3-4-3' | '5-3-2';

export const FORMATION_SLOTS: Record<Formation, GranularPosition[]> = {
  '4-4-2': ['GK', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'DM', 'LW', 'ST', 'ST'],
  '4-3-3': ['GK', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'DM', 'LW', 'RW', 'ST'],
  '3-5-2': ['GK', 'CB', 'CB', 'CB', 'LB', 'DM', 'DM', 'CM', 'AM', 'ST', 'ST'],
  '4-2-3-1': ['GK', 'CB', 'CB', 'LB', 'RB', 'DM', 'DM', 'AM', 'LW', 'RW', 'ST'],
  '3-4-3': ['GK', 'CB', 'CB', 'CB', 'LB', 'DM', 'CM', 'RB', 'LW', 'ST', 'RW'],
  '5-3-2': ['GK', 'CB', 'CB', 'CB', 'LB', 'RB', 'CM', 'CM', 'DM', 'ST', 'ST'],
};

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
  fpl_total_points: number | null;
  fpl_form: number | null; // avg FPL pts over last 30 days
  is_active: boolean; // still in the PL
  transfermarkt_id: string | null;
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

export type RosterStatus = 'active' | 'bench' | 'ir';

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

export type BenchSlot = 'B1' | 'B2' | 'B3' | 'B4' | 'B5' | 'B6' | 'B7' | 'B8';

export const BENCH_FLEX_MAP: Record<BenchSlot, GranularPosition[]> = {
  B1: ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'],
  B2: ['CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST', 'GK'],
  B3: ['CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST', 'GK'],
  B4: ['CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST', 'GK'],
  B5: ['CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST', 'GK'],
  B6: ['CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST', 'GK'],
  B7: ['CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST', 'GK'],
  B8: ['CB', 'LB', 'RB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST', 'GK'],
};

export function getExpectedBenchSlots(benchSize: number): BenchSlot[] {
  const all: BenchSlot[] = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8'];
  return all.slice(0, benchSize);
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
}
