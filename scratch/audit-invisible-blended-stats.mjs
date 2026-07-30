/**
 * The reconcile-2025-26-appearances.mjs script can only flag a "blended"
 * record if the archive has an entry under the player's CURRENT name to
 * compare against. A player who is genuinely new to the PL this season (never
 * in the 2025-26 archive under any name) falls through that check entirely —
 * exactly what happened to Johan Manzambi (his fpl_id=53 was Donyell Malen's
 * last season, and his row silently inherited Malen's 27 gameweeks of stats).
 *
 * This finds every other player_id with real (minutes>0) 2025-26 stat rows
 * whose current name has NO match anywhere in the archive's players_raw.csv —
 * candidates for the same invisible-to-the-reconciler bug.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

function normalizeName(str) {
  if (!str) return '';
  return str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/ss/g, 'ss').replace(/-/g, ' ').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
}
const PARTICLES = new Set(['de','da','do','dos','das','van','von','del','della','di','la','le','el','al','bin','ibn','den','der','ter','santos','silva','junior']);
function sigTokens(str) {
  return new Set(normalizeName(str).split(' ').filter(t => t.length >= 3 && !PARTICLES.has(t)));
}

// Build archive name index (both exact normalized full name and token-set key)
const playersRaw = readFileSync('/tmp/players_raw.csv', 'utf8').trim().split('\n');
const header = playersRaw[0].split(',');
const fnIdx = header.indexOf('first_name');
const snIdx = header.indexOf('second_name');
const archiveExact = new Set();
const archiveTokenSets = [];
for (const line of playersRaw.slice(1)) {
  const cells = line.split(',');
  const full = `${cells[fnIdx]} ${cells[snIdx]}`;
  archiveExact.add(normalizeName(full));
  archiveTokenSets.push(sigTokens(full));
}
function inArchive(name) {
  if (archiveExact.has(normalizeName(name))) return true;
  const toks = sigTokens(name);
  return archiveTokenSets.some(set => [...toks].some(t => set.has(t)));
}

// Pull every player with real 2025-26 stat rows
let statRows = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin.from('player_stats')
    .select('player_id, gameweek, stats')
    .eq('season', '2025-26').range(from, from + 999);
  if (error) throw error;
  statRows = statRows.concat(data);
  if (data.length < 1000) break;
}
const realRowsByPlayer = new Map();
for (const r of statRows) {
  const mins = Number(r.stats?.minutes_played ?? 0);
  if (mins <= 0) continue;
  if (!realRowsByPlayer.has(r.player_id)) realRowsByPlayer.set(r.player_id, []);
  realRowsByPlayer.get(r.player_id).push(r.gameweek);
}

let players = [];
for (let from = 0; ; from += 1000) {
  const { data, error } = await admin.from('players').select('id, name, pl_team, is_active, fpl_id, created_at').range(from, from + 999);
  if (error) throw error;
  players = players.concat(data);
  if (data.length < 1000) break;
}

console.log(`Players with real (minutes>0) 2025-26 stat rows: ${realRowsByPlayer.size}\n`);

const suspects = [];
for (const [playerId, gws] of realRowsByPlayer) {
  const p = players.find(pl => pl.id === playerId);
  if (!p) continue;
  if (!inArchive(p.name)) {
    suspects.push({ name: p.name, pl_team: p.pl_team, is_active: p.is_active, fpl_id: p.fpl_id, created_at: p.created_at, gwCount: gws.length, gws: gws.sort((a,b)=>a-b) });
  }
}

console.log(`Suspects — real 2025-26 stats, but name NOT found anywhere in the archive: ${suspects.length}\n`);
suspects.sort((a, b) => b.gwCount - a.gwCount).forEach(s => {
  console.log(s.name.padEnd(28), (s.pl_team||'').padEnd(16), 'active=' + s.is_active, 'fpl_id=' + s.fpl_id, 'gws=' + s.gwCount, 'created=' + s.created_at.slice(0,10), JSON.stringify(s.gws.slice(0,10)));
});
