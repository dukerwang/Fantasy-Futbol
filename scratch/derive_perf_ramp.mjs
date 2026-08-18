/**
 * Derives the performance ramp for the baseline-rule figures and the points
 * figure — the "green to red" reading — WITHOUT colliding with the two colours
 * the 2.0 law reserves:
 *
 *   --color-accent  green  = "Gaffa, and yours"
 *   --color-live / --color-danger  red = a match in progress / danger
 *
 * So the ramp is its own set of tokens, pulled away from both by hue AND
 * chroma, and its midpoint is plain ink rather than an amber — the median is
 * not a verdict, and an accessible mid-ramp yellow on cream does not exist.
 *
 * Every stop is walked in OKLCH lightness (hue and chroma held, same method as
 * verify-palette.mjs) until it clears 4.5:1 against the HARDER of card and page,
 * because these are 11px figures.
 */
const clamp01 = (v) => Math.min(1, Math.max(0, v));
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

const hexToRgb = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
const rgbToHex = (rgb) =>
  '#' + rgb.map((v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0')).join('').toUpperCase();

function rgbToOklch([r, g, b]) {
  const lr = srgbToLin(r / 255), lg = srgbToLin(g / 255), lb = srgbToLin(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  const L = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  const A = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  let h = (Math.atan2(B, A) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, Math.hypot(A, B), h];
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
const relLum = ([r, g, b]) =>
  0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
const contrast = (a, b) => {
  const x = relLum(a), y = relLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Nearest lightness (hue + chroma held) clearing `target` against every bg. */
function solve(hue, chroma, bgs, target, preferDark) {
  let best = null;
  for (let L = 0.05; L <= 0.95; L += 0.002) {
    const rgb = oklchToRgb(L, chroma, hue);
    // Reject anything the sRGB gamut clipped — a clipped colour is not the hue asked for.
    const back = rgbToOklch(rgb);
    if (Math.abs(back[1] - chroma) > 0.012) continue;
    const worst = Math.min(...bgs.map((bg) => contrast(rgb, bg)));
    if (worst >= target) {
      if (!best || (preferDark ? L < best.L : L > best.L)) best = { L, rgb, worst };
    }
  }
  return best;
}

const THEMES = {
  light: { card: '#FDFCF9', page: '#F7F3ED', ink: '#1C1A17', accent: '#146B40', danger: '#A32219', preferDark: false },
  dark:  { card: '#252B3D', page: '#1A1F2E', ink: '#EDEAE2', accent: '#1FA35F', danger: '#F0736A', preferDark: true },
};

/** Shortest angular distance between two hues, in degrees. */
const hueSep = (a, b) => { const d = Math.abs(a - b) % 360; return d > 180 ? 360 - d : d; };

const RAMPS = {
  // A — literal. Reads unmistakably green-to-red, and sits directly on top of
  // the two reserved hues. Included so the collision can be SEEN, not argued.
  literal: [
    { key: 'poor', label: '<= 34', hue: 30,  chroma: 0.135 },
    { key: 'low',  label: '35-44', hue: 55,  chroma: 0.105 },
    { key: 'mid',  label: '45-55', hue: null },
    { key: 'good', label: '56-69', hue: 150, chroma: 0.085 },
    { key: 'best', label: '>= 70', hue: 155, chroma: 0.120 },
  ],
  // B — pulled clear. Same cool-good / warm-bad semantic, but the good end is
  // unmistakably TEAL rather than the brand's forest green, and the bad end a
  // CLAY rather than the signal red. The 2.0 precedent for exactly this move is
  // LW/RW, which were sage and got shifted to terracotta for colliding with the
  // accent.
  separated: [
    { key: 'poor', label: '<= 34', hue: 50,  chroma: 0.115 },
    { key: 'low',  label: '35-44', hue: 72,  chroma: 0.095 },
    { key: 'mid',  label: '45-55', hue: null },
    { key: 'good', label: '56-69', hue: 203, chroma: 0.080 },
    { key: 'best', label: '>= 70', hue: 212, chroma: 0.090 },
  ],
};

for (const [rampName, stops] of Object.entries(RAMPS)) {
  console.log(`\n######## RAMP: ${rampName} ########`);
  for (const [name, t] of Object.entries(THEMES)) {
    const bgs = [hexToRgb(t.card), hexToRgb(t.page)];
    const [, , accentHue] = rgbToOklch(hexToRgb(t.accent));
    const [, , dangerHue] = rgbToOklch(hexToRgb(t.danger));
    console.log(`\n=== ${name} ===  accent hue ${accentHue.toFixed(0)}°, danger hue ${dangerHue.toFixed(0)}°`);
    for (const s of stops) {
      if (s.hue === null) {
        const c = Math.min(...bgs.map((bg) => contrast(hexToRgb(t.ink), bg)));
        console.log(`  ${s.key.padEnd(5)} ${s.label.padEnd(6)} ${t.ink}  ${c.toFixed(2)}:1   plain ink`);
        continue;
      }
      // Aim PAST the 4.5 floor. Solving to exactly 4.5 leaves stops at 4.50:1,
    // the tightest pairs in the palette — one nudge to a background and they
    // fail. Same principle the keyline derivation uses.
    const r = solve(s.hue, s.chroma, bgs, 4.8, t.preferDark);
      if (!r) { console.log(`  ${s.key.padEnd(5)} ${s.label.padEnd(6)} NO SOLUTION hue ${s.hue} chroma ${s.chroma}`); continue; }
      const sepA = hueSep(s.hue, accentHue), sepD = hueSep(s.hue, dangerHue);
      const near = Math.min(sepA, sepD) < 25 ? '  <-- COLLIDES' : '';
      console.log(
        `  ${s.key.padEnd(5)} ${s.label.padEnd(6)} ${rgbToHex(r.rgb)}  ${r.worst.toFixed(2)}:1` +
        `   hue ${String(s.hue).padStart(3)}°   from accent ${sepA.toFixed(0).padStart(3)}°, from danger ${sepD.toFixed(0).padStart(3)}°${near}`,
      );
    }
  }
}
