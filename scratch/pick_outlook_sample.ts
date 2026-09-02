/** One-off: choose a 20-player sample that stresses the 0.3.2 opening-angle fix. */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { OPENING_ANGLES, openingAngleFor } from '@futbolpedia/engine';
import { loadRegularPlayerIds } from '@/lib/outlook/population';

function loadEnvLocal() {
  const path = resolve(process.cwd(), '.env.local');
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    const m = line.match(/^([^#=]+)=(.*)$/);
    if (!m) continue;
    const key = m[1].trim();
    const val = m[2].trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = val;
  }
}

async function main() {
  loadEnvLocal();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const ids = await loadRegularPlayerIds(admin);
  console.log('regulars pool:', ids.length);

  const rows: Array<{ id: string; web_name: string; primary_position: string | null; pl_team: string }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin
      .from('players')
      .select('id, web_name, primary_position, pl_team')
      .in('id', ids.slice(i, i + 200));
    rows.push(...((data ?? []) as typeof rows));
  }

  const dist = new Map<string, number>();
  for (const r of rows) dist.set(openingAngleFor(r.id), (dist.get(openingAngleFor(r.id)) ?? 0) + 1);
  console.log('\nangle distribution:');
  OPENING_ANGLES.forEach((a, i) => {
    const n = dist.get(a) ?? 0;
    console.log(`  [${i}] ${((n / rows.length) * 100).toFixed(1)}% (${n})  ${a}`);
  });

  const roleAngle = OPENING_ANGLES[1];
  const onRole = rows.filter((r) => openingAngleFor(r.id) === roleAngle);
  console.log(`\nrole-security angle: ${onRole.length} players`);

  const OFFENDERS = ['Truffert', 'Kelleher', 'Cash', 'M.Sangaré', 'Maatsen', 'Gyökeres', 'Kostoulas'];
  console.log('\n0.3.1 offenders:');
  for (const r of rows.filter((x) => OFFENDERS.includes(x.web_name))) {
    console.log(`  ${r.id}  ${r.web_name.padEnd(12)} ${(r.primary_position ?? 'N/A').padEnd(4)} ${r.pl_team.padEnd(16)} angle=${OPENING_ANGLES.indexOf(openingAngleFor(r.id))}`);
  }

  console.log('\nrole-angle candidates by position:');
  const byPos = new Map<string, typeof rows>();
  for (const r of onRole) {
    const p = r.primary_position ?? 'N/A';
    if (!byPos.has(p)) byPos.set(p, []);
    byPos.get(p)!.push(r);
  }
  for (const [pos, list] of [...byPos].sort()) {
    console.log(`  ${pos}: ${list.slice(0, 6).map((r) => r.web_name).join(', ')}`);
  }
}
main();
