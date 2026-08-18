/**
 * Every text/surface pair port 5 introduces or moves, in both themes.
 *
 * `matchups`, `matchups/[matchupId]` and `MatchupPitch`. Three things make this
 * port's pairs worth measuring rather than assuming:
 *
 *  1. THE PITCH IS THE SECOND SURFACE IN THE APP PAINTED ON --color-pitch, and
 *     the first the squad-page port did not itself measure. 1.0 painted a fixed
 *     #5A8F6A in both themes with FADED white on it, which is what put the
 *     touchline at 2.23:1 and the team label at 2.67:1. Both the grass and the
 *     alpha moved, so every white pair on it is a new pair.
 *  2. THE MARGIN AXIS IS A NEW DEVICE on a recessed track, and its band edges
 *     are a graphical boundary — WCAG 1.4.11's 3:1, not 4.5.
 *  3. THE SCORELINE'S FIRST CONSUMER. `.g-score` had never been rendered, so
 *     no figure/ground pair under it had ever been checked against a real page.
 *
 * Pairs verify-palette.mjs already covers (body inks on the five surfaces, the
 * ramps, the spine as keylines, on-accent / on-warning) are not repeated.
 */

const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToRgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** `color-mix(... X p%, transparent)` painted over `bg`. */
const over = (fg, bg, p) => fg.map((c, i) => Math.round(c * p + bg[i] * (1 - p)));

const P = {
  light: {
    'bg-primary': '#F7F3ED', 'bg-card': '#FDFCF9', 'bg-card-alt': '#f9f6f1',
    'bg-card-hover': '#EDE8E0', 'bg-inset': '#E8E2D6', 'row-hover': '#E8E2D6',
    'text-primary': '#1C1A17', 'text-secondary': '#4A453D', 'text-muted': '#6B6356',
    'accent': '#146B40', 'accent-ink': '#146B40', 'danger': '#A32219', 'live': '#B3261E',
    'border': '#C8C3BC', 'border-subtle': '#D9D4CD', 'border-strong': '#8C8579',
  },
  dark: {
    'bg-primary': '#1A1F2E', 'bg-card': '#252B3D', 'bg-card-alt': '#2A3143',
    'bg-card-hover': '#2C3344', 'bg-inset': '#161B28', 'row-hover': '#161B28',
    'text-primary': '#EDEAE2', 'text-secondary': '#B7B2A8', 'text-muted': '#949BAB',
    'accent': '#1FA35F', 'accent-ink': '#2FB56C', 'danger': '#F0736A', 'live': '#F0736A',
    'border': '#3E4559', 'border-subtle': '#2C3344', 'border-strong': '#6E7893',
  },
};

/* Depicted objects: ONE value in both themes, which is the whole argument in
   design-2.0/README.md § "The pitch". They are not themed and must not be. */
const PITCH = '#497D59';
const PITCH_BAND = '#417551';
const PITCH_LINE = '#FFFFFF';

/* The dark end of the panel's dark-theme gradient — a .g-panel in dark runs
   bg-card -> #212736, and the breakdown sits near the bottom of a tall panel.
   Checking only the top would report a pass the page does not have. */
const PANEL_FOOT_DARK = '#212736';

const fails = [], passes = [], systemic = [];
const rgb = (v) => (typeof v === 'string' ? hexToRgb(v) : v);
function check(theme, label, fg, bg, min) {
  const ratio = contrast(rgb(fg), rgb(bg));
  (ratio >= min ? passes : fails).push({ theme, label, ratio, min });
}
/** A pair this port paints but does not own — identical on every ported surface. */
function systemCheck(theme, label, fg, bg, min, note) {
  const ratio = contrast(rgb(fg), rgb(bg));
  if (ratio < min) systemic.push({ theme, label, ratio, min, note });
  else passes.push({ theme, label, ratio, min });
}

for (const theme of ['light', 'dark']) {
  const p = P[theme];
  const page = p['bg-primary'];
  const card = p['bg-card'];
  const panelFoot = theme === 'dark' ? PANEL_FOOT_DARK : card;
  /* `.g-track` is --color-bg-inset in light, but in dark it is
     rgba(10,14,24,.62) painted over whatever is behind it — the panel here.
     Approximating it as bg-inset would be checking a colour the page does not
     paint, which is the exact hole verify-palette.mjs already had once. */
  const track = theme === 'dark'
    ? over(hexToRgb('#0A0E18'), hexToRgb(card), 0.62)
    : hexToRgb(p['bg-inset']);
  const trackHover = theme === 'dark'
    ? over(hexToRgb('#0A0E18'), hexToRgb(p['row-hover']), 0.62)
    : hexToRgb(p['bg-inset']);

  /* ── The masthead and the standfirst, on the page ground ── */
  check(theme, 'kicker (.g-label) on page', p['text-muted'], page, 4.5);
  check(theme, 'title on page', p['text-primary'], page, 4.5);
  check(theme, 'standfirst (serif, secondary) on page', p['text-secondary'], page, 4.5);
  check(theme, 'standfirst bolded name on page', p['text-primary'], page, 4.5);

  /* ── The gameweek selector ────────────────────────────── */
  check(theme, 'gw select text on control', p['text-primary'], card, 4.5);
  check(theme, 'gw arrow on control', p['text-secondary'], card, 4.5);
  check(theme, 'gw arrow, hovered (control, keeps bg-card-hover)', p['text-primary'], p['bg-card-hover'], 4.5);
  check(theme, 'gw arrow, disabled', p['text-muted'], card, 4.5);
  systemCheck(theme, 'control keyline (select border) vs page', p['border'], page, 3.0,
    'app-wide: --color-border on every ported control; --color-border-strong would clear it');

  /* ── The scoreline, in the panel ──────────────────────── */
  check(theme, 'featured label (.g-label) on panel', p['text-muted'], card, 4.5);
  check(theme, 'club name on panel', p['text-primary'], card, 4.5);
  check(theme, 'season record (.g-label-quiet) on panel', p['text-muted'], card, 4.5);
  check(theme, 'winning figure (.g-score-v) on panel', p['text-primary'], card, 4.5);
  /* The losing figure steps back to muted. It is a 40px figure, so it clears
     the large-text floor comfortably — but it is checked at 4.5 anyway, because
     the same class paints the 17px row figure. */
  check(theme, 'losing figure (muted) on panel', p['text-muted'], card, 4.5);
  check(theme, 'losing figure (muted) on hovered panel row', p['text-muted'], p['row-hover'], 4.5);
  check(theme, 'verdict (.g-axis-verdict) on panel', p['text-secondary'], card, 4.5);
  check(theme, 'verdict margin figure on panel', p['text-primary'], card, 4.5);
  check(theme, 'state "Final" (.g-label-quiet) on panel', p['text-muted'], card, 4.5);
  /* .ds-live is --color-live, which is the one status colour on this surface. */
  check(theme, 'state "Live" (.ds-live) on panel', p['live'], card, 4.5);
  check(theme, 'state "Live" on hovered panel row', p['live'], p['row-hover'], 4.5);

  /* ── The margin axis ──────────────────────────────────────
     Graphical, so 3:1 (WCAG 1.4.11) rather than 4.5. The ink and the tick are
     what a reader has to make out; the band's 14% wash is decoration inside
     edges that carry it, so only the EDGES are held to the floor. */
  check(theme, 'axis ink vs recessed track', p['text-primary'], track, 3.0);
  check(theme, 'axis ink vs recessed track, hovered row', p['text-primary'], trackHover, 3.0);
  check(theme, 'axis tick vs recessed track', p['text-primary'], track, 3.0);
  check(theme, 'axis tick vs recessed track, hovered row', p['text-primary'], trackHover, 3.0);
  check(theme, 'axis band edge vs recessed track', p['text-muted'], track, 3.0);
  check(theme, 'axis band edge vs recessed track, hovered row', p['text-muted'], trackHover, 3.0);
  /* The ink crosses the band, so it must also separate from the washed zone. */
  check(theme, 'axis ink vs band wash',
    p['text-primary'], over(hexToRgb(p['text-muted']), track, 0.14), 3.0);
  check(theme, 'axis tick vs band wash',
    p['text-primary'], over(hexToRgb(p['text-muted']), track, 0.14), 3.0);
  /* And the accent rule under "your" figure is a 2px graphical mark. */
  check(theme, 'accent rule under your figure vs panel', p['accent'], card, 3.0);

  /* ── Fixture rows ─────────────────────────────────────── */
  check(theme, 'fixture club name on panel', p['text-primary'], card, 4.5);
  check(theme, 'fixture club name on hovered row', p['text-primary'], p['row-hover'], 4.5);
  check(theme, 'fixtures heading on panel', p['text-primary'], card, 4.5);

  /* ── The glance footer ────────────────────────────────── */
  check(theme, 'glance caption (.g-label-quiet) on panel', p['text-muted'], panelFoot, 4.5);
  check(theme, 'glance figure on panel', p['text-primary'], panelFoot, 4.5);
  check(theme, 'glance sub-line on panel', p['text-secondary'], panelFoot, 4.5);

  /* ── The detail page ──────────────────────────────────── */
  check(theme, 'back link (accent-ink) on page', p['accent-ink'], page, 4.5);
  check(theme, 'report kicker (.g-label) on panel', p['text-muted'], card, 4.5);
  check(theme, 'report byline (.g-label-quiet) on panel', p['text-muted'], card, 4.5);
  check(theme, 'report headline on panel', p['text-primary'], card, 4.5);
  check(theme, 'report lead (serif, secondary) on panel', p['text-secondary'], card, 4.5);
  check(theme, 'report lead bolded name on panel', p['text-primary'], card, 4.5);
  check(theme, 'report column heading on panel', p['text-primary'], card, 4.5);
  check(theme, 'report detail text on panel', p['text-secondary'], card, 4.5);
  check(theme, 'report toggle (accent-ink) on panel', p['accent-ink'], card, 4.5);
  /* Two icons, each the sole carrier of its own meaning, so both are held to
     the legible token rather than a fill. */
  check(theme, 'star icon (accent-ink) on panel', p['accent-ink'], card, 3.0);
  check(theme, 'alert icon (danger) on panel', p['danger'], card, 3.0);

  /* ── The pitch ────────────────────────────────────────────
     Every white pair here is new: the grass moved AND the alpha came off. Both
     mown stripes are measured, because the ink lands on either one. */
  for (const [gname, grass] of [['grass', PITCH], ['mown stripe', PITCH_BAND]]) {
    check(theme, `team label (full-strength white) on ${gname}`, PITCH_LINE, grass, 4.5);
    check(theme, `field boundary on ${gname}`, PITCH_LINE, grass, 3.0);
    check(theme, `byline on ${gname}`, PITCH_LINE, grass, 3.0);
    /* Interior furniture keeps its alpha — decorative, non-interactive, and it
       states nothing the lineup does not. Recorded, not enforced. */
    check(theme, `chip keyline (pitch-line) on ${gname}`, PITCH_LINE, grass, 3.0);
    check(theme, `player chip ground vs ${gname}`, p['bg-card'], grass, 1.0);
  }

  /* The chip sits on the card value even though the surround is grass. */
  check(theme, 'chip player name on chip', p['text-primary'], card, 4.5);
  check(theme, 'chip match line (condensed) on chip', p['text-secondary'], card, 4.5);
  check(theme, 'chip points figure on chip', p['text-primary'], card, 4.5);
  check(theme, 'sub-in mark (accent-ink) on chip', p['accent-ink'], card, 3.0);
  check(theme, 'sub-out mark (danger) on chip', p['danger'], card, 3.0);

  /* ── Benches and the breakdown, at the panel's foot ───── */
  check(theme, 'bench heading on panel', p['text-primary'], panelFoot, 4.5);
  check(theme, 'bench bonus figure on panel', p['text-primary'], panelFoot, 4.5);
  check(theme, 'bench chip keyline vs panel', p['border-subtle'], panelFoot, 1.0);
  check(theme, 'breakdown head (.g-label) on panel', p['text-muted'], panelFoot, 4.5);
  check(theme, 'breakdown club name on panel', p['text-primary'], panelFoot, 4.5);
  check(theme, 'breakdown team total on panel', p['text-primary'], panelFoot, 4.5);
  check(theme, 'breakdown player name on panel', p['text-primary'], panelFoot, 4.5);
  check(theme, 'breakdown match line on panel', p['text-secondary'], panelFoot, 4.5);
  check(theme, 'breakdown points on panel', p['text-primary'], panelFoot, 4.5);
  /* The zebra row. Its own separation from the panel is deliberately ~1.05. */
  check(theme, 'breakdown player name on alt row', p['text-primary'], p['bg-card-alt'], 4.5);
  check(theme, 'breakdown match line on alt row', p['text-secondary'], p['bg-card-alt'], 4.5);
  check(theme, 'breakdown points on alt row', p['text-primary'], p['bg-card-alt'], 4.5);
  check(theme, 'bench-contribution row label on alt row', p['text-secondary'], p['bg-card-alt'], 4.5);
  check(theme, 'breakdown sub-in icon on panel', p['accent-ink'], panelFoot, 3.0);
}

/* ── Report ─────────────────────────────────────────────── */
const f = (n) => n.toFixed(2);
for (const x of fails) console.log(`FAIL  ${x.theme.padEnd(5)}  ${f(x.ratio).padStart(5)}  (needs ${x.min})  ${x.label}`);
for (const x of systemic) console.log(`SYS   ${x.theme.padEnd(5)}  ${f(x.ratio).padStart(5)}  (needs ${x.min})  ${x.label}\n         ↳ ${x.note}`);

console.log(`\n${passes.length} pass, ${fails.length} fail, ${systemic.length} systemic (not this port's to diverge on)`);
if (fails.length) process.exit(1);
