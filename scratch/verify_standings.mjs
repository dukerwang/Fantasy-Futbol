/**
 * Every text/surface pair the standings port (design-2.0/README.md port 6)
 * introduces, in both themes. Same contract as the other per-page verify
 * scripts: measure what the app actually paints, not what the token names
 * suggest. Pairs verify-palette.mjs already covers (on-accent, the medal
 * ramp's own derivation, border-strong) are not repeated here.
 *
 * Form-dot colours and --color-defeat's new dark value are checked
 * separately in scratch/solve_defeat_dark.mjs, which is where that value
 * was derived.
 */

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToRgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** `color-mix(in oklab, fg p%, transparent)` composited onto bg — how the own-row wash paints. Approximated as a straight sRGB blend, the same shortcut the other per-page scripts use. */
const mix = (fg, bg, p) => fg.map((c, i) => Math.round(c * p + bg[i] * (1 - p)));

const P = {
  light: {
    'bg-primary': '#F7F3ED', 'bg-card': '#FDFCF9', 'bg-inset': '#E8E2D6',
    'text-primary': '#1C1A17', 'text-secondary': '#4A453D', 'text-muted': '#6B6356',
    'accent': '#146B40', 'accent-ink': '#146B40',
    'gold': '#8A6A1F', 'silver': '#6C7176', 'bronze': '#8A4A22',
    'border': '#C8C3BC', 'border-subtle': '#D9D4CD',
  },
  dark: {
    'bg-primary': '#1A1F2E', 'bg-card': '#252B3D', 'bg-inset': '#161B28',
    'text-primary': '#EDEAE2', 'text-secondary': '#B7B2A8', 'text-muted': '#949BAB',
    'accent': '#1FA35F', 'accent-ink': '#2FB56C',
    'gold': '#D6B052', 'silver': '#AEB4BA', 'bronze': '#CD8450',
    'border': '#3E4559', 'border-subtle': '#2C3344',
  },
};

let fails = 0, total = 0;
function check(theme, label, fgHex, bgHex, target) {
  total++;
  const c = contrast(hexToRgb(fgHex), hexToRgb(bgHex));
  const ok = c >= target;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${theme.padEnd(5)} ${label.padEnd(42)} ${c.toFixed(2)}  (need ${target})`);
}

for (const theme of ['light', 'dark']) {
  const p = P[theme];
  const washed = mix(hexToRgb(p.accent), hexToRgb(p['bg-card']), 0.12);
  const washedHex = '#' + washed.map((v) => v.toString(16).padStart(2, '0')).join('');

  // Masthead — on the page ground, not the panel.
  check(theme, 'title on page ground', p['text-primary'], p['bg-primary'], 4.5);
  check(theme, 'kicker (g-label) on page ground', p['text-muted'], p['bg-primary'], 4.5);
  check(theme, 'subtitle on page ground', p['text-secondary'], p['bg-primary'], 4.5);

  // Section head + table head, on the panel.
  check(theme, 'section head on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'thead th (condensed) on card', p['text-muted'], p['bg-card'], 4.5);

  // Table body, unwashed row.
  check(theme, 'td secondary on card', p['text-secondary'], p['bg-card'], 4.5);
  check(theme, 'rank (muted) on card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'manager (muted) on card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'team name (primary) on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'pts (primary) on card', p['text-primary'], p['bg-card'], 4.5);

  // Table body, hover (darken-only, per the matchups-port rule).
  check(theme, 'td secondary on hover (bg-inset)', p['text-secondary'], p['bg-inset'], 4.5);

  // Own row: the 12% accent wash. Rule 1 (auctions port) — a washed row
  // carries primary and secondary ink only, and dark is where it bites.
  check(theme, 'row-ink secondary on own-row wash', p['text-secondary'], washedHex, 4.5);
  check(theme, 'rank — takes --row-ink too, on own-row wash', p['text-secondary'], washedHex, 4.5);
  check(theme, 'team name (primary) on own-row wash', p['text-primary'], washedHex, 4.5);
  check(theme, 'pts (primary) on own-row wash', p['text-primary'], washedHex, 4.5);

  // Podium tiles — all on the card.
  check(theme, 'podium team name on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'podium manager (g-label-quiet) on card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'podium record on card', p['text-secondary'], p['bg-card'], 4.5);
  check(theme, 'podium stat value on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'leader badge (gold) on card', p['gold'], p['bg-card'], 4.5);

  // The medal ramp as small trophy-icon marks — graphical, not text (WCAG
  // 1.4.11, 3:1), same floor the matchups port used for crest art.
  check(theme, 'medal gold icon on card (3:1 graphical)', p['gold'], p['bg-card'], 3.0);
  check(theme, 'medal silver icon on card (3:1 graphical)', p['silver'], p['bg-card'], 3.0);
  check(theme, 'medal bronze icon on card (3:1 graphical)', p['bronze'], p['bg-card'], 3.0);

  // Hairlines (--color-border) are NOT checked here — README's palette
  // reconciliation is explicit that they carry no AA obligation by design
  // ("fainter... carry no AA obligation, and the audit's strongest finding
  // was that hairlines are what make the newer pages read as precise").
}

console.log(`\n${total - fails}/${total} pairs pass.`);
if (fails > 0) process.exit(1);
