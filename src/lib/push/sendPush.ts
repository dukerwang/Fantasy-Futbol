import type { SupabaseClient } from '@supabase/supabase-js';
import webpush from 'web-push';

interface PushPayload {
  title: string;
  body: string;
  url?: string;
  /** Grouping key — a new push with the same tag replaces the previous one on the device instead of stacking. */
  tag?: string;
}

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT;
  if (!publicKey || !privateKey || !subject) return false;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
  return true;
}

/**
 * Notification content is written in the app's lightweight `**bold**`
 * markdown (see FormattedText.tsx), which the in-app inbox renders properly.
 * A push notification banner is plain OS chrome with no markdown support, so
 * without this the asterisks show up literally.
 */
function stripMarkdown(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1');
}

/**
 * Fans a notification out to every device a user has subscribed on. Prunes
 * subscriptions the push service reports as gone (410) or unknown (404) —
 * these accumulate as people uninstall the PWA or revoke permission in iOS
 * Settings, neither of which notifies the app directly.
 */
export async function sendPushToUser(admin: SupabaseClient, userId: string, payload: PushPayload): Promise<void> {
  if (!ensureConfigured()) return;

  const { data: subscriptions } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('user_id', userId);

  if (!subscriptions || subscriptions.length === 0) return;

  const body = JSON.stringify({
    title: stripMarkdown(payload.title),
    body: stripMarkdown(payload.body),
    url: payload.url,
    tag: payload.tag,
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          body
        );
      } catch (err) {
        const statusCode = (err as { statusCode?: number }).statusCode;
        if (statusCode === 404 || statusCode === 410) {
          await admin.from('push_subscriptions').delete().eq('id', sub.id);
        } else {
          console.error('[sendPushToUser] send failed:', err);
        }
      }
    })
  );
}
