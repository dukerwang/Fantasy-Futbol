/**
 * Renders candidate crops for the 220x280 fallback source beside the locked
 * 500x500 crop, so the fallback tier is locked by looking at it rather than by
 * arithmetic alone. Writes a comparison sheet to the scratchpad.
 *
 * Frame composition mirrors the CSS exactly:
 *   rendered width  = frame width * zoom
 *   rendered height = rendered width * (src height / src width)
 *   image is centred horizontally and pushed DOWN by `inset`
 *   the frame clips the rest
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const OUT = process.argv[2] ?? '/tmp/portrait-crops.png';
const SCALE = 3;                       // upscale the sheet so the crop is legible
const SIZES = (process.env.HERO_ONLY
  ? [{ key: 'lg', w: 104, h: 120, inset: 9 }]
  : [
      { key: 'lg', w: 104, h: 120, inset: 9 },
      { key: 'md', w: 66, h: 78, inset: 6 },
      { key: 'sm', w: 44, h: 44, inset: 4 },
    ]);

const url = (size, code) =>
  `https://resources.premierleague.com/premierleague25/photos/players/${size}/${code}.png`;

async function frame(buf, { w, h, inset }, zoom, bg) {
  const meta = await sharp(buf).metadata();
  const Rw = Math.round(w * SCALE * zoom);
  const Rh = Math.round(Rw * (meta.height / meta.width));
  const W = w * SCALE, H = h * SCALE, I = Math.round(inset * SCALE);

  const scaled = await sharp(buf).resize(Rw, Rh).toBuffer();
  const visibleH = Math.min(H - I, Rh);
  const cut = await sharp(scaled)
    .extract({ left: Math.round((Rw - W) / 2), top: 0, width: W, height: visibleH })
    .toBuffer();

  return sharp({ create: { width: W, height: H, channels: 4, background: bg } })
    .composite([{ input: cut, left: 0, top: I }])
    .png()
    .toBuffer();
}

const BG = { r: 232, g: 226, b: 214, alpha: 1 };
const PAD = 14;

async function row(code, label, variants) {
  const cells = [];
  for (const v of variants) {
    const res = await fetch(url(v.src, code));
    if (!res.ok) { cells.push(null); continue; }
    const buf = Buffer.from(await res.arrayBuffer());
    for (const s of SIZES) cells.push({ img: await frame(buf, s, v.zoom[s.key], BG), s, label: `${v.name} ${s.key}` });
  }
  return { code, label, cells: cells.filter(Boolean) };
}

const VARIANTS = [
  { src: '500x500', name: 'locked 500', zoom: { lg: 1.5625, md: 1.5625, sm: 1.50 } },
  { src: '110x140', name: 'fallback @1.42', zoom: { lg: 1.42, md: 1.42, sm: 1.36 } },
];

const PLAYERS = [
  [141746, 'Bruno Fernandes'], [154561, 'David Raya'], [223340, 'Bukayo Saka'],
  [439509, 'Tzolis — 220 only'], [614071, 'Manzambi — neither'],
];

const rows = [];
for (const [code, label] of PLAYERS) rows.push(await row(code, label, VARIANTS));

const rowH = Math.max(...SIZES.map((s) => s.h)) * SCALE + PAD;
const rowW = rows.reduce((m, r) => Math.max(m, r.cells.reduce((x, c) => x + c.s.w * SCALE + PAD, PAD)), 0);
const sheetH = rows.length * rowH + PAD;

const composites = [];
rows.forEach((r, ri) => {
  let x = PAD;
  r.cells.forEach((c) => {
    composites.push({ input: c.img, left: x, top: ri * rowH + PAD });
    x += c.s.w * SCALE + PAD;
  });
});

const sheet = await sharp({ create: { width: rowW, height: sheetH, channels: 4, background: { r: 247, g: 243, b: 237, alpha: 1 } } })
  .composite(composites).png().toBuffer();
writeFileSync(OUT, sheet);

console.log('wrote', OUT, `${rowW}x${sheetH}`);
console.log('rows (top to bottom):', rows.map((r) => r.label).join(' | '));
console.log('columns per row: ' + VARIANTS.map((v) => `${v.name} [lg md sm]`).join('  '));
