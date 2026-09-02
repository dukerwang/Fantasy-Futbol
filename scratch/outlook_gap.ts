/** One-off: which regulars still lack a 0.3.4 outlook after the spend-cap stop. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { PIPELINE_VERSION } from '@futbolpedia/engine';
import { loadRegularPlayerIds } from '@/lib/outlook/population';

function loadEnvLocal() {
  const p = resolve(process.cwd(), '.env.local');
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    if (!process.env[m[1].trim()]) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}

async function main() {
  loadEnvLocal();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const ids = await loadRegularPlayerIds(admin);
  const { data } = await admin
    .from('player_outlooks')
    .select('player_id')
    .eq('pipeline_version', PIPELINE_VERSION);
  const done = new Set((data ?? []).map((r: { player_id: string }) => r.player_id));
  const missing = ids.filter((id) => !done.has(id));

  const rows: Array<{ id: string; web_name: string; pl_team: string }> = [];
  for (let i = 0; i < missing.length; i += 200) {
    const { data: p } = await admin.from('players').select('id, web_name, pl_team').in('id', missing.slice(i, i + 200));
    rows.push(...((p ?? []) as typeof rows));
  }
  console.log(`pool ${ids.length}, at ${PIPELINE_VERSION}: ${ids.length - missing.length}, missing ${missing.length}\n`);
  for (const r of rows) console.log(`  ${r.web_name.padEnd(18)} ${r.pl_team}`);
  console.log('\nresume with:\n  OUTLOOK_MONTHLY_GROUNDED_CAP=1400 npx tsx scripts/generate-outlooks.ts --regulars');
  console.log('  (no --force: the 401 already at ' + PIPELINE_VERSION + ' are skipped as fresh)');
}
main();
