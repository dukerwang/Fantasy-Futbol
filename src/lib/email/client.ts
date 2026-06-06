import { Resend } from 'resend';

// Instantiate Resend client
const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;

const SENDER_EMAIL = 'Gaffa <noreply@gaffa.live>';

/**
 * Sends an email, safely swallowing and logging errors if Resend is not configured or fails.
 */
export async function sendEmail({
  to,
  subject,
  html,
}: {
  to: string | string[];
  subject: string;
  html: string;
}) {
  if (!resend) {
    console.warn('[Email Service] RESEND_API_KEY missing. Skipping email:', subject);
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: SENDER_EMAIL,
      to,
      subject,
      html,
    });

    if (error) {
      console.error('[Email Service] Error sending email:', error);
      return false;
    }

    console.log(`[Email Service] Successfully sent "${subject}" to ${to}`);
    return true;
  } catch (err) {
    console.error('[Email Service] Exception sending email:', err);
    return false;
  }
}
