/**
 * backfill_portrait_crops.ts
 *
 * Measures each player's own PL 500x500 cut-out and stores where their head
 * starts and how wide it is (`players.portrait_head_top_pct` /
 * `portrait_head_width_pct`, migration 134). Portrait.tsx uses these
 * (src/lib/players/portraitCrop.ts) to correct the shared portrait crop
 * per-player instead of applying one fixed zoom/inset to every photo -- see
 * that file's doc comment for why: PL has started serving some players'
 * photos (not just new signings) with the head bigger and flush to the top
 * of the frame instead of the ~13%-down headroom most photos still have.
 *
 * A player with no 500x500 cut-out (photo.ts: ~27% of the pool) is left with
 * both columns NULL -- Portrait.tsx already falls back to the shared crop for
 * that case, same as before this script existed.
 *
 * Usage:
 *   node --experimental-strip-types scripts/backfill_portrait_crops.ts
 *   node --experimental-strip-types scripts/backfill_portrait_crops.ts --apply
 *   node --experimental-strip-types scripts/backfill_portrait_crops.ts --all --apply
 *   node --experimental-strip-types scripts/backfill_portrait_crops.ts --full --apply
 *
 *   --apply   write the measurements (default is dry run)
 *   --all     include inactive players too (default: is_active only)
 *   --full    re-measure players who already have stored values -- for
 *             picking up a photo PL has since replaced (default: skip them)
 */

import { createClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const APPLY = process.argv.includes('--apply');
const ALL = process.argv.includes('--all');
const FULL = process.argv.includes('--full');

const CONCURRENCY = 8;
const PAGE_SIZE = 500;

function loadEnvLocal(): void {
  const envPath = path.join(HERE, '..', '.env.local');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim();
    if (!t || t.startsWith('#')) continue;
    const i = t.indexOf('=');
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    if (!(k in process.env)) process.env[k] = t.slice(i + 1).trim().replace(/^['"]|['"]$/g, '');
  }
}

/** FPL's stable per-player code, pulled back out of the stored photo_url -- see photo.ts. */
function fplPhotoCode(photoUrl: string | null): string | null {
  return /\/(\d+)\.(?:png|jpg)$/i.exec(photoUrl ?? '')?.[1] ?? null;
}

function isBg(r: number, g: number, b: number, a: number): boolean {
  if (a < 10) return true;
  return r > 235 && g > 235 && b > 235;
}

/**
 * Head-top / head-width fractions from the raw pixel bounding box of the
 * non-background subject, same method as scratch/measure_portrait_reference.mjs
 * (which measured the REF_HEAD_WIDTH_FRAC / REF_HEAD_TOP_FRAC constants this
 * data is compared against in portraitCrop.ts).
 */
async function measurePortrait(code: string): Promise<{ headTopPct: number; headWidthPct: number } | null> {
  const res = await fetch(`https://resources.premierleague.com/premierleague25/photos/players/500x500/${code}.png`);
  if (!res.ok) return null; // 403 = no 500x500 cut-out for this player; not an error.

  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  if (w < 400 || h < 400) return null;

  const rowWidths = new Array(h).fill(0);
  for (let y = 0; y < h; y++) {
    let minX = -1;
    let maxX = -1;
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * c;
      if (!isBg(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        if (minX === -1) minX = x;
        maxX = x;
      }
    }
    rowWidths[y] = minX === -1 ? 0 : maxX - minX + 1;
  }

  const topRegion = rowWidths.slice(0, Math.floor(h * 0.35));
  const headWidthPct = Math.max(...topRegion) / w;
  const threshold = w * 0.08;
  const topY = rowWidths.findIndex((wd) => wd > threshold);
  if (topY === -1 || headWidthPct <= 0) return null;

  return { headTopPct: topY / h, headWidthPct };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error('[error] Missing Supabase env');
    process.exit(1);
  }
  const db = createClient(url, key, { auth: { persistSession: false } });

  type Row = {
    id: string;
    name: string;
    photo_url: string | null;
    is_active: boolean;
    portrait_head_top_pct: number | null;
    portrait_head_width_pct: number | null;
  };

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = db
      .from('players')
      .select('id, name, photo_url, is_active, portrait_head_top_pct, portrait_head_width_pct')
      .not('photo_url', 'is', null)
      .range(from, from + PAGE_SIZE - 1);
    if (!ALL) query = query.eq('is_active', true);

    const { data, error } = await query;
    if (error) {
      console.error('[error] fetching players', error.message);
      process.exit(1);
    }
    if (!data || data.length === 0) break;
    rows.push(...(data as Row[]));
    if (data.length < PAGE_SIZE) break;
  }

  const targets = rows.filter((r) => FULL || r.portrait_head_top_pct === null);
  console.log(`[info] ${rows.length} candidate players, ${targets.length} to measure (${APPLY ? 'APPLY' : 'DRY RUN'}${ALL ? ', all' : ', active only'}${FULL ? ', full' : ''})`);

  let measured = 0;
  let noCutout = 0;
  let failed = 0;

  await mapWithConcurrency(targets, CONCURRENCY, async (row) => {
    const code = fplPhotoCode(row.photo_url);
    if (!code) return;
    try {
      const m = await measurePortrait(code);
      if (!m) {
        noCutout++;
        return;
      }
      measured++;
      console.log(
        `${APPLY ? '[write]' : '[dry]  '} ${row.name.padEnd(28)} headTop=${(m.headTopPct * 100).toFixed(1)}%  headWidth=${(m.headWidthPct * 100).toFixed(1)}%`,
      );
      if (APPLY) {
        const { error } = await db
          .from('players')
          .update({ portrait_head_top_pct: m.headTopPct, portrait_head_width_pct: m.headWidthPct })
          .eq('id', row.id);
        if (error) throw error;
      }
    } catch (err) {
      failed++;
      console.error(`[error] ${row.name}:`, err instanceof Error ? err.message : err);
    }
  });

  console.log(`\n[done] measured=${measured} no-cutout=${noCutout} failed=${failed}`);
  if (!APPLY) console.log('[info] dry run -- pass --apply to write these values');
}

main();
