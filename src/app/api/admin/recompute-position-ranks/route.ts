/**
 * POST /api/admin/recompute-position-ranks
 *
 * Recomputes the positional ranks behind every "ST #2" pill for one season,
 * ranking each position pool on points scored AT that position — secondary
 * positions re-scored under their own weights, appearances under 15 minutes
 * excluded — which is what the stats leaderboard already displays. See
 * migration 085 for why this cannot live in SQL.
 *
 * Writes to season_player_stats_archive.position_ranks when the season has
 * been archived, otherwise to players.position_ranks.
 *
 * Query params:
 *   ?season=2025-26   — defaults to the current FPL season
 *
 * The live season is refreshed automatically by /api/sync/stats and an
 * archived one by the season reset; this route is for backfills and repairs.
 *
 * Auth: CRON_SECRET via x-cron-secret header or Authorization: Bearer.
 */

import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';
import { recomputePositionRanks } from '@/lib/stats/seasonStats';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();
  const { searchParams } = new URL(req.url);
  const season = searchParams.get('season') ?? (await getCurrentFplSeason());

  try {
    const result = await recomputePositionRanks(admin, season);
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
