import type { SupabaseClient } from '@supabase/supabase-js';

interface CreateNotificationParams {
  leagueId: string;
  userId: string;
  title: string;
  content: string;
  url?: string;
}

/**
 * Creates an in-game notification/mail record for a specific user and league.
 */
export async function createNotification(
  admin: SupabaseClient,
  params: CreateNotificationParams
): Promise<void> {
  const { leagueId, userId, title, content, url } = params;

  try {
    const { error } = await admin
      .from('notifications')
      .insert({
        league_id: leagueId,
        user_id: userId,
        title,
        content,
        url: url || null,
        read: false,
      });

    if (error) {
      console.error('[createNotification] Database insert error:', error.message);
    }
  } catch (err) {
    console.error('[createNotification] Failed to create notification:', err);
  }
}
