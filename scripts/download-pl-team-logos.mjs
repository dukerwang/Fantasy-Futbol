/**
 * Downloads official-style PL club badge PNGs from resources.premierleague.com
 * and saves them under public/team-logos/{slug}.png
 *
 * Filenames use the STABLE slug from src/lib/clubs/registry.ts — never FPL's
 * `teams[].id`, which is reassigned alphabetically every season. Filing badges
 * by that id is how `19.png` silently turned from West Ham into Spurs at the
 * 2026-27 rollover.
 *
 * Every club in the registry is fetched, not just the current 20, so relegated
 * clubs keep a correct badge for archive views. Badge art itself is addressed
 * by FPL's stable per-club `code`, which does not get reassigned.
 *
 * Run: npm run download-team-logos
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'team-logos');
const REGISTRY = path.join(ROOT, 'src', 'lib', 'clubs', 'clubs.json');

/** CDN pattern verified 200 OK (Apr 2026); season-specific paths may 403 without PL keys */
const BADGE_BASE =
  process.env.PL_BADGE_BASE_URL?.replace(/\/$/, '') ||
  'https://resources.premierleague.com/premierleague/badges/70';

/**
 * The club list lives in clubs.json precisely so this script and the TypeScript
 * registry read the same bytes. An earlier version regex-parsed the .ts file and
 * mispaired a slug with the next club's code the moment one name needed double
 * quotes ("Nott'm Forest") — the same silent-wrong-badge failure this whole
 * change exists to prevent. Do not reintroduce parsing.
 */
async function readRegistry() {
  return JSON.parse(await fs.readFile(REGISTRY, 'utf8'));
}

async function main() {
  const clubs = await readRegistry();
  if (clubs.length === 0) {
    console.error(`No clubs parsed from ${path.relative(ROOT, REGISTRY)}`);
    process.exit(1);
  }
  console.log(`Registry: ${clubs.length} clubs\n`);

  await fs.mkdir(OUT_DIR, { recursive: true });

  let ok = 0;
  const failures = [];

  for (const club of clubs) {
    const url = `${BADGE_BASE}/t${club.fplCode}.png`;
    const dest = path.join(OUT_DIR, `${club.slug}.png`);

    const imgRes = await fetch(url, {
      headers: { 'User-Agent': 'Fantasy-Futbol-logo-sync/1.0' },
    });

    if (!imgRes.ok) {
      failures.push({ ...club, url, status: imgRes.status });
      continue;
    }

    const buf = Buffer.from(await imgRes.arrayBuffer());
    await fs.writeFile(dest, buf);
    console.log(`OK  ${club.name.padEnd(16)} (code=${club.fplCode}) -> ${club.slug}.png`);
    ok += 1;
  }

  if (failures.length) {
    console.error('\nFailures:');
    for (const f of failures) console.error(f);
    process.exit(1);
  }

  console.log(`\nDownloaded ${ok} badges to ${path.relative(ROOT, OUT_DIR)}/`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
