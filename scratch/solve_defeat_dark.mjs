// Standings port (design-2.0). Two checks, both feeding the form-dot colours.
//
// 1. --color-defeat had no dark override — a single #9B2C3A serving both
//    themes, which the matchups port named as the reliable predictor of a
//    dark-mode failure. Solved here to 4.8, holding hue and chroma, the same
//    method as every other ramp in design-2.0/README.md. Result (#EA747B) is
//    now in globals.css.
//
// 2. Duke's call: green IS the win colour for the form dots, a third named
//    colour-law exception alongside the winger sage and the performance ramp
//    (design-2.0/README.md "What 2.0 is"). The risk was green-on-green: the
//    "own row" wash is 12% accent, so a green win dot inside your own row
//    paints solid accent over a green-tinted card. Checked as a graphical
//    mark (WCAG 1.4.11, 3:1), not as text (4.5) — a filled 8px dot is not a
//    text-contrast case. All three dot colours clear 3:1 against both the
//    plain card and the washed "own row" background, in both themes; dark
//    win-on-wash is the tightest at 3.72.

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (u) => u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(clamp01(u), 1 / 2.4) - 0.055;

function hexToRgb(h) {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
const rgbToHex = (rgb) => '#' + rgb.map((v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

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
  ].map((v) => Math.round(clamp01(v) * 255));
}
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
function contrast(a, b) {
  const x = relLum(a), y = relLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function nudge(fgHex, bgRgb, target) {
  const [L0, C, H] = rgbToOklch(hexToRgb(fgHex));
  for (let step = 0.005; step <= 0.7; step += 0.005) {
    for (const dir of [-1, 1]) {
      const L = L0 + dir * step;
      if (L < 0 || L > 1) continue;
      const rgb = oklchToRgb(L, C, H);
      if (contrast(rgb, bgRgb) >= target) return rgbToHex(rgb);
    }
  }
  return fgHex;
}
function blend(bg, fg, alpha) {
  return bg.map((c, i) => Math.round(c * (1 - alpha) + fg[i] * alpha));
}

console.log('── 1. --color-defeat, dark ──');
const defeat = '#9B2C3A';
const lightCard = hexToRgb('#FDFCF9');
const darkCard = hexToRgb('#252B3D');
console.log('light card:', contrast(hexToRgb(defeat), lightCard).toFixed(2));
console.log('dark  card (was):', contrast(hexToRgb(defeat), darkCard).toFixed(2));
const solved = nudge(defeat, darkCard, 4.8);
console.log('dark solved @4.8:', solved, '->', contrast(hexToRgb(solved), darkCard).toFixed(2));

console.log('\n── 2. Form dots vs the own-row accent wash (3:1 graphical floor) ──');
const cases = {
  light: { card: '#FDFCF9', accent: '#146B40', warningText: '#8A5A0B', defeat: '#9B2C3A' },
  dark: { card: '#252B3D', accent: '#1FA35F', warningText: '#E0A63C', defeat: '#EA747B' },
};
for (const [theme, c] of Object.entries(cases)) {
  const cardRgb = hexToRgb(c.card), accentRgb = hexToRgb(c.accent);
  const washed = blend(cardRgb, accentRgb, 0.12);
  console.log(theme, 'washed bg =', washed);
  console.log(' win  (accent)    vs washed:', contrast(accentRgb, washed).toFixed(2), ' vs card:', contrast(accentRgb, cardRgb).toFixed(2));
  console.log(' draw (warn-text) vs washed:', contrast(hexToRgb(c.warningText), washed).toFixed(2), ' vs card:', contrast(hexToRgb(c.warningText), cardRgb).toFixed(2));
  console.log(' loss (defeat)    vs washed:', contrast(hexToRgb(c.defeat), washed).toFixed(2), ' vs card:', contrast(hexToRgb(c.defeat), cardRgb).toFixed(2));
}
