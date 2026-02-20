/**
 * POST /api/transfers/compensate
 * Body: { player_id: string }
 *
 * Admin-only endpoint to process a real-world transfer out of the PL.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { processPlayerTransferOut } from '@/lib/transfers/compensation';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const { player_id } = body;

  if (!player_id) {
    return NextResponse.json({ error: 'player_id is required' }, { status: 400 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const result = await processPlayerTransferOut(supabase, player_id);
  return NextResponse.json({ ok: true, result });
}
