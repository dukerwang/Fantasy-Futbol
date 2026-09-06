/**
 * src/lib/projections/calculateGameweekProjections.ts
 *
 * Orchestrates gameweek-wide projected points calculation:
 * 1. Loads fixtures from public.pl_fixtures for the targeted season and gameweek.
 * 2. Builds team-level match environments (expected goals, conceded, clean sheet odds).
 * 3. Maps all active Premier League players into their club's match environment.
 * 4. Returns a map of playerId -> projected_points.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolveClub } from '@/lib/clubs/registry';
import { fetchAllPages } from '@/lib/supabase/pagination';
import type { GranularPosition } from '@/types';
import { buildGameweekTeamEnvironments, type FixturePair } from './teamExpectations';
import { calculatePlayerProjectedPoints } from './playerProjections';

export interface PlayerRowForProjection {
  id: string;
  pl_team: string | null;
  primary_position: GranularPosition | null;
  market_value: number | null;
  fpl_status: string | null;
}

export interface GameweekProjectionsResult {
  gameweek: number;
  season: string;
  projections: Map<string, number>;
  fixturesFound: number;
}

/**
 * Calculates projected points for all active players (or a subset) for a specific gameweek.
 */
export async function calculateGameweekProjections(
  supabase: SupabaseClient,
  season: string,
  gameweek: number,
  playerIds?: string[],
): Promise<GameweekProjectionsResult> {
  // 1. Fetch gameweek fixtures
  const { data: fixtures, error: fixError } = await supabase
    .from('pl_fixtures')
    .select('home_club, away_club')
    .eq('season', season)
    .eq('gameweek', gameweek);

  if (fixError) throw fixError;

  const fixturePairs: FixturePair[] = (fixtures ?? []).map((f) => ({
    homeClub: f.home_club,
    awayClub: f.away_club,
  }));

  const teamEnvs = buildGameweekTeamEnvironments(fixturePairs);

  // 2. Fetch active players
  const playerRows = await fetchAllPages<PlayerRowForProjection>((from, to) => {
    let query = supabase
      .from('players')
      .select('id, pl_team, primary_position, market_value, fpl_status')
      .eq('is_active', true);

    if (playerIds?.length) {
      query = query.in('id', playerIds);
    }

    return query.range(from, to);
  });

  // 3. Compute projections
  const projections = new Map<string, number>();

  for (const player of playerRows) {
    if (!player.primary_position || !player.pl_team) {
      projections.set(player.id, 0.0);
      continue;
    }

    const club = resolveClub(player.pl_team);
    const env = club ? teamEnvs.get(club.slug) : undefined;

    // Blank gameweek or bye
    if (!env) {
      projections.set(player.id, 0.0);
      continue;
    }

    const points = calculatePlayerProjectedPoints(
      {
        id: player.id,
        primary_position: player.primary_position,
        market_value: player.market_value,
        fpl_status: player.fpl_status,
      },
      env,
    );

    projections.set(player.id, points);
  }

  return {
    gameweek,
    season,
    projections,
    fixturesFound: fixturePairs.length,
  };
}
