/**
 * POST /api/sync/stats?fixture_id=<id>&home_goals=<n>&away_goals=<n>
 *
 * Fetches player statistics for a completed PL fixture
 * and stores scored fantasy points in the database.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { fetchFixturePlayerStats } from '@/lib/api-football/client';
import { calculateFantasyPoints, mapApiStatsToRawStats } from '@/lib/scoring/engine';
import type { GranularPosition } from '@/types';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const fixtureId = parseInt(searchParams.get('fixture_id') ?? '0', 10);
  const gameweek = parseInt(searchParams.get('gameweek') ?? '0', 10);
  const homeGoals = parseInt(searchParams.get('home_goals') ?? '0', 10);
  const awayGoals = parseInt(searchParams.get('away_goals') ?? '0', 10);

  if (!fixtureId || !gameweek) {
    return NextResponse.json({ error: 'fixture_id and gameweek are required' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const teamStats = await fetchFixturePlayerStats(fixtureId);
  let saved = 0;

  for (const teamData of teamStats) {
    for (const playerStat of (teamData as any).players ?? []) {
      const apiPlayer = playerStat.player;
      const stats = playerStat.statistics?.[0];

      if (!stats) continue;

      // Determine which team's goals are "against" this player
      // (simplified — in production, track home/away team IDs)
      const opponentGoals = awayGoals; // approximation

      // Look up player in our DB
      const { data: dbPlayer } = await supabase
        .from('players')
        .select('id, primary_position')
        .eq('api_football_id', apiPlayer.id)
        .single();

      if (!dbPlayer) continue;

      const rawStats = mapApiStatsToRawStats(stats, opponentGoals);
      if (!rawStats) continue;

      const { total: fantasyPoints } = calculateFantasyPoints(
        rawStats,
        dbPlayer.primary_position as GranularPosition
      );

      const { error } = await supabase.from('player_stats').upsert(
        {
          player_id: dbPlayer.id,
          match_id: fixtureId,
          gameweek,
          season: '2025-26',
          stats: rawStats,
          fantasy_points: fantasyPoints,
        },
        { onConflict: 'player_id,match_id' }
      );

      if (!error) saved++;
    }
  }

  return NextResponse.json({ ok: true, fixtureId, gameweek, saved });
}
