/**
 * Every text/surface pair the history and finance ports (design-2.0/README.md
 * port 6b/6c) introduce, in both themes. Same contract as the other per-page
 * verify scripts: measure what the app actually paints, not what the token
 * names suggest.
 */

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToRgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

const P = {
  light: {
    'bg-primary': '#F7F3ED', 'bg-card': '#FDFCF9', 'bg-card-hover': '#EDE8E0', 'bg-inset': '#E8E2D6',
    'text-primary': '#1C1A17', 'text-secondary': '#4A453D', 'text-muted': '#6B6356',
    'accent': '#146B40', 'accent-ink': '#146B40', 'danger': '#A32219',
    'gold': '#8A6A1F', 'silver': '#6C7176', 'bronze': '#8A4A22',
    'border': '#C8C3BC', 'border-subtle': '#D9D4CD',
  },
  dark: {
    'bg-primary': '#1A1F2E', 'bg-card': '#252B3D', 'bg-card-hover': '#2C3344', 'bg-inset': '#161B28',
    'text-primary': '#EDEAE2', 'text-secondary': '#B7B2A8', 'text-muted': '#949BAB',
    'accent': '#1FA35F', 'accent-ink': '#2FB56C', 'danger': '#F0736A',
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
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${theme.padEnd(5)} ${label.padEnd(48)} ${c.toFixed(2)}  (need ${target})`);
}

for (const theme of ['light', 'dark']) {
  const p = P[theme];

  // ── Shared masthead pattern (both pages) ──
  check(theme, 'title on page ground', p['text-primary'], p['bg-primary'], 4.5);
  check(theme, 'kicker (g-label) on page ground', p['text-muted'], p['bg-primary'], 4.5);
  check(theme, 'subtitle on page ground', p['text-secondary'], p['bg-primary'], 4.5);

  // ── History ──
  check(theme, 'history: section head on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'history: season champion on card', p['text-secondary'], p['bg-card'], 4.5);
  check(theme, 'history: cup winner on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'history: podium team on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'history: podium pts on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'history: table thead on card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'history: table rank/manager (muted) on card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'history: table team/pts (primary) on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'history: table row hover (bg-inset)', p['text-secondary'], p['bg-inset'], 4.5);
  check(theme, 'history: record value on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'history: record meta on card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'history: record icon (accent-ink) on card', p['accent-ink'], p['bg-card'], 4.5);
  check(theme, 'history: empty state title on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'history: empty state body on card', p['text-muted'], p['bg-card'], 4.5);

  // Medal ramp — trophy icons at champion (13px), podium (16-20px), cup badge
  // (15px) and table rank (13px) scale. All graphical marks, WCAG 1.4.11
  // (3:1), the same floor the matchups port used for crest art.
  check(theme, 'history: medal gold icon on card (3:1 graphical)', p['gold'], p['bg-card'], 3.0);
  check(theme, 'history: medal silver icon on card (3:1 graphical)', p['silver'], p['bg-card'], 3.0);
  check(theme, 'history: medal bronze icon on card (3:1 graphical)', p['bronze'], p['bg-card'], 3.0);

  // ── Finance ──
  check(theme, 'finance: section head on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'finance: summary value (primary) on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'finance: summary in (accent-ink) on card', p['accent-ink'], p['bg-card'], 4.5);
  check(theme, 'finance: summary out (danger) on card', p['danger'], p['bg-card'], 4.5);
  check(theme, 'finance: breakdown label (secondary) on card', p['text-secondary'], p['bg-card'], 4.5);
  check(theme, 'finance: breakdown in/out amount on card', p['accent-ink'], p['bg-card'], 4.5);
  // Breakdown bar fills — graphical, on g-track (bg-inset).
  check(theme, 'finance: breakdown fill accent on g-track (3:1 graphical)', p['accent'], p['bg-inset'], 3.0);
  check(theme, 'finance: breakdown fill danger on g-track (3:1 graphical)', p['danger'], p['bg-inset'], 3.0);
  // Segmented control.
  check(theme, 'finance: segment (secondary) on card', p['text-secondary'], p['bg-card'], 4.5);
  check(theme, 'finance: segment hover (secondary) on bg-card-hover', p['text-secondary'], p['bg-card-hover'], 4.5);
  check(theme, 'finance: segmentOn (bg-primary text) on text-primary fill', p['bg-primary'], p['text-primary'], 4.5);
  // Ledger table.
  check(theme, 'finance: ledger thead on card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'finance: ledger date (muted) on card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'finance: ledger player (primary) on card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'finance: ledger notes (secondary) on card', p['text-secondary'], p['bg-card'], 4.5);
  check(theme, 'finance: ledger row hover (bg-inset)', p['text-secondary'], p['bg-inset'], 4.5);
  check(theme, 'finance: typePill/amountChip in (accent-ink) on card', p['accent-ink'], p['bg-card'], 4.5);
  check(theme, 'finance: typePill/amountChip out (danger) on card', p['danger'], p['bg-card'], 4.5);
  check(theme, 'finance: typePill/amountChip none (muted) on card', p['text-muted'], p['bg-card'], 4.5);
  // Pagination.
  check(theme, 'finance: pageBtn (accent-ink) on card', p['accent-ink'], p['bg-card'], 4.5);
  check(theme, 'finance: pageBtn hover (accent-ink) on bg-card-hover', p['accent-ink'], p['bg-card-hover'], 4.5);
  check(theme, 'finance: pageInfo (muted) on card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'finance: empty text (muted) on card', p['text-muted'], p['bg-card'], 4.5);
}

console.log(`\n${total - fails}/${total} pairs pass.`);
if (fails > 0) process.exit(1);
