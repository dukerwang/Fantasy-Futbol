/** Wire contract for Futbolpedia Phase 2 club context — keep in sync with Futbolpedia types. */

export interface FutbolpediaContextRosterPlayer {
  player_id: string;
  name: string;
  display_name?: string;
  primary_position: string;
  secondary_positions?: string[];
  status: string;
  pl_team?: string | null;
}

export interface FutbolpediaContextStandings {
  rank: number | null;
  of_teams?: number;
  played?: number;
  wins: number;
  draws: number;
  losses: number;
  points_for: number;
  points_against?: number;
}

export interface FutbolpediaContextMatchup {
  gameweek: number;
  opponent_club_name: string | null;
  status: string;
  your_score?: number | null;
  opponent_score?: number | null;
}

export interface FutbolpediaContextLineupSlot {
  player_id: string;
  name: string;
  slot: string;
}

export interface FutbolpediaContextLineup {
  formation?: string | null;
  gameweek?: number;
  starters: FutbolpediaContextLineupSlot[];
  bench: FutbolpediaContextLineupSlot[];
}

export interface FutbolpediaClubContextResponse {
  league_id: string;
  club_id: string;
  league_name: string;
  club_name: string;
  budget_eur_m: number;
  roster: FutbolpediaContextRosterPlayer[];
  standings: FutbolpediaContextStandings;
  matchup: FutbolpediaContextMatchup | null;
  lineup: FutbolpediaContextLineup | null;
  synced_at: string;
}
