/**
 * API-Football client (Free Tier: 100 requests/day).
 * Docs: https://www.api-football.com/documentation-v3
 *
 * All requests go through this single client so rate limits are easy to track.
 * Backed by Effect for resilience, exponential backoff retries, and Schema validation.
 */

import { Effect } from 'effect';
import {
  ApiFootballService,
  ApiFootballServiceLive,
  type ApiPlayer,
  type ApiTeam,
} from '@/lib/effect';

export type { ApiPlayer, ApiTeam };

/**
 * Fetch all Premier League teams for the current season.
 * Compatible with existing Promise-based callers.
 */
export async function fetchPLTeams(): Promise<{ team: { id: number; name: string } }[]> {
  const program = Effect.gen(function* () {
    const service = yield* ApiFootballService;
    return yield* service.fetchPLTeams();
  }).pipe(Effect.provide(ApiFootballServiceLive));

  const teams = await Effect.runPromise(program);
  return teams as { team: { id: number; name: string } }[];
}

/**
 * Fetch all players for a specific team.
 * Compatible with existing Promise-based callers.
 */
export async function fetchPlayersByTeam(teamId: number, page = 1): Promise<ApiPlayer[]> {
  const program = Effect.gen(function* () {
    const service = yield* ApiFootballService;
    return yield* service.fetchPlayersByTeam(teamId, page);
  }).pipe(Effect.provide(ApiFootballServiceLive));

  const players = await Effect.runPromise(program);
  return players as ApiPlayer[];
}
