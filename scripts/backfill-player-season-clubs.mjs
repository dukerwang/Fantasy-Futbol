/**
 * Backfills public.player_season_clubs for 2025-26.
 *
 * Two sources (pick one):
 *
 *   1. FPL archive (preferred after a rollover):
 *        node --env-file=.env.local scripts/backfill-player-season-clubs.mjs \
 *          --from-fpl <players_raw.csv> <teams.csv> [--gaps-only]
 *      Matches on the stable FPL code embedded in players.photo_url. Team names
 *      come from that season's teams.csv, so summer transfers and recycled FPL
 *      team ids cannot poison the lookup.
 *
 *   2. Frozen snapshot (only safe if the snapshot still carries 2025-26 clubs):
 *        node --env-file=.env.local scripts/backfill-player-season-clubs.mjs
 *      `players.pl_team` must NOT be used: sync overwrites it every season.
 *
 * `--gaps-only` upserts only players who do not yet have a 2025-26 row, so a
 * contaminated snapshot cannot overwrite correct clubs already written.
 *
 * Idempotent — upserts on (player_id, season).
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const SEASON = '2025-26';

const ARCHIVE = path.join(ROOT, 'src', 'lib', 'season', 'archived_stats_2025_26.ts');
const CLUBS = path.join(ROOT, 'src', 'lib', 'clubs', 'clubs.json');

const args = process.argv.slice(2);
const gapsOnly = args.includes('--gaps-only');
const fromFplIdx = args.indexOf('--from-fpl');
const fromFpl = fromFplIdx >= 0;
const playersCsv = fromFpl ? args[fromFplIdx + 1] : null;
const teamsCsv = fromFpl ? args[fromFplIdx + 2] : null;

if (fromFpl && (!playersCsv || !teamsCsv || playersCsv.startsWith('--') || teamsCsv.startsWith('--'))) {
  console.error('usage: --from-fpl <players_raw.csv> <teams.csv> [--gaps-only]');
  process.exit(1);
}

function splitCsvLine(line) {
  const out = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

async function readCsv(file) {
  const text = await fs.readFile(file, 'utf8');
  const lines = text.trim().split('\n');
  const header = splitCsvLine(lines[0]);
  return lines.slice(1).map((l) => {
    const cells = splitCsvLine(l);
    const row = {};
    header.forEach((h, i) => {
      row[h] = cells[i];
    });
    return row;
  });
}

function fplCodeOf(photoUrl) {
  if (!photoUrl) return null;
  const m = String(photoUrl).match(/\/(\d+)\.(?:png|jpg)(?:\?|$)/i);
  return m ? m[1] : null;
}

async function main() {
  const clubs = JSON.parse(await fs.readFile(CLUBS, 'utf8'));
  const lookup = new Map();
  for (const c of clubs) {
    lookup.set(c.slug, c.slug);
    lookup.set(c.name.toLowerCase(), c.slug);
    lookup.set(c.shortName.toLowerCase(), c.slug);
    for (const a of c.aliases) lookup.set(a.toLowerCase(), c.slug);
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  /** @type {{ player_id: string, season: string, club_slug: string }[]} */
  let rows = [];
  const unresolved = new Map();
  /** The 20 Premier League clubs that actually contested this season. */
  let seasonClubSlugs = new Set();

  if (fromFpl) {
    const teams = await readCsv(teamsCsv);
    const fplPlayers = await readCsv(playersCsv);
    const teamNameById = new Map(teams.map((t) => [String(t.id), t.name]));

    for (const t of teams) {
      const slug = lookup.get(String(t.name).trim().toLowerCase());
      if (slug) seasonClubSlugs.add(slug);
      else unresolved.set(`team:${t.name}`, 1);
    }
    if (seasonClubSlugs.size !== 20) {
      console.error(`Expected 20 season clubs from teams.csv, got ${seasonClubSlugs.size}`);
      for (const [k, n] of unresolved) console.error(`  ${k} (${n})`);
      process.exit(1);
    }

    const byCode = new Map();
    for (const p of fplPlayers) {
      if (p.code) byCode.set(String(p.code), p);
    }
    console.log(`FPL archive: ${fplPlayers.length} players, ${seasonClubSlugs.size} clubs`);

    // Pull every live player (photo code is the join key).
    const live = [];
    for (let page = 0; ; page++) {
      const { data, error } = await admin
        .from('players')
        .select('id, name, web_name, photo_url')
        .range(page * 1000, page * 1000 + 999);
      if (error) {
        console.error('players query failed:', error.message);
        process.exit(1);
      }
      if (!data || data.length === 0) break;
      live.push(...data);
      if (data.length < 1000) break;
    }

    let matched = 0;
    let noCode = 0;
    let notInArchive = 0;
    let badClub = 0;

    for (const p of live) {
      const code = fplCodeOf(p.photo_url);
      if (!code) {
        noCode++;
        continue;
      }
      const fpl = byCode.get(code);
      if (!fpl) {
        notInArchive++;
        continue;
      }
      const teamName = teamNameById.get(String(fpl.team));
      const slug = teamName ? lookup.get(teamName.trim().toLowerCase()) : null;
      if (!slug || !seasonClubSlugs.has(slug)) {
        badClub++;
        unresolved.set(teamName ?? `team_id:${fpl.team}`, (unresolved.get(teamName ?? fpl.team) ?? 0) + 1);
        continue;
      }
      rows.push({ player_id: p.id, season: SEASON, club_slug: slug });
      matched++;
    }

    console.log(`matched ${matched} (no photo code: ${noCode}, not in archive: ${notInArchive}, non-season club: ${badClub})`);
  } else {
    const src = await fs.readFile(ARCHIVE, 'utf8');
    const start = src.indexOf('{', src.indexOf('PRECOMPUTED_STATS_2025_26'));
    const end = src.lastIndexOf('}');
    const archive = JSON.parse(src.slice(start, end + 1));
    const players = archive.players ?? [];
    console.log(`archive players: ${players.length}`);

    for (const p of players) {
      const slug = p.pl_team ? lookup.get(String(p.pl_team).trim().toLowerCase()) : null;
      if (!slug) {
        unresolved.set(p.pl_team, (unresolved.get(p.pl_team) ?? 0) + 1);
        continue;
      }
      seasonClubSlugs.add(slug);
      rows.push({ player_id: p.id, season: SEASON, club_slug: slug });
    }

    if (unresolved.size > 0) {
      console.error('\nUnresolved club names — aborting rather than writing partial data:');
      for (const [name, n] of unresolved) console.error(`  ${JSON.stringify(name)} (${n})`);
      process.exit(1);
    }

    if (seasonClubSlugs.size !== 20) {
      console.error(
        `\nExpected 20 clubs for a Premier League season, got ${seasonClubSlugs.size}. ` +
          `Aborting — the snapshot's pl_team field is likely polluted with the current season. ` +
          `Re-run with --from-fpl <players_raw.csv> <teams.csv> instead.`,
      );
      console.error([...seasonClubSlugs].sort().join(', '));
      process.exit(1);
    }

    const live = new Set();
    for (let page = 0; ; page++) {
      const { data, error } = await admin.from('players').select('id').range(page * 1000, page * 1000 + 999);
      if (error) {
        console.error('players query failed:', error.message);
        process.exit(1);
      }
      if (!data || data.length === 0) break;
      for (const p of data) live.add(p.id);
      if (data.length < 1000) break;
    }

    const before = rows.length;
    rows = rows.filter((r) => live.has(r.player_id));
    if (rows.length < before) {
      console.log(`dropped ${before - rows.length} archived player(s) no longer in the players table`);
    }
  }

  console.log(`resolved: ${rows.length} players across ${seasonClubSlugs.size} clubs`);
  console.log([...seasonClubSlugs].sort().join(', '));

  if (gapsOnly) {
    const existing = new Set();
    for (let page = 0; ; page++) {
      const { data, error } = await admin
        .from('player_season_clubs')
        .select('player_id')
        .eq('season', SEASON)
        .range(page * 1000, page * 1000 + 999);
      if (error) {
        console.error('existing clubs query failed:', error.message);
        process.exit(1);
      }
      if (!data || data.length === 0) break;
      for (const r of data) existing.add(r.player_id);
      if (data.length < 1000) break;
    }
    const before = rows.length;
    rows = rows.filter((r) => !existing.has(r.player_id));
    console.log(`gaps-only: ${rows.length} of ${before} candidates are new (${existing.size} already stored)`);
  }

  if (rows.length === 0) {
    console.log('\nnothing to write');
    return;
  }

  // Preview a few names for sanity.
  const sampleIds = rows.slice(0, 8).map((r) => r.player_id);
  const { data: samplePlayers } = await admin.from('players').select('id, name, web_name').in('id', sampleIds);
  const nameById = new Map((samplePlayers ?? []).map((p) => [p.id, p.web_name || p.name]));
  console.log('\nsample upserts:');
  for (const r of rows.slice(0, 8)) {
    console.log(`  ${nameById.get(r.player_id) ?? r.player_id} → ${r.club_slug}`);
  }

  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await admin.from('player_season_clubs').upsert(chunk, { onConflict: 'player_id,season' });
    if (error) {
      console.error('upsert failed:', error.message);
      process.exit(1);
    }
    written += chunk.length;
  }

  console.log(`\nwrote ${written} rows to player_season_clubs for ${SEASON}`);
  if (unresolved.size > 0) {
    console.log('\nskipped non-season clubs:');
    for (const [name, n] of unresolved) console.log(`  ${JSON.stringify(name)} (${n})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
