/**
 * Repairs photo_url on players who have left the Premier League.
 *
 * The old fpl_id-keyed sync rewrote a row's photo_url from whichever element it
 * mismatched the row to, so a number of rows carry another player's photo code
 * (our Ibrahima Konaté row has Endo Wataru's). Rows still in the PL self-heal on
 * the next player sync — the new matching reunites them with their real element
 * and overwrites the bad value. Rows that have since left do not: FPL's current
 * bootstrap has no entry for them, so the sync never writes them again and the
 * wrong photo is frozen in place.
 *
 * They are still rendered — an archived season's leaderboard includes everyone
 * who played it — so the code is restored from the 2025-26 archive, matched by
 * name, which is the only identifier those rows can still be trusted on.
 *
 * Usage:
 *   node scripts/repair-departed-player-photos.mjs <players_raw.csv> [--apply]
 */
import fs from 'fs';
import path from 'path';
import { createClient } from '@supabase/supabase-js';

const envPath = path.resolve('.env.local');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('#')) continue;
  const eq = trimmed.indexOf('=');
  if (eq > 0) {
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    process.env[trimmed.slice(0, eq).trim()] = val;
  }
}

const PLAYERS_CSV = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!PLAYERS_CSV) {
  console.error('usage: repair-departed-player-photos.mjs <players_raw.csv> [--apply]');
  process.exit(1);
}

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

const lines = fs.readFileSync(PLAYERS_CSV, 'utf8').trim().split('\n');
const header = splitCsvLine(lines[0]);
const archivePlayers = lines.slice(1).map((l) => {
  const cells = splitCsvLine(l);
  return Object.fromEntries(header.map((k, i) => [k, cells[i]]));
});

const normalize = (s) => (s ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
  .replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
const PARTICLES = new Set(['dos', 'das', 'van', 'von', 'del', 'silva', 'santos', 'junior', 'the']);
const tokens = (s) => normalize(s).split(' ').filter((t) => t.length >= 3 && !PARTICLES.has(t));

const byExact = new Map();
for (const p of archivePlayers) byExact.set(normalize(`${p.first_name} ${p.second_name}`), p);

const { data: players, error } = await supabase
  .from('players').select('id, name, photo_url, is_active').eq('is_active', false);
if (error) throw new Error(error.message);

const codeOf = (u) => /\/(\d+)\.(?:png|jpg)$/i.exec(u ?? '')?.[1] ?? null;
const photoUrlFor = (code) =>
  `https://resources.premierleague.com/premierleague25/photos/players/110x140/${code}.png`;

const fixes = [];
const ambiguous = [];
for (const p of players ?? []) {
  let entry = byExact.get(normalize(p.name));
  if (!entry) {
    const ours = tokens(p.name);
    const candidates = archivePlayers.filter((ap) => {
      const theirs = tokens(`${ap.first_name} ${ap.second_name}`);
      return ours.length > 0 && ours.every((t) => theirs.includes(t));
    });
    if (candidates.length > 1) { ambiguous.push(p.name); continue; }
    entry = candidates[0];
  }
  if (!entry) continue;
  const current = codeOf(p.photo_url);
  if (current === entry.code) continue;
  fixes.push({ id: p.id, name: p.name, from: current, to: entry.code });
}

console.log(`${players?.length ?? 0} departed players | ${fixes.length} carry someone else's photo | ${ambiguous.length} names too ambiguous to match`);
console.table(fixes.slice(0, 20).map(({ name, from, to }) => ({ name, from, to })));

if (!APPLY) {
  console.log('\ndry run — pass --apply to write.');
  process.exit(0);
}

for (const f of fixes) {
  const { error: updErr } = await supabase
    .from('players').update({ photo_url: photoUrlFor(f.to) }).eq('id', f.id);
  if (updErr) throw new Error(`${f.name}: ${updErr.message}`);
}
console.log(`corrected ${fixes.length} photos`);
