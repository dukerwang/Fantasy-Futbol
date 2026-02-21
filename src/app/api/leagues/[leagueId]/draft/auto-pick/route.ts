import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { insertMatchups } from '@/lib/schedule/insertMatchups';

interface Props {
  params: Promise<{ leagueId: string }>;
}

/**
 * POST /api/leagues/[leagueId]/draft/auto-pick
 *
 * Called by any client that notices the pick deadline has expired.
 * The Postgres RPC is idempotent — it does nothing if the deadline
 * has not actually passed or the draft is not active.
 * No auth required: the RPC enforces its own safety checks.
 */
export async function POST(_req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  const admin = createAdminClient();

  const { data, error } = await admin.rpc('auto_draft_pick', {
    p_league_id: leagueId,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Auto-generate schedule on the last pick
  if (data?.draft_complete === true) {
    await insertMatchups(admin, leagueId).catch((err) =>
      console.error('[insertMatchups] auto-pick route:', err),
    );
  }

  return NextResponse.json(data ?? { ok: false });
}
