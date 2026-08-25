import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getSiteAdminEmails } from '@/lib/auth/siteAdmin';
import { sendEmail } from '@/lib/email/client';

export const dynamic = 'force-dynamic';

const REPORT_TYPES = ['Bug', 'Feedback', 'Feature', 'Other'] as const;
type ReportType = (typeof REPORT_TYPES)[number];

function isReportType(value: unknown): value is ReportType {
  return typeof value === 'string' && (REPORT_TYPES as readonly string[]).includes(value);
}

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const type = body?.type;
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  const leagueId = typeof body?.leagueId === 'string' ? body.leagueId : null;

  if (!isReportType(type) || !message) {
    return NextResponse.json({ error: 'Type and message are required' }, { status: 400 });
  }

  if (message.length > 5000) {
    return NextResponse.json({ error: 'Message is too long' }, { status: 400 });
  }

  const admins = getSiteAdminEmails();
  if (admins.length === 0) {
    console.error('[support] ADMIN_EMAILS is empty');
    return NextResponse.json({ error: 'Support is not configured' }, { status: 503 });
  }

  const admin = createAdminClient();
  const { data: profile } = await admin
    .from('users')
    .select('username, email')
    .eq('id', user.id)
    .single();

  let leagueName: string | null = null;
  if (leagueId) {
    const { data: league } = await admin
      .from('leagues')
      .select('name')
      .eq('id', leagueId)
      .maybeSingle();
    leagueName = league?.name ?? null;
  }

  const username = profile?.username ?? 'unknown';
  const email = profile?.email ?? user.email ?? 'unknown';
  const escaped = message
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');

  const html = `
    <p><strong>Type:</strong> ${type}</p>
    <p><strong>From:</strong> @${username} (${email})</p>
    <p><strong>League:</strong> ${leagueName ? `${leagueName} (${leagueId})` : 'none'}</p>
    <hr/>
    <p>${escaped}</p>
  `;

  const ok = await sendEmail({
    to: admins,
    subject: `Gaffa report · ${type}`,
    html,
  });

  if (!ok) {
    return NextResponse.json({ error: 'Could not send the report' }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
