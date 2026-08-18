import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPushToUser } from '@/lib/push/sendPush';

interface CreateNotificationParams {
  leagueId: string;
  userId: string;
  title: string;
  content: string;
  url?: string;
}

/**
 * Creates an in-game notification/mail record for a specific user and league,
 * and fans it out as a push notification to any devices they've subscribed —
 * every trigger site in the app goes through this one function, so push
 * doesn't need its own call sites.
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

  try {
    await sendPushToUser(admin, userId, { title, body: content, url });
  } catch (err) {
    console.error('[createNotification] Push send failed:', err);
  }
}
