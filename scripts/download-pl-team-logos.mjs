/**
 * Downloads official-style PL club badge PNGs from resources.premierleague.com
 * and saves them under public/team-logos/{fpl_team_id}.png
 *
 * Filenames use FPL `teams[].id` so they align with `players.pl_team_id` in our DB.
 * Run: npm run download-team-logos
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'team-logos');

/** CDN pattern verified 200 OK (Apr 2026); season-specific paths may 403 without PL keys */
const BADGE_BASE =
  process.env.PL_BADGE_BASE_URL?.replace(/\/$/, '') ||
  'https://resources.premierleague.com/premierleague/badges/70';

const BOOTSTRAP = 'https://fantasy.premierleague.com/api/bootstrap-static/';

async function main() {
  const res = await fetch(BOOTSTRAP, {
    headers: {
      'User-Agent': 'Fantasy-Futbol-logo-sync/1.0 (educational; contact: local dev)',
    },
  });
  if (!res.ok) {
    console.error(`bootstrap-static failed: ${res.status}`);
    process.exit(1);
  }
  const data = await res.json();
  const teams = data.teams;
  if (!Array.isArray(teams) || teams.length === 0) {
    console.error('No teams in bootstrap-static');
    process.exit(1);
  }

  await fs.mkdir(OUT_DIR, { recursive: true });

  let ok = 0;
  const failures = [];

  for (const t of teams) {
    const id = t.id;
    const code = t.code;
    const name = t.name;
    const url = `${BADGE_BASE}/t${code}.png`;
    const dest = path.join(OUT_DIR, `${id}.png`);

    const imgRes = await fetch(url, {
      headers: {
        'User-Agent': 'Fantasy-Futbol-logo-sync/1.0',
      },
    });

    if (!imgRes.ok) {
      failures.push({ id, code, name, url, status: imgRes.status });
      continue;
    }

    const buf = Buffer.from(await imgRes.arrayBuffer());
    await fs.writeFile(dest, buf);
    console.log(`OK  ${name} (id=${id}, code=${code}) -> ${path.relative(ROOT, dest)}`);
    ok += 1;
  }

  if (failures.length) {
    console.error('\nFailures:');
    for (const f of failures) console.error(f);
    process.exit(1);
  }

  console.log(`\nDownloaded ${ok} logos to ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
