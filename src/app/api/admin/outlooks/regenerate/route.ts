import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { runOutlookBatch } from '@/lib/outlook/batch';

export const maxDuration = 300;

function authorize(req: NextRequest): boolean {
  const secret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  return !!secret && !!process.env.CRON_SECRET && secret === process.env.CRON_SECRET;
}

/** POST: regenerate Futbolpedia outlooks for selected or regular players */
export async function POST(req: NextRequest) {
  if (!authorize(req)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!process.env.API_KEY) {
    return NextResponse.json({ error: 'API_KEY is not configured' }, { status: 500 });
  }

  let body: {
    playerIds?: string[];
    regulars?: boolean;
    limit?: number;
    force?: boolean;
    groundedRequestBudget?: number;
  } = {};

  try {
    body = await req.json();
  } catch {
    // empty body → regulars batch with default limit
  }

  const admin = createAdminClient();

  try {
    const report = await runOutlookBatch(admin, {
      playerIds: body.playerIds,
      regulars: body.regulars ?? !body.playerIds?.length,
      limit: body.limit,
      force: body.force,
      groundedRequestBudget: body.groundedRequestBudget,
    });
    return NextResponse.json({ ok: true, report });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
