/**
 * src/lib/projections/teamExpectations.ts
 *
 * Calculates team-level fixture expectations (implied goals, goals conceded,
 * and clean sheet probability) for every Premier League match in a gameweek.
 *
 * Grounded in historical 2025–26 attack and defense rates with home advantage
 * (+0.20 goals home, -0.20 goals away).
 */

import { resolveClub } from '@/lib/clubs/registry';

export interface FixturePair {
  homeClub: string; // club slug or name
  awayClub: string;
}

export interface TeamMatchEnvironment {
  clubSlug: string;
  opponentSlug: string;
  isHome: boolean;
  expectedGoals: number;
  expectedConceded: number;
  cleanSheetProb: number;
}

export interface TeamStrength {
  attack: number; // relative to league avg 1.0
  defense: number; // relative to league avg 1.0 (lower is stronger defense)
}

const LEAGUE_AVG_GOALS_PER_TEAM = 1.35;
const BASE_HOME_GOALS = 1.45;
const BASE_AWAY_GOALS = 1.25;

/**
 * 2025–26 full-season attack and defense ratings (goals per game normalized by league average).
 * Promoted clubs are calibrated to historical Premier League transition averages.
 */
export const TEAM_STRENGTHS: Record<string, TeamStrength> = {
  'man-city': { attack: 2.03 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 0.92 / LEAGUE_AVG_GOALS_PER_TEAM },
  'arsenal': { attack: 1.87 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 0.71 / LEAGUE_AVG_GOALS_PER_TEAM },
  'man-utd': { attack: 1.82 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.32 / LEAGUE_AVG_GOALS_PER_TEAM },
  'liverpool': { attack: 1.66 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.39 / LEAGUE_AVG_GOALS_PER_TEAM },
  'chelsea': { attack: 1.53 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.37 / LEAGUE_AVG_GOALS_PER_TEAM },
  'aston-villa': { attack: 1.47 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.29 / LEAGUE_AVG_GOALS_PER_TEAM },
  'bournemouth': { attack: 1.53 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.42 / LEAGUE_AVG_GOALS_PER_TEAM },
  'brentford': { attack: 1.45 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.37 / LEAGUE_AVG_GOALS_PER_TEAM },
  'newcastle': { attack: 1.39 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.45 / LEAGUE_AVG_GOALS_PER_TEAM },
  'brighton': { attack: 1.37 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.21 / LEAGUE_AVG_GOALS_PER_TEAM },
  'nottingham-forest': { attack: 1.32 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.40 / LEAGUE_AVG_GOALS_PER_TEAM },
  'crystal-palace': { attack: 1.08 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.34 / LEAGUE_AVG_GOALS_PER_TEAM },
  'everton': { attack: 1.05 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.45 / LEAGUE_AVG_GOALS_PER_TEAM },
  'fulham': { attack: 1.25 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.42 / LEAGUE_AVG_GOALS_PER_TEAM },
  'spurs': { attack: 1.55 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.48 / LEAGUE_AVG_GOALS_PER_TEAM },
  'sunderland': { attack: 1.11 / LEAGUE_AVG_GOALS_PER_TEAM, defense: 1.26 / LEAGUE_AVG_GOALS_PER_TEAM },
  // Promoted sides: Championship to Premier League regression
  'coventry-city': { attack: 0.85, defense: 1.35 },
  'hull-city': { attack: 0.85, defense: 1.35 },
  'ipswich-town': { attack: 0.90, defense: 1.30 },
  'leeds': { attack: 0.95, defense: 1.25 },
};

export const DEFAULT_STRENGTH: TeamStrength = { attack: 1.0, defense: 1.0 };

export function getClubStrength(clubIdentifier: string): TeamStrength {
  const resolved = resolveClub(clubIdentifier);
  const slug = resolved?.slug ?? clubIdentifier.toLowerCase().replace(/\s+/g, '-');
  return TEAM_STRENGTHS[slug] ?? DEFAULT_STRENGTH;
}

/**
 * Calculates the match environment for a single fixture between home and away clubs.
 */
export function calculateMatchEnvironment(
  homeIdentifier: string,
  awayIdentifier: string,
): { home: TeamMatchEnvironment; away: TeamMatchEnvironment } {
  const homeResolved = resolveClub(homeIdentifier);
  const awayResolved = resolveClub(awayIdentifier);
  const homeSlug = homeResolved?.slug ?? homeIdentifier;
  const awaySlug = awayResolved?.slug ?? awayIdentifier;

  const homeStr = getClubStrength(homeSlug);
  const awayStr = getClubStrength(awaySlug);

  const xgHome = Number((BASE_HOME_GOALS * homeStr.attack * awayStr.defense).toFixed(2));
  const xgAway = Number((BASE_AWAY_GOALS * awayStr.attack * homeStr.defense).toFixed(2));

  const csHome = Number(Math.exp(-xgAway).toFixed(3));
  const csAway = Number(Math.exp(-xgHome).toFixed(3));

  return {
    home: {
      clubSlug: homeSlug,
      opponentSlug: awaySlug,
      isHome: true,
      expectedGoals: xgHome,
      expectedConceded: xgAway,
      cleanSheetProb: csHome,
    },
    away: {
      clubSlug: awaySlug,
      opponentSlug: homeSlug,
      isHome: false,
      expectedGoals: xgAway,
      expectedConceded: xgHome,
      cleanSheetProb: csAway,
    },
  };
}

/**
 * Builds a lookup map of clubSlug -> TeamMatchEnvironment for all matches in a gameweek.
 */
export function buildGameweekTeamEnvironments(
  fixtures: FixturePair[],
): Map<string, TeamMatchEnvironment> {
  const map = new Map<string, TeamMatchEnvironment>();

  for (const f of fixtures) {
    if (!f.homeClub || !f.awayClub) continue;
    const { home, away } = calculateMatchEnvironment(f.homeClub, f.awayClub);
    map.set(home.clubSlug, home);
    map.set(away.clubSlug, away);
  }

  return map;
}
