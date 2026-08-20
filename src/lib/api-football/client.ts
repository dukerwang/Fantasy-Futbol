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
