/**
 * Every text/surface pair the `stats` port introduces or moves, in both themes.
 *
 * Two things make this page different from the ported surfaces before it, and
 * both are why the pairs have to be measured again rather than assumed:
 *
 *  1. Its rows sit on the PAGE GROUND (--color-bg-primary), not inside a
 *     .g-panel. Every earlier `.g-row` in the app is on --color-bg-card. A
 *     hover tint spends contrast headroom, and the two grounds do not have the
 *     same amount to spend.
 *  2. It is the first table where `.g-row`'s 12% position wash lands under
 *     muted ink and under accent-ink ("Free agent"), which is exactly the
 *     shape of rule 1 from the auctions port — a washed row carries primary
 *     and secondary ink only.
 *
 * Pairs verify-palette.mjs already covers (body inks on the five surfaces, the
 * ramps, the spine as keylines, on-accent / on-warning) are not repeated.
 */

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToRgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** `color-mix(... X p%, transparent)` painted over `bg` — how .g-row:hover composites. */
const over = (fg, bg, p) => fg.map((c, i) => Math.round(c * p + bg[i] * (1 - p)));

const P = {
  light: {
    'bg-primary': '#F7F3ED', 'bg-card': '#FDFCF9', 'bg-inset': '#E8E2D6',
    'text-primary': '#1C1A17', 'text-secondary': '#4A453D', 'text-muted': '#6B6356',
    'accent': '#146B40', 'accent-ink': '#146B40',
    'border': '#C8C3BC', 'border-subtle': '#D9D4CD',
  },
  dark: {
    'bg-primary': '#1A1F2E', 'bg-card': '#252B3D', 'bg-inset': '#161B28',
    'text-primary': '#EDEAE2', 'text-secondary': '#B7B2A8', 'text-muted': '#949BAB',
    'accent': '#1FA35F', 'accent-ink': '#2FB56C',
    'border': '#3E4559', 'border-subtle': '#2C3344',
  },
};

/* The twelve spine hues. ONE value each, serving both themes — which the hub
   port named as the reliable predictor of a dark-mode failure, so every one of
   them gets measured under the wash rather than a representative sample. */
const SPINE = {
  GK: '#9E6D00', CB: '#2A5A92', LB: '#2C6FD8', RB: '#2C6FD8',
  LWB: '#1F6B70', RWB: '#1F6B70', DM: '#6A47A0', CM: '#8763AC',
  AM: '#A8406C', LW: '#2F7A4E', RW: '#2F7A4E', ST: '#A62626',
};
const WASH = 0.12;   // .g-row:hover, at its strongest (the gradient's 0% stop)

const fails = [], passes = [], systemic = [];
function check(theme, label, fg, bg, min) {
  const ratio = contrast(typeof fg === 'string' ? hexToRgb(fg) : fg, typeof bg === 'string' ? hexToRgb(bg) : bg);
  (ratio >= min ? passes : fails).push({ theme, label, ratio, min });
}
/**
 * A pair this page paints but does NOT own: it is identical on every ported
 * surface, so fixing it here alone would make this page the odd one out rather
 * than fixing anything. Reported, never counted against the port.
 */
function systemCheck(theme, label, fg, bg, min, note) {
  const ratio = contrast(typeof fg === 'string' ? hexToRgb(fg) : fg, typeof bg === 'string' ? hexToRgb(bg) : bg);
  if (ratio < min) systemic.push({ theme, label, ratio, min, note });
  else passes.push({ theme, label, ratio, min });
}

for (const theme of ['light', 'dark']) {
  const p = P[theme];
  const page = p['bg-primary'], card = p['bg-card'];

  /* ── Masthead, on the page ground ───────────────────────── */
  check(theme, 'kicker (.g-label, text-muted) on page', p['text-muted'], page, 4.5);
  check(theme, 'title on page', p['text-primary'], page, 4.5);
  check(theme, 'stat figure on page', p['text-primary'], page, 4.5);
  check(theme, 'stat figure, accent-ink ("Shown") on page', p['accent-ink'], page, 4.5);
  check(theme, 'stat caption (.g-label-quiet) on page', p['text-muted'], page, 4.5);

  /* ── Controls, raised to the card value against the ground ─ */
  check(theme, 'input text on control', p['text-primary'], card, 4.5);
  check(theme, 'input placeholder on control', p['text-muted'], card, 4.5);
  check(theme, 'select text on control', p['text-secondary'], card, 4.5);
  /* WCAG 1.4.11 holds a control's own boundary to 3:1, and --color-border is a
     decorative hairline the palette deliberately kept faint. Every input and
     select on every ported surface paints this exact pair — see the note in
     design-2.0/README.md § "Not done yet". */
  systemCheck(theme, 'control keyline (input/select border) vs page', p['border'], page, 3.0,
    'app-wide: --color-border on every ported control; --color-border-strong would clear it');
  check(theme, 'slider label on control', p['text-muted'], card, 4.5);
  check(theme, 'slider value figure on control', p['text-primary'], card, 4.5);
  /* The THUMB is the component a pointer identifies and grabs, so it is what
     owes 3:1. The track is the recessed groove it runs in — `.g-track`'s own
     rule, that a surface a value is laid INTO carries no contrast obligation,
     only the ink laid over it does. Measured for the record: 1.26 / 1.22. */
  check(theme, 'slider thumb (accent) vs control', p['accent'], card, 3.0);
  check(theme, 'segment label on control', p['text-secondary'], card, 4.5);
  check(theme, 'segment SELECTED: page ink on text-primary fill', page, p['text-primary'], 4.5);

  /* ── Table, at rest on the page ground ──────────────────── */
  check(theme, 'column head (condensed, text-muted) on page', p['text-muted'], page, 4.5);
  check(theme, 'cell ink on page', p['text-secondary'], page, 4.5);
  check(theme, 'figure cell (serif, primary) on page', p['text-primary'], page, 4.5);
  check(theme, 'player name on page', p['text-primary'], page, 4.5);
  check(theme, 'club caption (.g-label-quiet) on page', p['text-muted'], page, 4.5);
  check(theme, '"Free agent" (accent-ink) on page', p['accent-ink'], page, 4.5);
  check(theme, 'em-dash placeholder (text-muted) on page', p['text-muted'], page, 4.5);
  check(theme, 'sort arrow ACTIVE (accent-ink) on page', p['accent-ink'], page, 4.5);
  check(theme, 'row rule (border-subtle) vs page', p['border-subtle'], page, 1.15);

  /* ── Table, under .g-row:hover's 12% position wash ───────
     Everything left of the gradient's 60% stop is affected: the badges, the
     name, the club caption and the owner / "Free agent" column. The figures
     sit past it and stay on bare page. */
  for (const [pos, hue] of Object.entries(SPINE)) {
    const washed = over(hexToRgb(hue), hexToRgb(page), WASH);
    check(theme, `hover ${pos}: player name (primary)`, p['text-primary'], washed, 4.5);
    check(theme, `hover ${pos}: cell ink (secondary)`, p['text-secondary'], washed, 4.5);
    /* The club caption is the page's one muted slot under the wash, and it is
       lifted to secondary by `--row-ink` on .row:hover — rule 1 from the
       auctions port. As bare muted ink it measured 4.40 (ST), 4.50 (DM) and
       4.51 (CB); the lifted value is what ships and what is checked. */
    check(theme, `hover ${pos}: club caption (lifted to secondary)`, p['text-secondary'], washed, 4.5);
    check(theme, `hover ${pos}: "Free agent" (accent-ink)`, p['accent-ink'], washed, 4.5);
  }
}

/* ── Report ──────────────────────────────────────────────── */
const fmt = (r) => r.toFixed(2).padStart(5);
if (fails.length) {
  console.log(`\n✗ ${fails.length} FAILING pair${fails.length === 1 ? '' : 's'}\n`);
  for (const f of fails) console.log(`  ${f.theme.padEnd(5)}  ${fmt(f.ratio)}  (needs ${f.min.toFixed(1)})  ${f.label}`);
}
const worst = [...passes].sort((a, b) => a.ratio / a.min - b.ratio / b.min).slice(0, 6);
console.log(`\n✓ ${passes.length} pairs pass in both themes.\n\nTightest:`);
for (const w of worst) console.log(`  ${w.theme.padEnd(5)}  ${fmt(w.ratio)}  (needs ${w.min.toFixed(1)})  ${w.label}`);
if (systemic.length) {
  console.log(`\n! ${systemic.length} pre-existing, app-wide — NOT this port's to diverge on:`);
  for (const s of systemic) console.log(`  ${s.theme.padEnd(5)}  ${fmt(s.ratio)}  (needs ${s.min.toFixed(1)})  ${s.label}\n         ${s.note}`);
}
console.log('');
process.exit(fails.length ? 1 : 0);
