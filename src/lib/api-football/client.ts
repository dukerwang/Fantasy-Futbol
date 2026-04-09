/**
 * API-Football client (Free Tier: 100 requests/day).
 * Docs: https://www.api-football.com/documentation-v3
 *
 * All requests go through this single client so rate limits are easy to track.
 */

const BASE_URL = 'https://v3.football.api-sports.io';
const PL_LEAGUE_ID = 39; // Premier League
const CURRENT_SEASON = 2024;

async function apiFetch<T>(
  path: string,
  params: Record<string, string | number> = {}
): Promise<T> {
  const apiKey = process.env.API_FOOTBALL_KEY;
  if (!apiKey) throw new Error('API_FOOTBALL_KEY is not configured');

  const url = new URL(`${BASE_URL}${path}`);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, String(v)));

  const res = await fetch(url.toString(), {
    headers: {
      'x-apisports-key': apiKey,
    },
    next: { revalidate: 3600 }, // Cache for 1 hour in Next.js
  });

  if (!res.ok) {
    throw new Error(`API-Football error: ${res.status} ${res.statusText}`);
  }

  const json = await res.json();
  return json.response as T;
}

// --- Player Types ---
export interface ApiPlayer {
  player: {
    id: number;
    name: string;
    firstname: string;
    lastname: string;
    birth: { date: string | null };
    nationality: string | null;
    height: string | null;
    weight: string | null;
    photo: string;
  };
  statistics: {
    team: { id: number; name: string };
    games: { position: string };
  }[];
}

// --- Fixture Types ---
export interface ApiFixture {
  fixture: { id: number; date: string; status: { short: string; elapsed: number | null } };
  league: { round: string };
  teams: {
    home: { id: number; name: string };
    away: { id: number; name: string };
  };
  goals: { home: number | null; away: number | null };
}

// --- Player Stats per Fixture ---
export interface ApiPlayerFixtureStats {
  player: { id: number; name: string };
  statistics: {
    games: { minutes: number | null; position: string | null };
    goals: { total: number | null; assists: number | null };
    shots: { total: number | null; on: number | null };
    passes: { total: number | null; accuracy: string | null; key: number | null };
    tackles: { total: number | null; interceptions: number | null; blocks: number | null };
    dribbles: { attempts: number | null; success: number | null };
    cards: { yellow: number; red: number };
    penalty: {
      scored: number | null;
      missed: number | null;
      saved: number | null;
    };
    goalkeeper?: {
      saves: number | null;
      goals: { conceded: number | null };
    };
  }[];
}

/**
 * Fetch all Premier League teams for the current season.
 */
export async function fetchPLTeams(): Promise<{ team: { id: number; name: string } }[]> {
  return apiFetch<{ team: { id: number; name: string } }[]>('/teams', {
    league: PL_LEAGUE_ID,
    season: CURRENT_SEASON,
  });
}

/**
 * Fetch all players for a specific team.
 */
export async function fetchPlayersByTeam(teamId: number, page = 1): Promise<ApiPlayer[]> {
  return apiFetch<ApiPlayer[]>('/players', {
    team: teamId,
    season: CURRENT_SEASON,
    page,
  });
}

/**
 * Fetch fixtures for the Premier League (optionally for a specific round).
 */
export async function fetchPLFixtures(round?: string): Promise<ApiFixture[]> {
  const params: Record<string, string | number> = {
    league: PL_LEAGUE_ID,
    season: CURRENT_SEASON,
  };
  if (round) params.round = round;
  return apiFetch<ApiFixture[]>('/fixtures', params);
}

/**
 * Fetch player statistics for a specific fixture.
 * Returns stats for all players in that match.
 */
export async function fetchFixturePlayerStats(fixtureId: number): Promise<ApiPlayerFixtureStats[]> {
  return apiFetch<ApiPlayerFixtureStats[]>('/fixtures/players', {
    fixture: fixtureId,
  });
}

/**
 * Map API-Football position string to our GranularPosition.
 * The API uses: "Goalkeeper", "Defender", "Midfielder", "Attacker"
 *
 * We default to a broad mapping; fine-grained roles should be confirmed
 * by cross-referencing player stats (e.g., a "Defender" with high key passes = FB/WB).
 */
export function mapApiPositionToGranular(apiPosition: string): string {
  const pos = apiPosition.toLowerCase();
  if (pos.includes('goalkeeper')) return 'GK';
  if (pos.includes('defender')) return 'CB'; // Will be refined in data sync
  if (pos.includes('midfielder')) return 'CM'; // Will be refined in data sync
  if (pos.includes('attacker')) return 'ST';
  return 'CM'; // fallback
}
