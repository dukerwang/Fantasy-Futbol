/**
 * POST /api/sync/resolve-matchups
 *
 * Standalone endpoint that scans ALL live matchups across all GWs,
 * checks FPL's finished flag for each stalled GW, and resolves them.
 *
 * Called by a dedicated cron so resolution is guaranteed even on days
 * when no live stats sync runs.
 */

import { resolveAllStalledGameweeks } from '@/lib/scoring/matchupProcessor';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
  const secret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const result = await resolveAllStalledGameweeks();
  return NextResponse.json({ ok: true, ...result });
}
