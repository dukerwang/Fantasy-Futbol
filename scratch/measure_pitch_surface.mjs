/**
 * Candidate values for the 2.0 pitch surface, and every ink that lands on it.
 *
 * The pitch is the one surface in the app the palette has never been checked
 * against: 1.0 painted a fixed #5A8F6A grass in BOTH themes and then put white
 * labels, white touchlines and a translucent "empty slot" chip on top of it.
 * Same rule as the 2.0 ground — a surface the palette has not verified is a
 * surface you cannot put ink on.
 */

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToRgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/** White at `a` alpha composited over `bg` — what a 0.7-alpha label actually paints. */
const over = (fg, bg, a) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));

const W = [255, 255, 255];

/* 1.0's grass, and the candidates. The stripe is the darker of the mown pair,
   so it is the harder ground and the one every check below uses. */
const GRASS = {
  '1.0 (both themes)':   { field: '#5A8F6A', band: '#528361' },
  'light candidate':     { field: '#4E7F5E', band: '#487457' },
  'dark candidate':      { field: '#2F5341', band: '#2A4B3B' },
};

const rows = [];
for (const [name, g] of Object.entries(GRASS)) {
  const band = hexToRgb(g.band);
  // The vignette darkens the edges; measure the LIT centre, which is the
  // brightest ground and therefore the worst case for white ink.
  const field = hexToRgb(g.field);
  for (const [what, a, min] of [
    ['touchline (white .55)', 0.55, 3.0],   // a graphical line: 3.0
    ['team label (white .70)', 0.70, 4.5],  // 9-10px text: 4.5
    ['team label (white 1.0)', 1.0, 4.5],
    ['empty-slot label (white .78)', 0.78, 4.5],
  ]) {
    rows.push([name, what, contrast(over(W, field, a), field), min]);
  }
  rows.push([name, 'stripe vs field (informational)', contrast(field, band), 1.0]);
  rows.push([name, 'card chip (#FDFCF9) on grass', contrast(hexToRgb('#FDFCF9'), field), 3.0]);
  rows.push([name, 'dark card (#252B3D) on grass', contrast(hexToRgb('#252B3D'), field), 3.0]);
}

const w = Math.max(...rows.map((r) => r[0].length + r[1].length)) + 4;
let bad = 0;
for (const [name, what, ratio, min] of rows) {
  const ok = ratio >= min;
  if (!ok && min > 1.0) bad++;
  console.log(
    `${(name + ' · ' + what).padEnd(w)} ${ratio.toFixed(2).padStart(6)}:1  min ${min.toFixed(1)}  ${min === 1.0 ? '—' : ok ? 'PASS' : 'FAIL'}`,
  );
}
console.log(`\n${bad} failure(s).`);
