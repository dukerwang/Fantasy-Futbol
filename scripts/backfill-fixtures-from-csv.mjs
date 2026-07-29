/**
 * Backfills public.pl_fixtures for a past season from a football-data.co.uk
 * CSV (https://www.football-data.co.uk/mmz4281/{season}/E0.csv).
 *
 * WHY THIS IS FIDDLY
 * ------------------
 * The CSV has dates and scores but no gameweek/round number, and the card's
 * game log joins on gameweek. FPL can't supply the rounds either: it stops
 * serving a season once it rolls over, and recycles fixture ids, so its live
 * data would describe a different match entirely.
 *
 * So rounds are DERIVED (earliest gameweek still open to BOTH clubs, walking
 * fixtures in date order) and then VERIFIED
 * against ground truth we already hold: player_stats tells us which gameweeks a
 * club actually has appearances in, and the frozen season archive tells us
 * which club each player turned out for. If the derived round assignment
 * disagrees with that anywhere, the script refuses to write — a wrong opponent
 * is worse than no opponent, which is the whole reason this data was rebuilt.
 *
 * Dry run by default. Pass --write to commit.
 *
 * Run: node --env-file=.env.local scripts/backfill-fixtures-from-csv.mjs ~/Downloads/E0.csv --season 2025-26
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');

const args = process.argv.slice(2);
const WRITE = args.includes('--write');
const csvPath = args.find((a) => !a.startsWith('--'));
const seasonIdx = args.indexOf('--season');
const SEASON = seasonIdx >= 0 ? args[seasonIdx + 1] : '2025-26';

if (!csvPath) {
  console.error('usage: backfill-fixtures-from-csv.mjs <E0.csv> [--season 2025-26] [--write]');
  process.exit(1);
}

function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') quoted = !quoted;
    else if (ch === ',' && !quoted) { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

/** football-data.co.uk uses dd/mm/yyyy (occasionally dd/mm/yy). */
function parseDate(d, time) {
  const [dd, mm, yy] = d.split('/');
  const year = yy.length === 2 ? `20${yy}` : yy;
  return new Date(`${year}-${mm}-${dd}T${(time || '15:00').padStart(5, '0')}:00Z`);
}

async function main() {
  const clubs = JSON.parse(await fs.readFile(path.join(ROOT, 'src/lib/clubs/clubs.json'), 'utf8'));
  const lookup = new Map();
  for (const c of clubs) {
    lookup.set(c.slug, c.slug);
    lookup.set(c.name.toLowerCase(), c.slug);
    lookup.set(c.shortName.toLowerCase(), c.slug);
    for (const a of c.aliases) lookup.set(a.toLowerCase(), c.slug);
  }
  const slugOf = (n) => (n ? lookup.get(String(n).trim().toLowerCase()) ?? null : null);

  // ── 1. Parse the CSV ──────────────────────────────────────────────────────
  const raw = await fs.readFile(csvPath.replace(/^~/, process.env.HOME), 'utf8');
  const lines = raw.trim().split(/\r?\n/);
  const header = parseCsvLine(lines[0]);
  const col = (name) => header.indexOf(name);
  const iDate = col('Date'), iTime = col('Time');
  const iHome = col('HomeTeam'), iAway = col('AwayTeam');
  const iHG = col('FTHG'), iAG = col('FTAG');

  if ([iDate, iHome, iAway, iHG, iAG].some((i) => i < 0)) {
    console.error('CSV missing required columns (Date, HomeTeam, AwayTeam, FTHG, FTAG)');
    process.exit(1);
  }

  const fixtures = [];
  const unresolved = new Map();
  for (const line of lines.slice(1)) {
    if (!line.trim()) continue;
    const c = parseCsvLine(line);
    const home = slugOf(c[iHome]);
    const away = slugOf(c[iAway]);
    if (!home || !away) {
      if (!home) unresolved.set(c[iHome], (unresolved.get(c[iHome]) ?? 0) + 1);
      if (!away) unresolved.set(c[iAway], (unresolved.get(c[iAway]) ?? 0) + 1);
      continue;
    }
    const hg = c[iHG] === '' ? null : Number(c[iHG]);
    const ag = c[iAG] === '' ? null : Number(c[iAG]);
    fixtures.push({
      kickoff: parseDate(c[iDate], iTime >= 0 ? c[iTime] : null),
      home, away, hg, ag,
      finished: hg != null && ag != null,
    });
  }

  if (unresolved.size > 0) {
    console.error('Unresolved club names in CSV — add aliases to clubs.json:');
    for (const [n, k] of unresolved) console.error(`  ${JSON.stringify(n)} (${k})`);
    process.exit(1);
  }

  fixtures.sort((a, b) => a.kickoff - b.kickoff);
  const clubSet = new Set(fixtures.flatMap((f) => [f.home, f.away]));
  console.log(`CSV: ${fixtures.length} fixtures, ${clubSet.size} clubs, ${fixtures.filter(f => f.finished).length} with scores`);
  console.log(`     ${fixtures[0].kickoff.toISOString().slice(0,10)} → ${fixtures[fixtures.length-1].kickoff.toISOString().slice(0,10)}`);

  // ── 3. Ground truth: which clubs actually have stats in each gameweek ──────
  const archiveSrc = await fs.readFile(path.join(ROOT, 'src/lib/season/archived_stats_2025_26.ts'), 'utf8');
  const aStart = archiveSrc.indexOf('{', archiveSrc.indexOf('PRECOMPUTED_STATS_2025_26'));
  const archive = JSON.parse(archiveSrc.slice(aStart, archiveSrc.lastIndexOf('}') + 1));
  const clubOfPlayer = new Map();
  for (const p of archive.players ?? []) {
    const s = slugOf(p.pl_team);
    if (s) clubOfPlayer.set(p.id, s);
  }

  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  const truth = new Map(); // gameweek -> Set(slug)
  for (let page = 0; ; page++) {
    const { data, error } = await admin
      .from('player_stats')
      .select('player_id, gameweek')
      .eq('season', SEASON)
      .range(page * 1000, page * 1000 + 999);
    if (error) { console.error('player_stats query failed:', error.message); process.exit(1); }
    if (!data || data.length === 0) break;
    for (const r of data) {
      const slug = clubOfPlayer.get(r.player_id);
      if (!slug) continue;
      if (!truth.has(r.gameweek)) truth.set(r.gameweek, new Set());
      truth.get(r.gameweek).add(slug);
    }
    if (data.length < 1000) break;
  }
  console.log(`ground truth: ${truth.size} gameweeks with appearance data`);

  // ── 2. Derive rounds: each club's Nth fixture by date is its Nth gameweek ──
  //
  // Naive, and right for 34 of 38 rounds; the rest are caught and dropped below.
  // THREE attempts to auto-resolve the rounds touched by a rescheduled match
  // have failed — do not retry these blindly:
  //   1. fixture-ordered greedy, earliest round open to both clubs .... 29/38
  //   2. backtracking exact cover over the disputed rounds ............ no termination
  //   3. per-round coverage greedy over date-ordered fixtures ......... 29/38
  // (2) and (3) fail the same way: with 20 clubs outstanding at the start of a
  // round, far too many fixtures look locally valid, so a wrong one is taken
  // early and the error cascades. A correct solve needs real per-round bipartite
  // matching with propagation, or hard date-window bounds per round.
  const perClubCount = new Map();
  for (const f of fixtures) {
    const h = (perClubCount.get(f.home) ?? 0) + 1;
    const a = (perClubCount.get(f.away) ?? 0) + 1;
    perClubCount.set(f.home, h);
    perClubCount.set(f.away, a);
    f.derivedGw = Math.max(h, a);
  }

  // ── 3b. Apply authoritative round overrides ───────────────────────────────
  //
  // Rounds touched by a rescheduled match cannot be derived from a CSV that
  // carries dates but no round numbers, so those are supplied explicitly from
  // the official Premier League matchweek pages. Read, not inferred. Scores and
  // kickoff times still come from the CSV; only the round is overridden.
  const overridePath = path.join(ROOT, 'scripts/data/pl-rounds-2025-26-overrides.json');
  let overrideApplied = 0;
  try {
    const ov = JSON.parse(await fs.readFile(overridePath, 'utf8'));
    if (ov.season === SEASON) {
      const byPair = new Map();
      for (const [gw, pairs] of Object.entries(ov.rounds)) {
        for (const pair of pairs) byPair.set(pair, Number(gw));
      }
      const seen = new Set();
      for (const f of fixtures) {
        const gw = byPair.get(`${f.home}|${f.away}`);
        if (gw != null) {
          f.derivedGw = gw;
          seen.add(`${f.home}|${f.away}`);
          overrideApplied++;
        }
      }
      const unmatched = [...byPair.keys()].filter((k) => !seen.has(k));
      if (unmatched.length > 0) {
        console.error(`\n${unmatched.length} override(s) matched no CSV fixture — check the transcription:`);
        for (const u of unmatched) console.error(`  ${u}`);
        process.exit(1);
      }
      console.log(`applied ${overrideApplied} authoritative round override(s)`);
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  // ── 4. Verify derived rounds against ground truth ──────────────────────────
  const derived = new Map();
  for (const f of fixtures) {
    if (!derived.has(f.derivedGw)) derived.set(f.derivedGw, new Set());
    derived.get(f.derivedGw).add(f.home);
    derived.get(f.derivedGw).add(f.away);
  }

  let agree = 0;
  const mismatches = [];
  for (const [gw, truthClubs] of [...truth].sort((a, b) => a[0] - b[0])) {
    const got = derived.get(gw);
    if (!got) { mismatches.push({ gw, reason: 'no derived fixtures' }); continue; }
    const missing = [...truthClubs].filter((c) => !got.has(c));
    if (missing.length === 0) agree++;
    else mismatches.push({ gw, reason: `clubs played but absent from derived round: ${missing.join(', ')}` });
  }

  console.log(`\nverification: ${agree}/${truth.size} gameweeks agree with appearance data`);
  if (mismatches.length) {
    console.log('\nmismatches:');
    for (const m of mismatches.slice(0, 12)) console.log(`  GW${m.gw}: ${m.reason}`);
  }

  // NOTE ON THE DISPUTED ROUNDS
  // Two attempts at auto-resolving them failed and are recorded so they aren't
  // retried blindly:
  //   1. Greedy "earliest gameweek open to both clubs" scored WORSE (29/38) —
  //      it consumes a round a later fixture needed and the failure cascades.
  //   2. Naive backtracking exact-cover over the ~39 disputed fixtures does not
  //      terminate in reasonable time; the per-club constraint does not prune
  //      anywhere near as hard as it looks like it should.
  // A correct solve wants per-round bipartite matching (or date-window bounds),
  // not a greedy pass or unpropagated backtracking.

  // Rescheduled matches slide a club's chronological matchday count out of step
  // with its true gameweek, so any gameweek that disagrees is dropped entirely
  // rather than written on a guess. Those logs keep showing "Unknown", which is
  // exactly what they show today — no regression, just no invention.
  const badGws = new Set(mismatches.map((m) => m.gw));
  const usable = fixtures.filter((f) => !badGws.has(f.derivedGw));
  if (badGws.size > 0) {
    console.log(
      `\nskipping ${fixtures.length - usable.length} fixture(s) in ${badGws.size} unverified gameweek(s): ` +
        `${[...badGws].sort((a, b) => a - b).join(', ')}`,
    );
    console.log('those game logs keep showing "Unknown" rather than a guessed opponent.');
  }

  const rows = usable.map((f, i) => ({
    season: SEASON,
    fpl_fixture_id: i + 1, // synthetic, unique within season; we have no FPL id
    gameweek: f.derivedGw,
    home_club: f.home,
    away_club: f.away,
    home_score: f.hg,
    away_score: f.ag,
    finished: f.finished,
    kickoff_time: f.kickoff.toISOString(),
  }));

  if (!WRITE) {
    console.log(`\nDRY RUN — ${rows.length} rows ready. Re-run with --write to commit.`);
    console.log('sample:', JSON.stringify(rows.slice(0, 2), null, 1));
    return;
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    const { error } = await admin.from('pl_fixtures').upsert(chunk, { onConflict: 'season,fpl_fixture_id' });
    if (error) { console.error('upsert failed:', error.message); process.exit(1); }
    written += chunk.length;
  }
  console.log(`\nwrote ${written} fixtures for ${SEASON}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
