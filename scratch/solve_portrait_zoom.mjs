/**
 * Solves the fallback zoom by measuring the COMPOSED frame, not the source.
 *
 * For each player, renders the locked 500x500 hero frame and a sweep of
 * 220x280 hero frames, keeping alpha, then reports the figure's width at a
 * fixed depth below the crown (the cheekbone line — a landmark that survives
 * both croppings) as a fraction of the frame. The fallback zoom is the one
 * whose value matches the locked frame's.
 */
import sharp from 'sharp';

const url = (size, code) =>
  `https://resources.premierleague.com/premierleague25/photos/players/${size}/${code}.png`;

const FRAME = { w: 104, h: 120, inset: 9 };
const S = 4; // supersample

/** Compose exactly as the CSS does, keeping transparency. */
async function compose(buf, zoom) {
  const meta = await sharp(buf).metadata();
  const Rw = Math.round(FRAME.w * S * zoom);
  const Rh = Math.round(Rw * (meta.height / meta.width));
  const W = FRAME.w * S, H = FRAME.h * S, I = FRAME.inset * S;
  const scaled = await sharp(buf).resize(Rw, Rh, { fit: 'fill' }).toBuffer();
  const cut = await sharp(scaled)
    .extract({ left: Math.round((Rw - W) / 2), top: 0, width: W, height: Math.min(H - I, Rh) })
    .toBuffer();
  return sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: cut, left: 0, top: I }])
    .png().toBuffer();
}

/**
 * Figure width at a depth measured in frame units below the crown. Taken well
 * above the shoulders so it reads the head, and at a fixed FRAME depth so the
 * two sources are compared on the same physical slice of the picture.
 */
async function headWidthAt(frameBuf, depthPx) {
  const { data, info } = await sharp(frameBuf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  let crown = -1;
  for (let y = 0; y < H && crown < 0; y++)
    for (let x = 0; x < W; x++) if (data[(y * W + x) * C + 3] > 40) { crown = y; break; }
  if (crown < 0) return null;
  const y = Math.min(H - 1, crown + Math.round(depthPx * S));
  let min = -1, max = -1;
  for (let x = 0; x < W; x++) if (data[(y * W + x) * C + 3] > 40) { if (min < 0) min = x; max = x; }
  return min < 0 ? null : { crown: crown / S, width: (max - min + 1) / S / FRAME.w };
}

const DEPTH = 34; // frame px below the crown — mid-face on a 120px hero frame
const PLAYERS = [
  [141746, 'Bruno Fernandes'], [154561, 'David Raya'], [223340, 'Bukayo Saka'],
  [97032, 'Virgil van Dijk'], [462424, 'William Saliba'], [219168, 'Alexander Isak'],
  [441266, 'Ryan Gravenberch'], [198869, 'Benjamin White'],
];
const ZOOMS = [1.25, 1.30, 1.35, 1.40, 1.45, 1.50, 1.55];

const locked = [];
const sweep = new Map(ZOOMS.map((z) => [z, []]));

for (const [code, name] of PLAYERS) {
  const big = await fetch(url('500x500', code));
  const small = await fetch(url('110x140', code));
  if (!big.ok || !small.ok) { console.log(`${name}: skipped (500=${big.status} 110=${small.status})`); continue; }
  const bigBuf = Buffer.from(await big.arrayBuffer());
  const smallBuf = Buffer.from(await small.arrayBuffer());

  const L = await headWidthAt(await compose(bigBuf, 1.5625), DEPTH);
  locked.push(L.width);
  const line = [`${name.padEnd(18)} locked ${(L.width * 100).toFixed(1)}%`];
  for (const z of ZOOMS) {
    const m = await headWidthAt(await compose(smallBuf, z), DEPTH);
    sweep.get(z).push(m.width);
    line.push(`${z.toFixed(2)}:${(m.width * 100).toFixed(1)}`);
  }
  console.log(line.join('  '));
}

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
const target = mean(locked);
console.log(`\nlocked 500 mean head width = ${(target * 100).toFixed(1)}% of frame`);
let best = null;
for (const z of ZOOMS) {
  const m = mean(sweep.get(z));
  const err = Math.abs(m - target);
  console.log(`  zoom ${z.toFixed(2)}  ->  ${(m * 100).toFixed(1)}%   (off by ${(err * 100).toFixed(1)}pt)`);
  if (!best || err < best.err) best = { z, m, err };
}
console.log(`\nclosest sweep point: ${best.z.toFixed(2)}`);
// Linear interpolation between the bracketing sweep points for the exact match.
const pts = ZOOMS.map((z) => ({ z, m: mean(sweep.get(z)) }));
for (let i = 0; i < pts.length - 1; i++) {
  const a = pts[i], b = pts[i + 1];
  if ((a.m - target) * (b.m - target) <= 0) {
    console.log(`exact match by interpolation: ${(a.z + (target - a.m) * (b.z - a.z) / (b.m - a.m)).toFixed(3)}`);
  }
}
