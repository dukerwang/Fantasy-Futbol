import { createClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client for server-side data fetching.
 * Bypasses RLS — only use after verifying auth via createClient().auth.getUser().
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
