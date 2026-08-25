import type { SupabaseClient } from '@supabase/supabase-js';
import { sendEmail } from '@/lib/email/client';
import { wantsChannel, type NotificationKind } from '@/lib/notifications/prefs';

/**
 * Send an email only to recipients who have that kind's email channel on.
 * Replaces the old pattern of collecting every team email then blasting.
 */
export async function sendEmailToUsers(
  admin: SupabaseClient,
  params: {
    userIds: string[];
    kind: NotificationKind;
    subject: string;
    html: string;
  },
): Promise<boolean> {
  const uniqueIds = [...new Set(params.userIds.filter(Boolean))];
  if (uniqueIds.length === 0) return false;

  const { data: users, error } = await admin
    .from('users')
    .select('id, email, notification_prefs')
    .in('id', uniqueIds);

  if (error) {
    console.error('[sendEmailToUsers] load users failed:', error.message);
    return false;
  }

  const emails = (users ?? [])
    .filter((u) => u.email && wantsChannel(u.notification_prefs, params.kind, 'email'))
    .map((u) => u.email as string);

  if (emails.length === 0) return false;

  return sendEmail({ to: emails, subject: params.subject, html: params.html });
}
