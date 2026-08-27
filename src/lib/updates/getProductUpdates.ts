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

/** Every published update, newest first. */
export async function getProductUpdates(admin: SupabaseClient): Promise<ProductUpdate[]> {
  const { data, error } = await admin
    .from('product_updates')
    .select('id, slug, title, summary, body, is_major, published_at')
    .order('published_at', { ascending: false });

  if (error) {
    console.error('[getProductUpdates] failed:', error.message);
    return [];
  }
  return (data as ProductUpdate[]) ?? [];
}
