/**
 * GET /api/leagues/[leagueId]/transfers
 *
 * The whole hub in one fetch. Backs both the initial server render and every
 * realtime reconcile (reconnect, tab-visible, resolution events), so the client
 * has exactly one shape to reason about and the reducer has one action that can
 * replace state wholesale.
 *
 * Replaces GET /auctions, GET /listings and GET /trades, which returned three
 * overlapping views of the same tables.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { buildTransfersModel } from '@/lib/transfers/buildTransfersModel';

export const dynamic = 'force-dynamic';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();
  const model = await buildTransfersModel(admin, leagueId, user.id);

  // Null covers both "no such league" and "caller has no team in it". Collapsing
  // them to 403 avoids leaking which leagues exist.
  if (!model) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  return NextResponse.json(model, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
