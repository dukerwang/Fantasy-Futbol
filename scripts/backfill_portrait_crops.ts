/**
 * backfill_portrait_crops.ts
 *
 * Measures each player's own PL cut-outs and stores where their head starts
 * and how wide it is, for BOTH sources (photo.ts):
 *   - 500x500 square  -> portrait_head_top_pct / portrait_head_width_pct (134)
 *   - 220x280 tall     -> portrait_tall_head_top_pct / portrait_tall_head_width_pct (135)
 * Portrait.tsx (avatars) and PremiumPlayerCard.tsx (the roster Inspector /
 * PlayerDetailsModal flip-card) each use one of these sources as their
 * primary image and correct against the matching measurement
 * (src/lib/players/portraitCrop.ts) instead of applying one fixed zoom/inset
 * to every photo -- see that file's doc comment for why: PL has started
 * serving some players' photos (not just new signings, and not always both
 * sources in sync) with the head bigger and flush to the top of the frame
 * instead of the ~13%-down headroom most photos still have.
 *
 * A player missing a given cut-out (photo.ts: ~27% of the pool has no
 * 500x500) is left with that pair of columns NULL -- both components already
 * fall back to their shared default crop for that case, same as before this
 * script existed.
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
async function measurePortrait(
  code: string,
  size: '500x500' | '110x140',
): Promise<{ headTopPct: number; headWidthPct: number; lastModified: string | null } | null> {
  const res = await fetch(`https://resources.premierleague.com/premierleague25/photos/players/${size}/${code}.png`);
  if (!res.ok) return null; // 403 = no cut-out at this size for this player; not an error.

  // Captured for players.photo_version (migration 136) -- PL sends no
  // Cache-Control on these images, so this is what tells the browser a
  // player's photo changed and its cached copy needs refetching. See
  // photo.ts's doc comment.
  const lastModified = res.headers.get('last-modified');

  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  // PL serves these at 2x (500x500 -> 500px, 110x140 -> 220x280) -- a genuine
  // image is always near that; anything much smaller is a 403's error body.
  const minWidth = size === '500x500' ? 400 : 180;
  if (w < minWidth || h < minWidth) return null;

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

  const threshold = w * 0.08;
  const topY = rowWidths.findIndex((wd) => wd > threshold);
  if (topY === -1) return null;

  // Width measured 5-8% of the frame height below the hairline, NOT the
  // widest point across the whole head region. A player with voluminous hair
  // (afro, dreadlocks) has it flare out well past this band -- measuring the
  // widest point anywhere in a broad top-of-frame window was reading THAT as
  // head width, over-shrinking the whole photo to compensate for a "wide
  // head" that was actually just hair. This band sits at roughly brow/eye
  // level, before hair typically flares and before shoulders enter the frame
  // (confirmed against Jérémy Doku: 36% at the old widest-point measure vs
  // 28% here, in line with reference).
  const band = rowWidths.slice(topY + Math.floor(h * 0.05), topY + Math.floor(h * 0.08));
  const headWidthPct = band.length ? Math.max(...band) / w : 0;
  if (headWidthPct <= 0) return null;

  return { headTopPct: topY / h, headWidthPct, lastModified };
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
    portrait_tall_head_top_pct: number | null;
    portrait_tall_head_width_pct: number | null;
  };

  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    let query = db
      .from('players')
      .select(
        'id, name, photo_url, is_active, portrait_head_top_pct, portrait_head_width_pct, portrait_tall_head_top_pct, portrait_tall_head_width_pct',
      )
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

  const targets = rows.filter((r) => FULL || r.portrait_head_top_pct === null || r.portrait_tall_head_top_pct === null);
  console.log(`[info] ${rows.length} candidate players, ${targets.length} to measure (${APPLY ? 'APPLY' : 'DRY RUN'}${ALL ? ', all' : ', active only'}${FULL ? ', full' : ''})`);

  let measured = 0;
  let noCutout = 0;
  let failed = 0;

  await mapWithConcurrency(targets, CONCURRENCY, async (row) => {
    const code = fplPhotoCode(row.photo_url);
    if (!code) return;
    try {
      const [square, tall] = await Promise.all([measurePortrait(code, '500x500'), measurePortrait(code, '110x140')]);
      if (!square && !tall) {
        noCutout++;
        return;
      }
      measured++;
      const fmt = (m: { headTopPct: number; headWidthPct: number } | null) =>
        m ? `top=${(m.headTopPct * 100).toFixed(1)}% width=${(m.headWidthPct * 100).toFixed(1)}%` : 'n/a';
      console.log(`${APPLY ? '[write]' : '[dry]  '} ${row.name.padEnd(28)} square(${fmt(square)})  tall(${fmt(tall)})`);
      // The later of the two -- whichever source PL most recently touched --
      // as a single version stamp for this player's photo (photo.ts).
      const lastMods = [square?.lastModified, tall?.lastModified]
        .filter((s): s is string => !!s)
        .map((s) => Date.parse(s))
        .filter((t) => !Number.isNaN(t));
      const photoVersion = lastMods.length ? String(Math.max(...lastMods)) : null;
      if (APPLY) {
        const { error } = await db
          .from('players')
          .update({
            portrait_head_top_pct: square?.headTopPct ?? null,
            portrait_head_width_pct: square?.headWidthPct ?? null,
            portrait_tall_head_top_pct: tall?.headTopPct ?? null,
            portrait_tall_head_width_pct: tall?.headWidthPct ?? null,
            photo_version: photoVersion,
          })
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
