/**
 * POST /api/admin/force-process-auctions
 *
 * Developer tool: immediately triggers auction processing without waiting for the cron.
 * Proxies to /api/cron/process-auctions with the server-side CRON_SECRET.
 * No user auth required — intended for local/staging use only.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  // First, forcibly expire all pending claims so the cron picks them up
  const admin = createAdminClient();
  const { error } = await admin
    .from('waiver_claims')
    .update({ expires_at: new Date().toISOString() })
    .eq('status', 'pending');

  if (error) {
    console.error('Failed to force expire claims:', error);
  }

  // Then trigger the actual processing cron
  const origin = req.nextUrl.origin;
  const res = await fetch(`${origin}/api/cron/process-auctions`, {
    method: 'POST',
    headers: { 'x-cron-secret': cronSecret },
  });

  const data = await res.json();
  return NextResponse.json(data, { status: res.status });
}
