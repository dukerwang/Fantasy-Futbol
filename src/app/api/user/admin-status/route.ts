import { createClient } from '@/lib/supabase/server';
import { isSiteAdminEmail } from '@/lib/auth/siteAdmin';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

/**
 * Tells the client whether the logged-in user is a Gaffa site admin —
 * distinct from any league's commissioner. Only exposes a boolean, never
 * the underlying allowlist.
 */
export async function GET() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ isSiteAdmin: false });

  return NextResponse.json({ isSiteAdmin: isSiteAdminEmail(user.email) });
}
