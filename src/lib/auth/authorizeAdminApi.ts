/**
 * Shared authorization for platform-admin batch API routes.
 *
 * Accepts EITHER:
 *  - a valid CRON_SECRET header (server-to-server / cron callers), or
 *  - a logged-in session belonging to a site admin (browser callers from
 *    /admin/offseason) — so we never need to ship CRON_SECRET to the client.
 */

import type { NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { isSiteAdminEmail } from './siteAdmin';

export async function authorizeAdminApi(req: NextRequest): Promise<boolean> {
  const secret =
    req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret && process.env.CRON_SECRET && secret === process.env.CRON_SECRET) {
    return true;
  }

  try {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return isSiteAdminEmail(user?.email);
  } catch {
    return false;
  }
}
