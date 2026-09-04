import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { carryForwardLineupsForGameweek } from '@/lib/lineups/carryForward';
import { processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';

export const maxDuration = 60;

/**
 * Backfills lineup_a / lineup_b on matchups for any teams when empty or incomplete,
 * carrying forward previous lineups or generating valid defaults.
 */
export async function GET(req: NextRequest) {
  const secret =
    req.headers.get('authorization')?.replace('Bearer ', '') ??
    req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET && process.env.NODE_ENV !== 'development') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const leagueIdFilter = searchParams.get('league_id') ?? undefined;
  const gwParam = searchParams.get('gameweek');
  const parsedGw = gwParam ? parseInt(gwParam, 10) : NaN;

  const admin = createAdminClient();

  let targetGw = parsedGw;
  if (!Number.isFinite(targetGw) || targetGw < 1 || targetGw > 38) {
    targetGw = 1;
    try {
      const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
        next: { revalidate: 0 },
      });
      if (fplRes.ok) {
        const fplData = await fplRes.json();
        const now = new Date();
        for (const ev of fplData.events as any[]) {
          if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
            if (ev.id > targetGw) targetGw = ev.id;
          }
        }
      }
    } catch {
      targetGw = 1;
    }
  }

  const result = await carryForwardLineupsForGameweek(admin, {
    gameweek: targetGw,
    leagueId: leagueIdFilter,
  });

  if (result.updatedCount > 0) {
    try {
      await processMatchupsForGameweek(targetGw, false);
    } catch (err: any) {
      result.details.push(`Re-score sync warning: ${err.message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    gameweek: targetGw,
    league_id: leagueIdFilter ?? null,
    updatedSides: result.updatedCount,
    details: result.details,
  });
}
