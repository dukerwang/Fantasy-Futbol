import type { SupabaseClient } from '@supabase/supabase-js';
import { sendPushToUser } from '@/lib/push/sendPush';
import { wantsChannel, type NotificationKind } from '@/lib/notifications/prefs';
import { getLeagueName, withLeaguePrefix } from '@/lib/leagues/leagueName';

interface CreateNotificationParams {
  /** null for an account-wide notice not scoped to any one league (e.g. a product update). */
  leagueId: string | null;
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
    if (tag) {
      // Find existing notification with this tag for in-place folding
      let query = admin
        .from('notifications')
        .select('id')
        .eq('user_id', userId)
        .eq('tag', tag);
      
      if (leagueId) {
        query = query.eq('league_id', leagueId);
      } else {
        query = query.is('league_id', null);
      }

      const { data: existing } = await query.maybeSingle();

      if (existing) {
        const { error: updateErr } = await admin
          .from('notifications')
          .update({
            title,
            content,
            url: url || null,
            read: false,
            kind,
            created_at: new Date().toISOString(),
          })
          .eq('id', existing.id);

        if (updateErr) {
          console.error('[createNotification] Database update error:', updateErr.message);
        }
      } else {
        const { error: insertErr } = await admin
          .from('notifications')
          .insert({
            league_id: leagueId,
            user_id: userId,
            title,
            content,
            url: url || null,
            read: false,
            kind,
            tag,
          });

        if (insertErr) {
          console.error('[createNotification] Database insert error:', insertErr.message);
        }
      }
    } else {
      const { error: insertErr } = await admin
        .from('notifications')
        .insert({
          league_id: leagueId,
          user_id: userId,
          title,
          content,
          url: url || null,
          read: false,
          kind,
        });

      if (insertErr) {
        console.error('[createNotification] Database insert error:', insertErr.message);
      }
    }
  } catch (err) {
    console.error('[createNotification] Failed to create or update notification:', err);
  }

  try {
    const { data: row } = await admin
      .from('users')
      .select('notification_prefs')
      .eq('id', userId)
      .maybeSingle();

    if (!wantsChannel(row?.notification_prefs, kind, 'push')) return;

    // A push banner has no surrounding page to say which league it's about —
    // unlike the in-app inbox, which is always opened from a specific league's
    // pages. A manager in more than one league can't otherwise tell them apart.
    const leagueName = await getLeagueName(admin, leagueId);
    const finalPushTitle = withLeaguePrefix(leagueName, pushTitle ?? title);

    await sendPushToUser(admin, userId, { title: finalPushTitle, body: pushBody ?? content, url, tag });
  } catch (err) {
    console.error('[createNotification] Push send failed:', err);
  }
}
