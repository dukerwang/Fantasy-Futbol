/**
 * One-off: measures the mean head-top / head-width fractions across a random
 * sample of players' PL cut-outs, to get the REF_HEAD_WIDTH_FRAC /
 * REF_HEAD_TOP_FRAC (and REF_TALL_*) constants in
 * src/lib/players/portraitCrop.ts. Mirrors the measurement in
 * scripts/backfill_portrait_crops.ts exactly -- keep the two in step.
 *
 * Splits the sample into two clusters by head-top fraction (>6% down vs
 * flush-to-top) because PL is serving at least two different photo framings
 * right now (see that file's doc comment) -- the "normal" cluster is what the
 * shared portrait crop in globals.css was already tuned to look right for, so
 * its mean is the reference the per-player correction targets.
 *
 * Width is measured 5-8% of the frame height below the hairline, not the
 * widest point across a broad top-of-frame window -- a player with
 * voluminous hair (afro, dreadlocks) has it flare out well past that band,
 * and the old whole-window-max approach was reading the hair as head width
 * (confirmed against Jérémy Doku: 36% vs 28% here, in line with reference).
 *
 * Run: node scratch/measure_portrait_reference.mjs [--tall] [codes...]
 * With no codes, measures a fixed sample gathered across ~10 clubs.
 */
import sharp from 'sharp';

const SAMPLE_CODES = [
  176412, 223340, 487676, 515046, 444102, 174874, 609873, 494595, 85633, 200641,
  135720, 242882, 492777, 219847, 109646, 108413, 232185, 116535, 475168, 184349,
  481624, 166477, 213292, 485047, 616222, 560262, 86873, 446008, 560552, 241293,
  469142, 503037, 60689, 596777, 448514, 536661, 486385, 438234, 570241, 40383,
];

function isBg(r, g, b, a) {
  if (a < 10) return true;
  return r > 235 && g > 235 && b > 235;
}

async function measure(code, size) {
  const res = await fetch(`https://resources.premierleague.com/premierleague25/photos/players/${size}/${code}.png`);
  if (!res.ok) return null;
  const buf = Buffer.from(await res.arrayBuffer());
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h, channels: c } = info;
  if (w < 100) return null;

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

  const band = rowWidths.slice(topY + Math.floor(h * 0.05), topY + Math.floor(h * 0.08));
  const headWidthFrac = band.length ? Math.max(...band) / w : 0;
  if (headWidthFrac <= 0) return null;

  return { headWidthFrac, headTopFrac: topY / h };
}

async function main() {
  const args = process.argv.slice(2);
  const tall = args.includes('--tall');
  const size = tall ? '110x140' : '500x500';
  const codes = args.filter((a) => a !== '--tall').map(Number).filter(Boolean);
  const targets = codes.length ? codes : SAMPLE_CODES;

  const normal = [];
  const flush = [];
  for (const code of targets) {
    const m = await measure(code, size);
    if (!m || m.headTopFrac === null) continue;
    (m.headTopFrac > 0.06 ? normal : flush).push(m);
    console.log(code, `headW=${(m.headWidthFrac * 100).toFixed(1)}%`, `headTop=${(m.headTopFrac * 100).toFixed(1)}%`);
  }

  const mean = (arr, key) => arr.reduce((s, x) => s + x[key], 0) / arr.length;
  console.log(`\n--- reference cluster (headTop > 6%), source=${size} ---`);
  console.log(`n=${normal.length}  mean headWidthFrac=${mean(normal, 'headWidthFrac').toFixed(4)}  mean headTopFrac=${mean(normal, 'headTopFrac').toFixed(4)}`);
  if (flush.length) {
    console.log('\n--- flush-to-top cluster ---');
    console.log(`n=${flush.length}  mean headWidthFrac=${mean(flush, 'headWidthFrac').toFixed(4)}  mean headTopFrac=${mean(flush, 'headTopFrac').toFixed(4)}`);
  }
}

main();
