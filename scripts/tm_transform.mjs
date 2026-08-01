/**
 * tm_transform.mjs
 *
 * Converts raw `dcaribou/transfermarkt-scraper` `players` crawler output
 * (JSON-lines on stdin, one object per line, real field names per
 * tfmkt/crawlers/players.py — `name`, `current_market_value`,
 * `current_club.href`) into the flat array shape sync_transfermarkt.ts
 * expects in scripts/players.json (`player_name`, `market_value_raw`,
 * `club_name`). sync_transfermarkt.ts only logs club_name, never matches on
 * it, so a slug-derived title case is good enough.
 *
 * Usage: python -m tfmkt players ... | node scripts/tm_transform.mjs
 */

import * as fs from 'fs';
import * as path from 'path';

function clubNameFromHref(href) {
  if (!href) return null;
  const slug = href.split('/').filter(Boolean)[0];
  if (!slug) return null;
  return slug
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const raw = fs.readFileSync(0, 'utf-8');
const players = [];

for (const line of raw.split('\n')) {
  const trimmed = line.trim();
  if (!trimmed) continue;

  let obj;
  try {
    obj = JSON.parse(trimmed);
  } catch {
    continue;
  }

  if (obj.type !== 'player') continue;

  const playerName = obj.name ?? obj.name_in_home_country ?? null;
  if (!playerName) continue;

  players.push({
    player_name: playerName,
    market_value_raw: obj.current_market_value ?? null,
    club_name: clubNameFromHref(obj.current_club?.href),
  });
}

const outPath = path.join(import.meta.dirname, 'players.json');
fs.writeFileSync(outPath, JSON.stringify(players, null, 2));
console.log(`[transform] Wrote ${players.length} players to ${outPath}`);

if (players.length === 0) {
  console.error('[transform] No players parsed from scraper output — aborting.');
  process.exit(1);
}
