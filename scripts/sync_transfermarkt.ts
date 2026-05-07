/**
 * sync_transfermarkt.ts
 *
 * Pulls real-world player market values from Transfermarkt via the
 * dcaribou/transfermarkt-scraper Python CLI, fuzzy-matches them against
 * our Supabase players table, and bulk-updates market_value.
 *
 * Prerequisites:
 *   1. Clone the scraper into scripts/scrapers:
 *        git clone https://github.com/dcaribou/transfermarkt-scraper scripts/scrapers/transfermarkt-scraper
 *   2. Install its Python dependencies (requires Poetry):
 *        cd scripts/scrapers/transfermarkt-scraper && poetry install
 *   3. Ensure SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are in .env.local
 *
 * Usage:
 *   npx tsx scripts/sync_transfermarkt.ts
 *   npx tsx scripts/sync_transfermarkt.ts --dry-run   # preview without writing
 */

import { spawn } from 'child_process';
import { createClient } from '@supabase/supabase-js';
import stringSimilarity from 'string-similarity';
import * as fs from 'fs';
import * as path from 'path';

// ── Config ────────────────────────────────────────────────────────────────────

const SCRAPER_DIR = path.join(__dirname, 'scrapers', 'transfermarkt-scraper');
const FUZZY_THRESHOLD = 0.72;   // minimum similarity score to accept a match
const DRY_RUN = process.argv.includes('--dry-run');

// ── Load .env.local ───────────────────────────────────────────────────────────

function loadEnvLocal(): void {
  const envPath = path.join(__dirname, '..', '.env.local');
  if (!fs.existsSync(envPath)) {
    console.warn('[warn] .env.local not found — relying on existing process.env');
    return;
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const val = trimmed.slice(eqIdx + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!(key in process.env)) process.env[key] = val;
  }
}

// ── Market value parser ───────────────────────────────────────────────────────
// Handles strings like "€80.00m", "€500k", "€1.20bn", "-", ""

function parseMarketValue(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return isNaN(raw) ? null : raw;

  const s = String(raw).trim().replace(/,/g, '').replace(/\s/g, '');
  if (!s || s === '-' || s === 'N/A') return null;

  // Strip currency symbol
  const clean = s.replace(/^[€$£]/, '');

  const lower = clean.toLowerCase();
  if (lower.endsWith('bn')) return parseFloat(lower) * 1000;
  if (lower.endsWith('m')) return parseFloat(lower);
  if (lower.endsWith('k')) return parseFloat(lower) / 1000;

  const num = parseFloat(clean);
  return isNaN(num) ? null : num;
}

// ── Run the Python scraper ────────────────────────────────────────────────────

interface TmPlayer {
  player_name: string;
  market_value_raw: string;
  market_value: number | null;
  club_name: string;
}

function runScraper(): Promise<TmPlayer[]> {
  return new Promise((resolve, reject) => {
    try {
      console.log('[scraper] Reading scripts/players.json...');
      const raw = fs.readFileSync(path.join(__dirname, 'players.json'), 'utf-8');
      const parsed = JSON.parse(raw);

      const players: TmPlayer[] = [];
      for (const row of parsed) {
        const name = row.player_name;
        const mvRaw = row.market_value_raw;
        if (!name) continue;
        players.push({
          player_name: name,
          market_value_raw: mvRaw,
          market_value: parseMarketValue(mvRaw),
          club_name: row.club_name,
        });
      }
      console.log(`[scraper] Parsed ${players.length} players from Transfermarkt`);
      resolve(players);
    } catch (e) {
      reject(e);
    }
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  loadEnvLocal();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    console.error('[error] Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in env');
    process.exit(1);
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // 1. Fetch all active players from our DB
  console.log('[db] Fetching players from Supabase…');
  const { data: dbPlayers, error: dbError } = await supabase
    .from('players')
    .select('id, name, pl_team, market_value')
    .eq('is_active', true);

  if (dbError || !dbPlayers) {
    console.error('[db] Failed to fetch players:', dbError?.message);
    process.exit(1);
  }
  console.log(`[db] Loaded ${dbPlayers.length} active players`);

  // 2. Run the scraper
  const tmPlayers = await runScraper();

  if (tmPlayers.length === 0) {
    console.error('[error] Scraper returned no players. Aborting.');
    process.exit(1);
  }

  // ── Subset Word Matching helper ───────────────────────────────────────────────
  function normalizeMatchName(name: string) {
    return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
  }

  function wordsMatch(tmName: string, dbName: string) {
    const normTM = normalizeMatchName(tmName);
    const normDB = normalizeMatchName(dbName);
    const tmParts = normTM.split(/\s+/);
    return tmParts.every((part) => normDB.includes(part));
  }

  // 3. Build fuzzy-match index from DB player names
  const dbNames = dbPlayers.map((p) => p.name);

  let matched = 0;
  let skipped = 0;
  let noValue = 0;
  const updates: Array<{ id: string; market_value: number; name: string; tm_name: string; score: number }> = [];

  for (const tmPlayer of tmPlayers) {
    if (tmPlayer.market_value == null) {
      noValue++;
      continue;
    }

    let matchTarget = null;
    let matchScore = 0;

    // 1. Try Subset Words Match (solves Brazilian short names vs FPL long names)
    // Avoid very short name false positives by checking subset only if >1 part or long enough
    const isShortTM = tmPlayer.player_name.split(' ').length === 1 && tmPlayer.player_name.length <= 5;
    const subsetMatch = !isShortTM ? dbNames.find(dbName => wordsMatch(tmPlayer.player_name, dbName)) : null;

    if (subsetMatch) {
      matchTarget = subsetMatch;
      matchScore = 1.0;
    } else {
      // 2. Fall back to mathematical fuzzy Match Score
      const { bestMatch } = stringSimilarity.findBestMatch(tmPlayer.player_name, dbNames);
      if (bestMatch.rating >= FUZZY_THRESHOLD) {
        matchTarget = bestMatch.target;
        matchScore = bestMatch.rating;
      }
    }

    if (!matchTarget) {
      skipped++;
      if (process.argv.includes('--verbose')) {
        const { bestMatch } = stringSimilarity.findBestMatch(tmPlayer.player_name, dbNames);
        console.log(`[skip] "${tmPlayer.player_name}" — best match "${bestMatch.target}" (${bestMatch.rating.toFixed(2)})`);
      }
      continue;
    }

    const dbPlayer = dbPlayers.find((p) => p.name === matchTarget)!;
    updates.push({
      id: dbPlayer.id,
      market_value: tmPlayer.market_value,
      name: dbPlayer.name,
      tm_name: tmPlayer.player_name,
      score: matchScore,
    });
    matched++;
  }

  console.log(`\n[match] Results: ${matched} matched · ${skipped} below threshold (${FUZZY_THRESHOLD}) · ${noValue} no TM value`);

  if (updates.length === 0) {
    console.log('[done] No updates to apply.');
    return;
  }

  if (DRY_RUN) {
    console.log('\n[dry-run] Would update:');
    for (const u of updates.slice(0, 20)) {
      console.log(`  ${u.name} (TM: ${u.tm_name}, score: ${u.score.toFixed(2)}) → £${u.market_value}m`);
    }
    if (updates.length > 20) console.log(`  … and ${updates.length - 20} more`);
    return;
  }

  // 4. Bulk-update in batches of 50
  console.log(`\n[db] Writing ${updates.length} market_value updates…`);
  const BATCH = 50;
  let written = 0;

  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    await Promise.all(
      batch.map((u) =>
        supabase
          .from('players')
          .update({
            market_value: u.market_value,
            market_value_updated_at: new Date().toISOString(),
          })
          .eq('id', u.id),
      ),
    );
    written += batch.length;
    process.stdout.write(`\r[db] ${written}/${updates.length} updated…`);
  }

  console.log(`\n[done] Successfully updated ${written} player market values from Transfermarkt.`);

  // Step 5: Seed system FAAB auctions for players who just crossed the £40m threshold
  // for the first time (previous value was null or < 40) and are currently unowned.

  const AUCTION_THRESHOLD = 40.0; // £40m Transfermarkt value
  const AUCTION_WINDOW_HOURS = 48;

  // Build a map of pre-update market values (fetched before any writes in step 4)
  // `dbPlayers` was fetched at the top of the script — it has the old values.
  const prevValueById = new Map(dbPlayers.map(p => [p.id, p.market_value as number | null]));

  // Find players whose market_value just crossed £40m for the first time
  const thresholdCrossers = updates.filter(u => {
    if (u.market_value < AUCTION_THRESHOLD) return false;
    const prev = prevValueById.get(u.id) ?? null;
    return prev == null || prev < AUCTION_THRESHOLD;
  });

  if (thresholdCrossers.length === 0) {
    console.log('\n[auctions] No new threshold crossers — no system auctions to create.');
  } else {
    console.log(`\n[auctions] ${thresholdCrossers.length} player(s) crossed £${AUCTION_THRESHOLD}m threshold.`);

    // 1. Fetch all league IDs
    const { data: leagues } = await supabase.from('leagues').select('id');
    if (!leagues || leagues.length === 0) {
      console.log('[auctions] No leagues found — skipping.');
    } else {
      const crosserIds = thresholdCrossers.map(u => u.id);

      // 2. Find which crossers are already owned in any league
      const { data: ownedEntries } = await supabase
        .from('roster_entries')
        .select('player_id')
        .in('player_id', crosserIds);
      const ownedPlayerIds = new Set((ownedEntries ?? []).map(e => e.player_id));

      // 3. Find which crossers already have an open pending auction
      const { data: existingAuctions } = await supabase
        .from('waiver_claims')
        .select('player_id')
        .in('player_id', crosserIds)
        .eq('is_auction', true)
        .eq('status', 'pending');
      const alreadyAuctioned = new Set((existingAuctions ?? []).map(a => a.player_id));

      // 4. Filter to eligible players
      const eligible = thresholdCrossers.filter(u =>
        !ownedPlayerIds.has(u.id) && !alreadyAuctioned.has(u.id)
      );

      console.log(`[auctions] ${eligible.length} eligible (${thresholdCrossers.length - eligible.length} already owned or in auction)`);

      if (eligible.length > 0 && !DRY_RUN) {
        const expiresAt = new Date(Date.now() + AUCTION_WINDOW_HOURS * 60 * 60 * 1000).toISOString();

        const auctionRows = eligible.flatMap(player =>
          leagues.map(league => ({
            league_id: league.id,
            team_id: null,
            player_id: player.id,
            faab_bid: 0,
            status: 'pending',
            is_auction: true,
            expires_at: expiresAt,
          }))
        );

        const { error: auctionErr } = await supabase.from('waiver_claims').insert(auctionRows);
        if (auctionErr) {
          console.error('[auctions] Failed to seed auctions:', auctionErr.message);
        } else {
          console.log(`[auctions] ✓ Created ${auctionRows.length} auction entries (${eligible.length} players × ${leagues.length} leagues)`);
          for (const p of eligible) {
            console.log(`  → ${p.name} (£${p.market_value}m)`);
          }
        }
      } else if (DRY_RUN) {
        console.log('[auctions][dry-run] Would create auctions for:');
        for (const p of eligible) {
          console.log(`  → ${p.name} (£${p.market_value}m)`);
        }
      }
    }
  }
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
