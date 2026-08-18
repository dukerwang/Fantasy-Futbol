/**
 * Measures the framing of both Premier League cut-out sizes so the 220x280
 * fallback tier gets its OWN crop rule instead of reusing the 500x500 one.
 *
 * Reports, per source, as a fraction of the image box:
 *   head top / shoulder line / head centre x / head width
 * derived from the alpha channel — the same method that produced the locked
 * 500x500 window (x 18-82%, y 0-69%).
 */
import sharp from 'sharp';

const SIZES = ['500x500', '110x140'];
const url = (size, code) =>
  `https://resources.premierleague.com/premierleague25/photos/players/${size}/${code}.png`;

/** Per-row alpha extent, so the silhouette can be read as a profile. */
async function profile(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;
  const rows = [];
  for (let y = 0; y < H; y++) {
    let min = -1, max = -1;
    for (let x = 0; x < W; x++) {
      if (data[(y * W + x) * C + 3] > 40) { if (min < 0) min = x; max = x; }
    }
    rows.push(min < 0 ? null : { min, max, w: max - min + 1, mid: (min + max) / 2 });
  }
  return { W, H, rows };
}

function measure({ W, H, rows }) {
  const firstY = rows.findIndex((r) => r);
  const lastY = rows.length - 1 - [...rows].reverse().findIndex((r) => r);

  // The head is the narrow part above the shoulders. Walk down from the crown;
  // the shoulder line is where width jumps hard (the widest row below is the
  // shoulders, so use the first row exceeding 1.45x the head's own width).
  const headBand = rows.slice(firstY, firstY + Math.round((lastY - firstY) * 0.18)).filter(Boolean);
  const headW = Math.max(...headBand.map((r) => r.w));
  const headMid = headBand.reduce((a, r) => a + r.mid, 0) / headBand.length;

  let shoulderY = lastY;
  for (let y = firstY; y <= lastY; y++) {
    if (rows[y] && rows[y].w > headW * 1.45) { shoulderY = y; break; }
  }

  const pct = (v) => +(v * 100).toFixed(1);
  return {
    box: `${W}x${H}`,
    headTop: pct(firstY / H),
    shoulders: pct(shoulderY / H),
    headCentreX: pct(headMid / W),
    headWidth: pct(headW / W),
    figureBottom: pct((lastY + 1) / H),
  };
}

const codes = [
  [141746, 'Bruno Fernandes'], [97032, 'Virgil van Dijk'], [219168, 'Alexander Isak'],
  [154561, 'David Raya'], [223340, 'Bukayo Saka'], [462424, 'William Saliba'],
  [439509, 'Tzolis (no 500)'], [441266, 'Ryan Gravenberch'],
];

for (const size of SIZES) {
  const got = [];
  for (const [code, name] of codes) {
    const res = await fetch(url(size, code));
    if (!res.ok) { console.log(`${size} ${name.padEnd(20)} ${res.status}`); continue; }
    const m = measure(await profile(Buffer.from(await res.arrayBuffer())));
    got.push(m);
    console.log(`${size} ${name.padEnd(20)} ${m.box}  headTop ${String(m.headTop).padStart(5)}%  shoulders ${String(m.shoulders).padStart(5)}%  centreX ${String(m.headCentreX).padStart(5)}%  headW ${String(m.headWidth).padStart(5)}%  bottom ${m.figureBottom}%`);
  }
  const range = (k) => `${Math.min(...got.map((g) => g[k]))}-${Math.max(...got.map((g) => g[k]))}%`;
  console.log(`  => ${size} RANGE  headTop ${range('headTop')}  shoulders ${range('shoulders')}  centreX ${range('headCentreX')}  headW ${range('headWidth')}\n`);
}
