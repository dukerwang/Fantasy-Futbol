/**
 * POST /api/admin/offseason/reset-all
 *
 * Platform-admin batch action — runs the end-of-season Reset for every
 * league that's ready (all matchups/cups completed), in one call. This is
 * not a per-league commissioner action; see /admin/offseason.
 *
 * GET /api/admin/offseason/reset-all
 * Returns which leagues are ready, and which aren't (with reasons).
 *
 * Protected by CRON_SECRET header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runPreflightChecks, runSeasonReset } from '@/lib/offseason/seasonReset';
import { buildSeasonPrizes, buildCupPrizes, DEFAULT_PRIZE_CONFIG } from '@/lib/offseason/prizeDistribution';
import type { PrizeConfig } from '@/lib/offseason/prizeDistribution';
import { nextSeason } from '@/lib/season/currentSeason';
import { authorizeAdminApi } from '@/lib/auth/authorizeAdminApi';

export const maxDuration = 300;

interface LeagueRow {
  id: string;
  name: string;
  status: string;
  current_season: string;
  prize_config: PrizeConfig | null;
}

export async function GET(req: NextRequest) {
  if (!(await authorizeAdminApi(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: leagues } = await admin
    .from('leagues')
    .select('id, name, status, current_season, prize_config')
    .eq('status', 'active');

  const ready: { leagueId: string; leagueName: string; seasonFrom: string; seasonTo: string; totalPrizeFaab: number }[] = [];
  const notReady: { leagueId: string; leagueName: string; issues: string[] }[] = [];

  for (const league of (leagues ?? []) as LeagueRow[]) {
    const preflight = await runPreflightChecks(admin, league.id);
    if (!preflight.ready) {
      notReady.push({ leagueId: league.id, leagueName: league.name, issues: preflight.issues });
      continue;
    }

    const prizeConfig: PrizeConfig = league.prize_config ?? DEFAULT_PRIZE_CONFIG;
    const [seasonPrizes, cupPrizes] = await Promise.all([
      buildSeasonPrizes(admin, league.id, prizeConfig),
      buildCupPrizes(admin, league.id, prizeConfig),
    ]);
    const totalPrizeFaab = [...seasonPrizes, ...cupPrizes].reduce((s, p) => s + p.amount, 0);

    ready.push({
      leagueId: league.id,
      leagueName: league.name,
      seasonFrom: league.current_season,
      seasonTo: nextSeason(league.current_season),
      totalPrizeFaab,
    });
  }

  return NextResponse.json({ ready, notReady });
}

export async function POST(req: NextRequest) {
  if (!(await authorizeAdminApi(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: leagues } = await admin
    .from('leagues')
    .select('id, name, status, current_season, prize_config')
    .eq('status', 'active');

  const results: { leagueId: string; leagueName: string; ok: boolean; error?: string; totalPrizeFaab?: number }[] = [];

  for (const league of (leagues ?? []) as LeagueRow[]) {
    const preflight = await runPreflightChecks(admin, league.id);
    if (!preflight.ready) continue;

    const seasonFrom = league.current_season;
    const seasonTo = nextSeason(seasonFrom);

    try {
      const result = await runSeasonReset(admin, league.id, seasonFrom, seasonTo);
      results.push({
        leagueId: league.id,
        leagueName: league.name,
        ok: true,
        totalPrizeFaab: result.totalPrizeFaab,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[reset-all] League ${league.id} failed:`, message);
      results.push({ leagueId: league.id, leagueName: league.name, ok: false, error: message });
    }
  }

  return NextResponse.json({ ok: true, leaguesProcessed: results.length, results });
}
