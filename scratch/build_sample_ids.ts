import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { OPENING_ANGLES, openingAngleFor } from '@futbolpedia/engine';
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

const WANT = [
  'Truffert', 'Cash', 'Kelleher', 'M.Sangaré', 'Maatsen', 'Kostoulas',
  'Saka', 'Gravenberch', 'Donnarumma', 'Isak', 'Estêvão', 'Wan-Bissaka',
  'Gyökeres',
];

async function main() {
  loadEnvLocal();
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
  const ids = await loadRegularPlayerIds(admin);
  const rows: Array<{ id: string; web_name: string; primary_position: string | null; pl_team: string }> = [];
  for (let i = 0; i < ids.length; i += 200) {
    const { data } = await admin.from('players').select('id, web_name, primary_position, pl_team').in('id', ids.slice(i, i + 200));
    rows.push(...((data ?? []) as typeof rows));
  }
  const pick = rows.filter((r) => WANT.includes(r.web_name));

  // Fill out to 20 with one player from each of the other angles, varied position/club.
  const usedClubs = new Set(pick.map((p) => p.pl_team));
  for (const idx of [0, 2, 3, 4, 5, 0, 2]) {
    const cand = rows.find(
      (r) =>
        OPENING_ANGLES.indexOf(openingAngleFor(r.id)) === idx &&
        !pick.some((p) => p.id === r.id) &&
        !usedClubs.has(r.pl_team) &&
        r.primary_position,
    );
    if (cand) { pick.push(cand); usedClubs.add(cand.pl_team); }
  }

  console.log(`sample: ${pick.length} players\n`);
  for (const p of pick) {
    console.log(`  '${p.id}', // ${p.web_name.padEnd(14)} ${(p.primary_position ?? 'N/A').padEnd(4)} ${p.pl_team.padEnd(16)} angle=${OPENING_ANGLES.indexOf(openingAngleFor(p.id))}`);
  }
  console.log(`\nclubs: ${new Set(pick.map((p) => p.pl_team)).size}`);
  console.log(`grounded estimate: ${pick.length * 2 + new Set(pick.map((p) => p.pl_team)).size}`);
}
main();
