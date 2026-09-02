/**
 * One-off: replace the stale Barcola arrival notice in the two alpha leagues
 * with a fresh one, so it arrives as a new unread row rather than an edit to a
 * six-hour-old one nobody will look at again.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createNotification } from '@/lib/notifications/createNotification';
import { buildArrivalNotification } from '@/lib/notifications/valueTiers';
import { timeLeft } from '@/lib/notifications/copy';

function loadEnvLocal() {
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const ALPHA = ['772588fc-98d3-43d0-a71d-cb8dd17eafcd', '1fcea2ba-5eba-4433-adf0-a9340883b3cf'];

async function main() {
  loadEnvLocal();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

  // Clear the old rows first so nobody ends up holding two notices for one lot.
  const { data: removed } = await admin
    .from('notifications')
    .delete()
    .in('league_id', ALPHA)
    .ilike('content', '%barcola%')
    .select('id');
  console.log(`[cleanup] removed ${removed?.length ?? 0} stale notice(s)`);

  for (const leagueId of ALPHA) {
    // Filtering an embedded table through PostgREST needs the join to be inner
    // AND the filter spelled against the embedded alias; simpler to resolve the
    // player first and match on the id.
    const { data: p } = await admin
      .from('players')
      .select('id, name, pl_team, market_value')
      .ilike('name', '%barcola%')
      .maybeSingle();
    if (!p) { console.log('no Barcola in players'); return; }

    const { data: claim } = await admin
      .from('waiver_claims')
      .select('expires_at')
      .eq('league_id', leagueId)
      .eq('is_auction', true)
      .eq('status', 'pending')
      .eq('player_id', p.id)
      .is('team_id', null)
      .maybeSingle();
    if (!claim) { console.log(`[${leagueId}] no live Barcola lot, skipped`); continue; }
    const copy = buildArrivalNotification(
      [{ name: p.name, value: Number(p.market_value), club: p.pl_team }],
      timeLeft(claim.expires_at),
    );

    const { data: teams } = await admin.from('teams').select('user_id').eq('league_id', leagueId);
    let sent = 0;
    for (const t of (teams ?? []) as { user_id: string | null }[]) {
      if (!t.user_id) continue;
      await createNotification(admin, {
        kind: 'auctions',
        leagueId,
        userId: t.user_id,
        title: copy.title,
        pushTitle: copy.pushTitle,
        content: copy.content,
        pushBody: copy.pushBody,
        url: `/league/${leagueId}/transfers/auctions`,
      });
      sent++;
    }
    console.log(`[${leagueId}] ${sent} sent — "${copy.content}"`);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
