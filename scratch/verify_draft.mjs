/**
 * Every text/surface pair the draft room port (design-2.0/README.md port 7,
 * the final route) introduces, in both themes. Same contract as the other
 * per-page verify scripts.
 */

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToRgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (fg, bg, p) => fg.map((c, i) => Math.round(c * p + bg[i] * (1 - p)));

const P = {
  light: {
    'bg-primary': '#F7F3ED', 'bg-card': '#FDFCF9', 'bg-card-hover': '#EDE8E0',
    'bg-elevated': '#EDE8DE', 'bg-inset': '#E8E2D6',
    'text-primary': '#1C1A17', 'text-secondary': '#4A453D', 'text-muted': '#6B6356',
    'accent': '#146B40', 'accent-ink': '#146B40', 'on-accent': '#FFFFFF',
    'danger': '#A32219', 'danger-dim': 'rgba(163, 34, 25, 0.12)', 'warning-text': '#8A5A0B',
    'border-strong': '#8F877B',
  },
  dark: {
    'bg-primary': '#1A1F2E', 'bg-card': '#252B3D', 'bg-card-hover': '#2C3344',
    'bg-elevated': '#2C3344', 'bg-inset': '#161B28',
    'text-primary': '#EDEAE2', 'text-secondary': '#B7B2A8', 'text-muted': '#949BAB',
    'accent': '#1FA35F', 'accent-ink': '#2FB56C', 'on-accent': '#10141C',
    'danger': '#F0736A', 'danger-dim': 'rgba(240, 115, 106, 0.16)', 'warning-text': '#E0A63C',
    'border-strong': '#6E7893',
  },
};

let fails = 0, total = 0;
function check(theme, label, fgHex, bgHex, target) {
  total++;
  const c = contrast(hexToRgb(fgHex), hexToRgb(bgHex));
  const ok = c >= target;
  if (!ok) fails++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${theme.padEnd(5)} ${label.padEnd(46)} ${c.toFixed(2)}  (need ${target})`);
}

for (const theme of ['light', 'dark']) {
  const p = P[theme];
  const accentOnCard5 = mix(hexToRgb(p.accent), hexToRgb(p['bg-card']), 0.05);
  const accentOnCard8 = mix(hexToRgb(p.accent), hexToRgb(p['bg-card']), 0.08);
  const accentOnCard4 = mix(hexToRgb(p.accent), hexToRgb(p['bg-card']), 0.04);
  const accentOnPrimary6 = mix(hexToRgb(p.accent), hexToRgb(p['bg-primary']), 0.06);

  // Top banner (bg-card) and clock block (bg-elevated / accent fill).
  check(theme, 'board headline (primary) on bg-primary', p['text-primary'], p['bg-primary'], 4.5);
  check(theme, 'board subtitle (muted) on bg-primary', p['text-muted'], p['bg-primary'], 4.5);
  check(theme, 'complete text (accent-ink) on bg-card', p['accent-ink'], p['bg-card'], 4.5);
  check(theme, 'go-to-team btn (on-accent) on accent fill', p['on-accent'], p['accent'], 4.5);
  check(theme, 'clock label (muted) on bg-elevated', p['text-muted'], p['bg-elevated'], 4.5);
  check(theme, 'clock time (primary) on bg-elevated', p['text-primary'], p['bg-elevated'], 4.5);
  check(theme, 'clock label/time (on-accent) on accent fill (my turn)', p['on-accent'], p['accent'], 4.5);
  check(theme, 'strip current label (accent-ink) on bg-card', p['accent-ink'], p['bg-card'], 4.5);
  check(theme, 'strip team name (primary) on bg-card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'strip picking-now (accent-ink) on bg-card', p['accent-ink'], p['bg-card'], 4.5);
  check(theme, 'banner round/pick label (muted/secondary) on bg-card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'banner pick label (secondary) on bg-card', p['text-secondary'], p['bg-card'], 4.5);

  // Board table chrome (bg-card sticky headers).
  check(theme, 'round/team header (muted) on bg-card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'team header name (secondary) on bg-card', p['text-secondary'], p['bg-card'], 4.5);
  check(theme, 'my-team header name (accent-ink) on 5% accent wash', p['accent-ink'], '#' + accentOnCard5.map((v) => v.toString(16).padStart(2, '0')).join(''), 4.5);
  check(theme, 'on-clock header name (secondary) on 8% accent wash', p['text-secondary'], '#' + accentOnCard8.map((v) => v.toString(16).padStart(2, '0')).join(''), 4.5);
  check(theme, 'round cell (muted) on bg-card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'on-clock text (accent-ink) on 6% accent wash', p['accent-ink'], '#' + accentOnPrimary6.map((v) => v.toString(16).padStart(2, '0')).join(''), 4.5);
  check(theme, 'picked name (primary) on bg-primary', p['text-primary'], p['bg-primary'], 4.5);
  check(theme, 'cell label (muted, informational) on bg-primary', p['text-muted'], p['bg-primary'], 4.5);
  check(theme, 'on-clock dot (accent fill, 3:1 graphical) on bg-primary', p['accent'], p['bg-primary'], 3.0);

  // Sidebar tabs + search + position filter.
  check(theme, 'sidebar tab (muted) on bg-card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'sidebar tab active (accent-ink) on bg-card', p['accent-ink'], p['bg-card'], 4.5);
  check(theme, 'search input text (primary) on bg-card', p['text-primary'], p['bg-card'], 4.5);
  check(theme, 'search placeholder (muted) on bg-card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'pos filter chip (secondary) on bg-card', p['text-secondary'], p['bg-card'], 4.5);
  check(theme, 'pos filter chip active (bg-primary text) on text-primary fill', p['bg-primary'], p['text-primary'], 4.5);
  check(theme, 'pick error text (danger) on danger-dim', p['danger'], p['bg-card'], 4.5); // dim is translucent; checked against the card it sits on

  // Player rows.
  check(theme, 'player name (primary) on bg-inset (hover)', p['text-primary'], p['bg-inset'], 4.5);
  check(theme, 'player club (muted) on bg-inset (hover)', p['text-muted'], p['bg-inset'], 4.5);
  check(theme, 'new tag (secondary) on bg-elevated', p['text-secondary'], p['bg-elevated'], 4.5);
  check(theme, 'new tag border (muted, 3:1 graphical) on bg-elevated', p['text-muted'], p['bg-elevated'], 3.0);
  check(theme, 'queue star (warning-text) on bg-primary', p['warning-text'], p['bg-primary'], 4.5);
  check(theme, 'draft btn (on-accent) on accent fill', p['on-accent'], p['accent'], 4.5);
  check(theme, 'draft btn disabled (muted) on bg-elevated', p['text-muted'], p['bg-elevated'], 4.5);

  // Roster + queue tabs.
  check(theme, 'roster player name (primary) on bg-primary', p['text-primary'], p['bg-primary'], 4.5);
  check(theme, 'roster player club (muted) on bg-primary', p['text-muted'], p['bg-primary'], 4.5);
  check(theme, 'roster toggle (muted) on bg-elevated', p['text-muted'], p['bg-elevated'], 4.5);
  check(theme, 'roster toggle active (primary) on bg-primary', p['text-primary'], p['bg-primary'], 4.5);
  check(theme, 'queue auto-pick hint (accent-ink) on 6% accent wash', p['accent-ink'], '#' + accentOnPrimary6.map((v) => v.toString(16).padStart(2, '0')).join(''), 4.5);
  check(theme, 'queue draft btn (on-accent) on accent fill', p['on-accent'], p['accent'], 4.5);
  check(theme, 'queue remove btn (danger) on bg-primary', p['danger'], p['bg-primary'], 4.5);

  // Advanced filters drawer.
  check(theme, 'advanced btn (secondary) on bg-card', p['text-secondary'], p['bg-card'], 4.5);
  check(theme, 'advanced btn hover (primary) on bg-card-hover', p['text-primary'], p['bg-card-hover'], 4.5);
  check(theme, 'filter label (muted) on bg-card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'filter label strong (accent-ink) on bg-card', p['accent-ink'], p['bg-card'], 4.5);
  check(theme, 'filter select text (primary) on bg-primary', p['text-primary'], p['bg-primary'], 4.5);
  check(theme, 'role toggle (muted) on bg-primary', p['text-muted'], p['bg-primary'], 4.5);
  check(theme, 'role toggle active (bg-primary text) on text-primary fill', p['bg-primary'], p['text-primary'], 4.5);

  // Scouting table.
  check(theme, 'table header (muted) on bg-card', p['text-muted'], p['bg-card'], 4.5);
  check(theme, 'table header hover (primary) on bg-card-hover', p['text-primary'], p['bg-card-hover'], 4.5);
  check(theme, 'table header active (accent-ink) on 4% accent wash', p['accent-ink'], '#' + accentOnCard4.map((v) => v.toString(16).padStart(2, '0')).join(''), 4.5);
  check(theme, 'stat cell (secondary) on bg-primary', p['text-secondary'], p['bg-primary'], 4.5);
}

console.log(`\n${total - fails}/${total} pairs pass.`);
if (fails > 0) process.exit(1);
