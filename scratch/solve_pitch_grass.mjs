/**
 * Solve the grass.
 *
 * The first pass (measure_pitch_surface.mjs) showed 1.0's #5A8F6A fails every
 * ink it carries — touchlines 2.23, team label 2.67, empty-slot label 2.94 —
 * and that the alpha FADE is most of what kills them: the same white at full
 * strength is 3.77. So two things change together: the ink stops being faded,
 * and the grass moves to a value full white actually clears.
 *
 * Constraint set:
 *   white ink (labels, touchlines) >= 4.5  ->  grass luminance <= 0.1833
 *   grass reads as grass                   ->  hold hue, walk lightness
 *
 * The node chip is NOT in the constraint set. A cream chip separates from any
 * grass, but the dark theme's card (#252B3D) is darker than any legal grass, so
 * fill contrast cannot carry it in both themes at once. It gets a KEYLINE
 * instead — the spine's own rule, that the line and not the fill is what has to
 * clear 3:1. That frees the grass to be chosen for the ink it carries.
 */

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (u) => (u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(clamp01(u), 1 / 2.4) - 0.055);
const hexToRgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

function rgbToOklch([r, g, b]) {
  const lr = srgbToLin(r / 255), lg = srgbToLin(g / 255), lb = srgbToLin(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  return [L, Math.hypot(A, B), (Math.atan2(B, A) * 180) / Math.PI];
}
function oklchToRgb(L, C, hDeg) {
  const h = (hDeg * Math.PI) / 180;
  const a = C * Math.cos(h), b = C * Math.sin(h);
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    linToSrgb(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linToSrgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linToSrgb(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  ].map((v) => clamp01(v) * 255);
}

const W = [255, 255, 255];
const SEED = '#5A8F6A';                       // 1.0's grass — hue and chroma are kept
const [, C, H] = rgbToOklch(hexToRgb(SEED));

/* Walk lightness down until full white clears 4.8, not 4.5. Same reasoning as
   the performance ramp: solving to the AA floor exactly lands on 4.50 and is
   one nudge from failing, and this ground also has a vignette and a mown stripe
   moving it around. */
let field = null;
for (let L = 0.62; L > 0.2; L -= 0.001) {
  const rgb = oklchToRgb(L, C, H);
  if (contrast(W, rgb) >= 4.8) { field = rgb; break; }
}
/* The mown stripe is the same green one step darker. It only ever makes the
   ground darker, i.e. it only improves every white pair — so the FIELD is the
   worst case and the stripe needs no separate solve. */
const [fL] = rgbToOklch(field);
const band = oklchToRgb(fL - 0.028, C, H);

const out = { field: rgbToHex(field), band: rgbToHex(band) };
console.log(`seed  ${SEED}   ->  field ${out.field}   band ${out.band}\n`);

const checks = [
  ['white ink on field',            contrast(W, field), 4.5],
  ['white ink on band',             contrast(W, band), 4.5],
  ['cream chip #FDFCF9 on field',   contrast(hexToRgb('#FDFCF9'), field), 3.0],
  ['dark chip #252B3D on field',    contrast(hexToRgb('#252B3D'), field), 3.0],
  ['chip keyline #C8C3BC on field', contrast(hexToRgb('#C8C3BC'), field), 3.0],
  ['chip keyline #3E4559 on field', contrast(hexToRgb('#3E4559'), field), 3.0],
  ['field vs light page #F7F3ED',   contrast(field, hexToRgb('#F7F3ED')), 3.0],
  ['field vs dark page #1A1F2E',    contrast(field, hexToRgb('#1A1F2E')), 3.0],
  ['band vs field (informational)', contrast(field, band), 1.0],
];
for (const [what, ratio, min] of checks) {
  console.log(`${what.padEnd(34)} ${ratio.toFixed(2).padStart(6)}:1  min ${min.toFixed(1)}  ${min === 1 ? '—' : ratio >= min ? 'PASS' : 'FAIL'}`);
}
