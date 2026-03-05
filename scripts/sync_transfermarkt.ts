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

    const { bestMatch } = stringSimilarity.findBestMatch(tmPlayer.player_name, dbNames);

    if (bestMatch.rating < FUZZY_THRESHOLD) {
      skipped++;
      if (process.argv.includes('--verbose')) {
        console.log(`[skip] "${tmPlayer.player_name}" — best match "${bestMatch.target}" (${bestMatch.rating.toFixed(2)})`);
      }
      continue;
    }

    const dbPlayer = dbPlayers.find((p) => p.name === bestMatch.target)!;
    updates.push({
      id: dbPlayer.id,
      market_value: tmPlayer.market_value,
      name: dbPlayer.name,
      tm_name: tmPlayer.player_name,
      score: bestMatch.rating,
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
}

main().catch((err) => {
  console.error('[fatal]', err);
  process.exit(1);
});
