import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export const maxDuration = 60;

function calculateAgeInYears(dobIso: string, referenceDate = new Date()): number {
  const dob = new Date(dobIso);
  let age = referenceDate.getFullYear() - dob.getFullYear();
  const monthDiff = referenceDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dob.getDate())) age--;
  return age;
}

/**
 * Resolves aged-out academy entries:
 * - Auto-promote to bench if active roster has room
 * - Otherwise leave in academy and report as unresolved
 *
 * Auth:
 * - Authorization: Bearer CRON_SECRET
 * - OR x-cron-secret header
 */
export async function POST(req: NextRequest) {
  const cronSecret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  if (!cronSecret || cronSecret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const admin = createAdminClient();

  const { data: academyRows, error: academyErr } = await admin
    .from('roster_entries')
    .select('id, team_id, league_id, player_id, player:players(name, date_of_birth)')
    .eq('status', 'taxi');
  if (academyErr) return NextResponse.json({ error: academyErr.message }, { status: 500 });

  if (!academyRows || academyRows.length === 0) {
    return NextResponse.json({ ok: true, scanned: 0, aged_out: 0, promoted: 0, unresolved: [] });
  }

  const leagueIds = Array.from(new Set(academyRows.map((r: any) => r.league_id)));
  const { data: leagues } = await admin
    .from('leagues')
    .select('id, roster_size, taxi_age_limit')
    .in('id', leagueIds);
  const leagueMap = new Map((leagues ?? []).map((l: any) => [l.id, l]));

  const agedOutRows = academyRows.filter((r: any) => {
    const league = leagueMap.get(r.league_id);
    const ageLimit = league?.taxi_age_limit ?? 21;
    const dob = r.player?.date_of_birth as string | null | undefined;
    if (!dob) return false;
    return calculateAgeInYears(dob, new Date()) > ageLimit;
  });

  const unresolved: Array<{ team_id: string; player_id: string; player_name: string; reason: string }> = [];
  let promoted = 0;

  for (const row of agedOutRows as any[]) {
    const league = leagueMap.get(row.league_id);
    const rosterSize = league?.roster_size ?? 20;

    const { count: activeCount } = await admin
      .from('roster_entries')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', row.team_id)
      .not('status', 'in', '("ir","taxi")');

    if ((activeCount ?? 0) >= rosterSize) {
      unresolved.push({
        team_id: row.team_id,
        player_id: row.player_id,
        player_name: row.player?.name ?? row.player_id,
        reason: 'active_roster_full',
      });
      continue;
    }

    const { error: promoteErr } = await admin
      .from('roster_entries')
      .update({ status: 'bench' })
      .eq('id', row.id);
    if (promoteErr) {
      unresolved.push({
        team_id: row.team_id,
        player_id: row.player_id,
        player_name: row.player?.name ?? row.player_id,
        reason: promoteErr.message,
      });
      continue;
    }

    promoted++;
  }

  return NextResponse.json({
    ok: true,
    scanned: academyRows.length,
    aged_out: agedOutRows.length,
    promoted,
    unresolved,
  });
}

export async function GET(req: NextRequest) {
  return POST(req);
}

