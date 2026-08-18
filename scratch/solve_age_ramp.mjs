/**
 * The age bar wants four ordinal steps. Two obvious ramps both fail, in
 * opposite ways, and the failures are instructive enough to record:
 *
 *   accent -> bg-inset   every step clears its neighbour, and the two oldest
 *                        steps vanish against the panel (1.66 / 1.08).
 *   accent -> text-muted every step clears the panel, and NO step clears its
 *                        neighbour (1.00-1.08) — because the two endpoints were
 *                        chosen to sit at the same luminance against the same
 *                        ground, which is exactly what makes them both legible.
 *
 * So the endpoint has to be a token that is legible on the card AND far from
 * the accent in luminance, in both themes. Requirements:
 *   every step vs card      >= 3.0   (it is a fill you must be able to see)
 *   every step vs neighbour >= 1.35  (you must be able to tell them apart)
 */

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToRgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (fg, bg, p) => fg.map((c, i) => Math.round(c * p + bg[i] * (1 - p)));

const P = {
  light: { card: '#FDFCF9', accent: '#146B40', 'text-primary': '#1C1A17', 'text-muted': '#6B6356', 'text-secondary': '#4A453D', 'bg-inset': '#E8E2D6', 'border-strong': '#8F877B' },
  dark:  { card: '#252B3D', accent: '#1FA35F', 'text-primary': '#EDEAE2', 'text-muted': '#949BAB', 'text-secondary': '#B7B2A8', 'bg-inset': '#161B28', 'border-strong': '#6E7893' },
};

const CANDIDATES = ['text-primary', 'text-secondary', 'text-muted', 'bg-inset', 'border-strong'];
const MIXES = [
  [1, 0.66, 0.33, 0],
  [1, 0.70, 0.40, 0.10],
  [1, 0.75, 0.45, 0.15],
];

for (const end of CANDIDATES) {
  for (const ws of MIXES) {
    let minCard = Infinity, minAdj = Infinity;
    for (const theme of ['light', 'dark']) {
      const p = P[theme];
      const acc = hexToRgb(p.accent), e = hexToRgb(p[end]);
      const steps = ws.map((w) => mix(acc, e, w));
      for (let i = 0; i < steps.length; i++) {
        minCard = Math.min(minCard, contrast(steps[i], hexToRgb(p.card)));
        if (i) minAdj = Math.min(minAdj, contrast(steps[i], steps[i - 1]));
      }
    }
    const ok = minCard >= 3.0 && minAdj >= 1.35;
    console.log(
      `accent -> ${end.padEnd(14)} [${ws.join(', ')}]`.padEnd(50) +
      `  worst vs card ${minCard.toFixed(2)}   worst vs neighbour ${minAdj.toFixed(2)}   ${ok ? 'OK' : ''}`,
    );
  }
}
