/**
 * GET /api/admin/offseason/kickoff-preflight
 *
 * Runs the Kickoff preflight for every league sitting in `offseason` and
 * returns blockers/warnings plus the numbers each league would produce.
 * Read-only apart from a single insert-then-delete probe row that proves the
 * auction write works before the irreversible half of Kickoff runs.
 *
 * Protected by CRON_SECRET / platform-admin auth.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runKickoffPreflight, type KickoffPreflightResult } from '@/lib/offseason/kickoffPreflight';
import { authorizeAdminApi } from '@/lib/auth/authorizeAdminApi';

export const maxDuration = 120;

export async function GET(req: NextRequest) {
  if (!(await authorizeAdminApi(req))) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: leagues } = await admin
    .from('leagues')
    .select('id, name')
    .eq('status', 'offseason');

  const results: KickoffPreflightResult[] = [];
  const failures: { leagueId: string; leagueName: string; error: string }[] = [];

  for (const league of leagues ?? []) {
    try {
      results.push(await runKickoffPreflight(admin, league.id));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[kickoff-preflight] League ${league.id} failed:`, message);
      failures.push({ leagueId: league.id, leagueName: league.name, error: message });
    }
  }

  return NextResponse.json({
    // A league whose preflight itself crashed is not ready by definition.
    ready: failures.length === 0 && results.every((r) => r.ready),
    leagues: results,
    failures,
  });
}
