import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPushToUser } from '@/lib/push/sendPush';
import { wantsChannel, type NotificationKind } from '@/lib/notifications/prefs';

interface CreateNotificationParams {
  leagueId: string;
  userId: string;
  kind: NotificationKind;
  title: string;
  content: string;
  url?: string;
  /**
   * Overrides `title` for the push notification only. Use when `title` is a
   * shared branding string (e.g. the "Blockbuster Signing" eyebrow also used
   * in emails and UI badges) that shouldn't be edited just to fit iOS's push
   * banner width, which appends " from Gaffa" to every title.
   */
  pushTitle?: string;
  /**
   * Overrides `content` for the push body only. Use when the in-app paragraph
   * is too long for a lock-screen banner (iOS shows roughly two lines).
   */
  pushBody?: string;
  /** Push grouping key — a new push with the same tag replaces the previous one on the device instead of stacking. Use for high-frequency triggers like outbid warnings. */
  tag?: string;
}

/**
 * Creates an in-game notification/mail record for a specific user and league,
 * and fans it out as a push notification to any devices they've subscribed —
 * every trigger site in the app goes through this one function, so push
 * doesn't need its own call sites.
 *
 * In-game mail always writes. Push respects `kind` against the user's
 * notification_prefs (and still no-ops if they have no subscription).
 */
export async function createNotification(
  admin: SupabaseClient,
  params: CreateNotificationParams
): Promise<void> {
  const { leagueId, userId, kind, title, content, url, pushTitle, pushBody, tag } = params;

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
    const { data: row } = await admin
      .from('users')
      .select('notification_prefs')
      .eq('id', userId)
      .maybeSingle();

    if (!wantsChannel(row?.notification_prefs, kind, 'push')) return;

    await sendPushToUser(admin, userId, { title: pushTitle ?? title, body: pushBody ?? content, url, tag });
  } catch (err) {
    console.error('[createNotification] Push send failed:', err);
  }
}
