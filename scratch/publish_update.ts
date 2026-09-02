/**
 * One-off: publish the deadline-day update and fan the announcement out.
 *
 * Body is read from docs/UPDATE-2026-09-01-transfer-deadline.md so the copy
 * that ships is the copy that was reviewed, rather than a retyped copy of it.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { createNotification } from '@/lib/notifications/createNotification';

function loadEnvLocal() {
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

const SLUG = 'scouting-reports-player-profiles-deadline-day';
const TITLE = 'Scouting Reports, Player Profiles, and Deadline Day';
const SUMMARY =
  "Scouting reports and a page for every player, rosters up to 22, €30m for every club, and auction length now set by market value.";
const HIGHLIGHTS = [
  'A written scouting report on every player',
  'A page per player, and three ways to browse the pool',
  'Auction length now set by market value, and none settle overnight',
  'Roster size 20 to 22, and €30m for every club',
];

/** The post body: everything between the Part 1 fence and the Part 2 divider. */
function readBody(): string {
  const md = readFileSync(resolve(process.cwd(), 'docs/UPDATE-2026-09-01-transfer-deadline.md'), 'utf8');
  const start = md.indexOf('## Scouting reports');
  const end = md.indexOf('# Part 2 — Inventory');
  if (start < 0 || end < 0) throw new Error('could not locate the post body in the changelog source');
  return md.slice(start, end).replace(/\n---\n\s*$/, '').trim();
}

async function main() {
  loadEnvLocal();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const body = readBody();
  const dryRun = process.argv.includes('--dry-run');

  console.log(`[body] ${body.split(/\s+/).length} words, ${body.length} chars`);
  if (dryRun) {
    console.log('\n--- BODY ---\n');
    console.log(body);
    return;
  }

  const { data: row, error } = await admin
    .from('product_updates')
    .upsert(
      {
        slug: SLUG,
        title: TITLE,
        summary: SUMMARY,
        body,
        highlights: HIGHLIGHTS,
        is_major: true,
        published_at: new Date().toISOString(),
      },
      { onConflict: 'slug' },
    )
    .select('id, slug, published_at')
    .single();
  if (error) throw new Error(error.message);
  console.log(`[update] ${row.slug} published_at ${row.published_at}`);

  // Fan out one row per user. league_id NULL so it reads in every league's bell.
  // Matches the previous major update, which went to all 62 accounts.
  const { data: users, error: uErr } = await admin.from('users').select('id');
  if (uErr) throw new Error(uErr.message);

  // Re-run guard: a second pass must not put a second pop-up in front of anyone
  // who already has this one waiting.
  const { data: already } = await admin
    .from('notifications')
    .select('user_id')
    .eq('kind', 'product')
    .eq('url', `/updates#${SLUG}`);
  const alreadySent = new Set((already ?? []).map((r: { user_id: string }) => r.user_id));

  let sent = 0;
  let skipped = 0;
  for (const u of (users ?? []) as { id: string }[]) {
    if (alreadySent.has(u.id)) {
      skipped++;
      continue;
    }
    await createNotification(admin, {
      leagueId: null,
      userId: u.id,
      kind: 'product',
      title: TITLE,
      content: SUMMARY,
      url: `/updates#${SLUG}`,
    });
    sent++;
  }
  console.log(`[notifications] ${sent} sent, ${skipped} already had it`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
