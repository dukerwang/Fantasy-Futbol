import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';
import { generateValidLineup } from '@/lib/lineups/generateValidLineup';

export const maxDuration = 60;

function isStoredLineupComplete(lineup: unknown): boolean {
  const L = lineup as { starters?: unknown[]; bench?: unknown[] } | null;
  if (!L?.starters || L.starters.length < 11) return false;
  if (L.starters.some((s: any) => !s?.player_id)) return false;
  if (!L.bench || L.bench.length < 4) return false;
  if (L.bench.some((b: any) => !b?.player_id)) return false;
  return true;
}

/**
 * Backfills `lineup_a` / `lineup_b` on matchups for human and bot teams when empty or incomplete.
 * Strategy: carry forward from previous GW when possible; otherwise generate from roster.
 *
 * Auth: same as other crons (`Authorization: Bearer $CRON_SECRET` or `x-cron-secret`).
 *
 * Query:
 *   - `gameweek` (optional) — defaults to FPL current-or-next (same rule as set-bot-lineups)
 *   - `league_id` (optional) — limit to one league
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
      const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
      if (!fplRes.ok) throw new Error('FPL fetch failed');
      const fplData = await fplRes.json();
      for (const ev of fplData.events as any[]) {
        if (ev.is_current || ev.is_next) {
          targetGw = ev.id;
          break;
        }
      }
    } catch (err: any) {
      return NextResponse.json({ error: 'FPL fetch failed', details: err.message }, { status: 500 });
    }
  }

  let q = admin
    .from('matchups')
    .select('id, league_id, team_a_id, team_b_id, lineup_a, lineup_b')
    .eq('gameweek', targetGw);
  if (leagueIdFilter) q = q.eq('league_id', leagueIdFilter);

  const { data: matchups, error: matchupsErr } = await q;

  if (matchupsErr || !matchups) {
    return NextResponse.json({ error: 'Failed to fetch matchups' }, { status: 500 });
  }

  if (matchups.length === 0) {
    return NextResponse.json({
      ok: true,
      message: `No matchups for GW ${targetGw}`,
      gameweek: targetGw,
      league_id: leagueIdFilter ?? null,
    });
  }

  const prevGw = targetGw - 1;
  const prevLineupByTeam = new Map<string, unknown>();
  if (prevGw >= 1) {
    let pq = admin
      .from('matchups')
      .select('team_a_id, team_b_id, lineup_a, lineup_b')
      .eq('gameweek', prevGw);
    if (leagueIdFilter) pq = pq.eq('league_id', leagueIdFilter);
    const { data: prevMatchups } = await pq;
    if (prevMatchups) {
      for (const m of prevMatchups) {
        if (isStoredLineupComplete(m.lineup_a)) prevLineupByTeam.set(m.team_a_id, m.lineup_a);
        if (isStoredLineupComplete(m.lineup_b)) prevLineupByTeam.set(m.team_b_id, m.lineup_b);
      }
    }
  }

  let updatedSides = 0;
  const debugLog: string[] = [];

  for (const matchup of matchups) {
    const updates: { lineup_a?: unknown; lineup_b?: unknown } = {};

    if (!isStoredLineupComplete(matchup.lineup_a)) {
      let lineup = prevLineupByTeam.get(matchup.team_a_id) ?? null;
      if (!lineup) {
        const result = await generateValidLineup(admin, matchup.team_a_id);
        lineup = result.lineup;
        debugLog.push(`A ${matchup.team_a_id}: ${result.debug}`);
      } else {
        debugLog.push(`A ${matchup.team_a_id}: carried GW${prevGw}`);
      }
      if (lineup) {
        updates.lineup_a = lineup;
        updatedSides++;
      }
    }

    if (!isStoredLineupComplete(matchup.lineup_b)) {
      let lineup = prevLineupByTeam.get(matchup.team_b_id) ?? null;
      if (!lineup) {
        const result = await generateValidLineup(admin, matchup.team_b_id);
        lineup = result.lineup;
        debugLog.push(`B ${matchup.team_b_id}: ${result.debug}`);
      } else {
        debugLog.push(`B ${matchup.team_b_id}: carried GW${prevGw}`);
      }
      if (lineup) {
        updates.lineup_b = lineup;
        updatedSides++;
      }
    }

    if (Object.keys(updates).length > 0) {
      await admin.from('matchups').update(updates).eq('id', matchup.id);
    }
  }

  if (updatedSides > 0) {
    try {
      await processMatchupsForGameweek(targetGw, false);
      debugLog.push(`Triggered matchup re-score sync for GW ${targetGw}`);
    } catch (err: any) {
      debugLog.push(`Failed to trigger re-score sync: ${err.message}`);
    }
  }

  return NextResponse.json({
    ok: true,
    gameweek: targetGw,
    league_id: leagueIdFilter ?? null,
    matchupCount: matchups.length,
    prevGwLineupCount: prevLineupByTeam.size,
    updatedSides,
    debug: debugLog.slice(0, 40),
  });
}
