import type { SupabaseClient } from '@supabase/supabase-js';

export interface ProductUpdate {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  is_major: boolean;
  published_at: string;
}

/**
 * Every published update, newest first.
 *
 * `published_at` in the future means scheduled, not published: the row can be
 * written and reviewed ahead of time and appears on its own. Without this filter
 * a future date was decorative — the entry went live the moment it was inserted,
 * whatever it claimed its date was.
 */
export async function getProductUpdates(admin: SupabaseClient): Promise<ProductUpdate[]> {
  const { data, error } = await admin
    .from('product_updates')
    .select('id, slug, title, summary, body, is_major, published_at')
    .lte('published_at', new Date().toISOString())
    .order('published_at', { ascending: false });

  if (error) {
    console.error('[getProductUpdates] failed:', error.message);
    return [];
  }
  return (data as ProductUpdate[]) ?? [];
}
