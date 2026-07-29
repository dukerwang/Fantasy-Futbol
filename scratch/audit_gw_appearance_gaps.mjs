// Finds gameweeks where a club's match produced no appearance data at all —
// the failure behind Welbeck's GW34 "DNP" against Chelsea. A live sync that
// runs before some of a round's fixtures kick off writes placeholder rows
// (synthetic match_id, 0 minutes) for those squads, and nothing re-syncs the
// gameweek afterwards, so the placeholders become the permanent record.
//
// Run with: node scratch/audit_gw_appearance_gaps.mjs [season]
import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = Object.fromEntries(
  fs.readFileSync('/Users/dukewang/Fantasy Futbol/.env.local', 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; })
);
const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);
const SEASON = process.argv[2] ?? '2025-26';

async function page(table, select, apply = (q) => q) {
  const out = [];
  for (let p = 0; ; p++) {
    const { data, error } = await apply(admin.from(table).select(select)).range(p * 1000, p * 1000 + 999);
    if (error) throw new Error(`${table}: ${error.message}`);
    if (!data?.length) break;
    out.push(...data);
    if (data.length < 1000) break;
  }
  return out;
}

const seasonClubs = await page('player_season_clubs', 'player_id, club_slug', (q) => q.eq('season', SEASON));
const clubOf = new Map(seasonClubs.map((r) => [r.player_id, r.club_slug]));

const stats = await page('player_stats', 'player_id, gameweek, match_id, stats', (q) => q.eq('season', SEASON));
const fixtures = await page('pl_fixtures', 'gameweek, home_club, away_club, finished', (q) => q.eq('season', SEASON));

// club → gameweeks it was scheduled to play
const scheduled = new Map();
for (const f of fixtures) {
  for (const club of [f.home_club, f.away_club]) {
    if (!scheduled.has(club)) scheduled.set(club, new Set());
    scheduled.get(club).add(f.gameweek);
  }
}

// (gameweek, club) → appearances recorded
const seen = new Map();
for (const r of stats) {
  const club = clubOf.get(r.player_id);
  if (!club) continue;
  const key = `${r.gameweek}|${club}`;
  const b = seen.get(key) ?? { played: 0, rows: 0, synthetic: 0 };
  b.rows++;
  if (Number(r.stats?.minutes_played ?? 0) > 0) b.played++;
  if (r.match_id >= 1000) b.synthetic++;
  seen.set(key, b);
}

const gaps = [];
for (const [club, gws] of scheduled) {
  for (const gw of gws) {
    const b = seen.get(`${gw}|${club}`) ?? { played: 0, rows: 0, synthetic: 0 };
    // A played match yields ~14-16 appearances. Anything under 11 is a hole,
    // not a rotation quirk.
    if (b.played < 11) {
      gaps.push({ gw, club, appearances: b.played, rows: b.rows, placeholder_rows: b.synthetic });
    }
  }
}

gaps.sort((a, b) => a.gw - b.gw || a.club.localeCompare(b.club));
console.log(`${SEASON}: ${gaps.length} (gameweek, club) fixtures with missing appearance data\n`);
console.table(gaps);

const byGw = new Map();
for (const g of gaps) byGw.set(g.gw, (byGw.get(g.gw) ?? 0) + 1);
console.log('\nclubs affected per gameweek:', [...byGw.entries()].map(([gw, n]) => `GW${gw}: ${n}`).join(', ') || 'none');
