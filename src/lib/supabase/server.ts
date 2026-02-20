import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

// Minimal stub used when Supabase env vars aren't configured yet
function createStubClient() {
  return {
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: null, error: null }), order: () => ({ ascending: () => ({ data: [], error: null }), data: [], error: null }), limit: () => ({ single: async () => ({ data: null, error: null }), data: [], error: null }), data: [], error: null }), ilike: () => ({ or: () => ({ order: () => ({ limit: () => ({ data: [], error: null }) }) }), order: () => ({ limit: () => ({ data: [], error: null }) }) }), or: () => ({ order: () => ({ limit: () => ({ data: [], error: null }) }) }), not: () => ({ select: () => ({ eq: () => ({ data: [], error: null }) }), data: [], error: null }), order: () => ({ data: [], error: null, ascending: () => ({ data: [], error: null }), limit: () => ({ data: [], error: null }), descending: () => ({ data: [], error: null }) }), data: [], error: null }),
      insert: () => ({ select: () => ({ single: async () => ({ data: null, error: null }) }), data: null, error: null }),
      update: () => ({ eq: () => ({ data: null, error: null }) }),
      delete: () => ({ eq: () => ({ data: null, error: null }) }),
      upsert: () => ({ data: null, error: null }),
    }),
  } as unknown as ReturnType<typeof createServerClient>;
}

export async function createClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '';

  if (!supabaseUrl.startsWith('http') || !supabaseKey) {
    return createStubClient();
  }

  const cookieStore = await cookies();

  return createServerClient(supabaseUrl, supabaseKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // setAll called from Server Component — cookies can't be set here.
        }
      },
    },
  });
}
