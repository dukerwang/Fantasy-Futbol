/**
 * POST /api/admin/offseason/reset
 *
 * Commissioner-triggered end-of-season reset for a league.
 * Runs the full offseason sequence:
 * 1. Preflight validation
 * 2. Archive standings
 * 3. Distribute prizes (season + cups)
 * 4. Relegation compensation
 * 5. Reset matchup schedule
 * 6. Reset tournaments
 * 7. Advance season metadata
 *
 * GET /api/admin/offseason/reset?league_id=xxx
 * Returns a preflight check + preview of what will happen (used by the admin UI).
 *
 * Protected by CRON_SECRET header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runPreflightChecks, runSeasonReset } from '@/lib/offseason/seasonReset';
import { previewRelegationCompensation } from '@/lib/offseason/relegationHandler';
import { buildSeasonPrizes, buildCupPrizes, DEFAULT_PRIZE_CONFIG } from '@/lib/offseason/prizeDistribution';
import type { PrizeConfig } from '@/lib/offseason/prizeDistribution';

export const maxDuration = 300;

function authorize(req: NextRequest): boolean {
  const secret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  return !!secret && !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

/** GET: preflight check + preview — safe to call multiple times */
export async function GET(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const leagueId = searchParams.get('league_id');
  if (!leagueId) {
    return NextResponse.json({ error: 'league_id required' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch league info
  const { data: league, error: leagueErr } = await admin
    .from('leagues')
    .select('status, current_season, prize_config, roster_locked')
    .eq('id', leagueId)
    .single();

  if (leagueErr || !league) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
  }

  const prizeConfig: PrizeConfig = (league.prize_config as PrizeConfig) ?? DEFAULT_PRIZE_CONFIG;
  const seasonFrom = league.current_season ?? '2025-26';
  const seasonTo = bumpSeason(seasonFrom);

  const [preflight, relegationPreview, seasonPrizes, cupPrizes] = await Promise.all([
    runPreflightChecks(admin, leagueId),
    previewRelegationCompensation(admin, leagueId),
    buildSeasonPrizes(admin, leagueId, prizeConfig),
    buildCupPrizes(admin, leagueId, prizeConfig),
  ]);

  return NextResponse.json({
    leagueId,
    seasonFrom,
    seasonTo,
    leagueStatus: league.status,
    rosterLocked: league.roster_locked,
    preflight,
    preview: {
      relegationPlayers: relegationPreview,
      totalRelegationFaab: relegationPreview.reduce((s, p) => s + p.compensationFaab, 0),
      seasonPrizes,
      cupPrizes,
      totalPrizeFaab: [...seasonPrizes, ...cupPrizes].reduce((s, p) => s + p.amount, 0),
    },
  });
}

/** POST: run the actual reset (irreversible) */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: { league_id?: string; season_from?: string; season_to?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { league_id: leagueId, season_from, season_to } = body;
  if (!leagueId) {
    return NextResponse.json({ error: 'league_id required in request body' }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch current season from DB if not provided
  const { data: league } = await admin
    .from('leagues')
    .select('current_season, status')
    .eq('id', leagueId)
    .single();

  const seasonFrom = season_from ?? league?.current_season ?? '2025-26';
  const seasonTo = season_to ?? bumpSeason(seasonFrom);

  // Preflight check first
  const preflight = await runPreflightChecks(admin, leagueId);
  if (!preflight.ready) {
    return NextResponse.json(
      {
        error: 'Season is not complete — cannot run reset.',
        issues: preflight.issues,
        incompleteMatchups: preflight.incompleteMatchups,
        incompleteTournaments: preflight.incompleteTournaments,
      },
      { status: 422 },
    );
  }

  try {
    const result = await runSeasonReset(admin, leagueId, seasonFrom, seasonTo);
    return NextResponse.json({ ok: true, ...result });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[offseason/reset] Failed:', message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

/** Bumps '2025-26' → '2026-27', etc. */
function bumpSeason(season: string): string {
  const parts = season.split('-');
  if (parts.length !== 2) return season;
  const start = parseInt(parts[0], 10);
  const end = parseInt(parts[1], 10);
  if (isNaN(start) || isNaN(end)) return season;
  return `${start + 1}-${end + 1}`;
}
