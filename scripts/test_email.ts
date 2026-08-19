import { sendEmail } from '../src/lib/email/client';
import { getTradeAcceptedEmail } from '../src/lib/email/templates';

async function test() {
  const testEmail = process.argv[2];
  if (!testEmail) {
    console.error('Please provide an email address: npx tsx scripts/test_email.ts your@email.com');
    process.exit(1);
  }

  // Check if RESEND_API_KEY is present
  if (!process.env.RESEND_API_KEY) {
    console.warn('Warning: RESEND_API_KEY not found in environment.');
    console.log('If it is in .env.local, try running with: npx tsx --env-file=.env.local scripts/test_email.ts');
  }

  console.log(`Sending test trade accepted email to ${testEmail}...`);

  try {
    const result = await sendEmail({
      to: [testEmail],
      subject: 'Gaffa Test Email',
      html: getTradeAcceptedEmail({
        isListingSale: false,
        teamA: 'Test Proposer FC',
        teamB: 'Test Recipient FC',
        offeredAssets: 'Erling Haaland (MCI)',
        requestedAssets: 'Mohamed Salah (LIV)',
        tierValue: 0,
        pending: false,
        leagueUrl: 'https://gaffa.live/league/test-id',
      })
    });

    console.log('Success! Resend Response:', result);
  } catch (error) {
    console.error('Failed to send email:', error);
  }
}

test();
