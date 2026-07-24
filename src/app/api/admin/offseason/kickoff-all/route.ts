/**
 * POST /api/admin/offseason/kickoff-all
 *
 * Platform-admin batch action — runs Season Kickoff (relegation payouts +
 * summer auction seeding + roster unlock) for every league still sitting
 * in `offseason` status, in one call. Not a per-league commissioner action;
 * see /admin/offseason.
 *
 * GET /api/admin/offseason/kickoff-all
 * Returns a preview of what kickoff would do for every offseason league.
 *
 * Protected by CRON_SECRET header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { previewSeasonKickoff, runSeasonKickoff } from '@/lib/offseason/seasonKickoff';
import { authorizeAdminApi } from '@/lib/auth/authorizeAdminApi';

export const maxDuration = 300;

interface LeagueRow {
  id: string;
  name: string;
}

export async function GET(req: NextRequest) {
  if (!(await authorizeAdminApi(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: leagues } = await admin
    .from('leagues')
    .select('id, name')
    .eq('status', 'offseason');

  const previews: Array<{ leagueId: string; leagueName: string } & Awaited<ReturnType<typeof previewSeasonKickoff>>> = [];

  for (const league of (leagues ?? []) as LeagueRow[]) {
    try {
      const preview = await previewSeasonKickoff(admin, league.id);
      previews.push({ ...preview, leagueId: league.id, leagueName: league.name });
    } catch (err: unknown) {
      console.error(`[kickoff-all] Preview failed for league ${league.id}:`, err);
    }
  }

  return NextResponse.json({ leagues: previews });
}

export async function POST(req: NextRequest) {
  if (!(await authorizeAdminApi(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: leagues } = await admin
    .from('leagues')
    .select('id, name')
    .eq('status', 'offseason');

  const results: { leagueId: string; leagueName: string; ok: boolean; error?: string; auctionsCreated?: number; relegationsProcessed?: number }[] = [];

  for (const league of (leagues ?? []) as LeagueRow[]) {
    try {
      const result = await runSeasonKickoff(admin, league.id);
      results.push({
        leagueId: league.id,
        leagueName: league.name,
        ok: true,
        auctionsCreated: result.auctionsCreated,
        relegationsProcessed: result.relegationResults.length,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[kickoff-all] League ${league.id} failed:`, message);
      results.push({ leagueId: league.id, leagueName: league.name, ok: false, error: message });
    }
  }

  return NextResponse.json({ ok: true, leaguesProcessed: results.length, results });
}
