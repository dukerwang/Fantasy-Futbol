/**
 * Every text/surface pair the `team` and `team/roster` port introduces or
 * moves, in both themes. Same contract as the auction-room and hub passes:
 * measure what the app actually paints, not what the token names suggest.
 *
 * The pairs verify-palette.mjs already covers (body inks on the five surfaces,
 * the ramps, the spine, on-accent / on-warning) are not repeated here.
 */

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hexToRgb = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const relLum = ([r, g, b]) => 0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);
const contrast = (a, b) => { const [x, y] = [relLum(a), relLum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
/** `color-mix(in srgb, fg p%, bg)` — how the age ramp and the faded lines composite. */
const mix = (fg, bg, p) => fg.map((c, i) => Math.round(c * p + bg[i] * (1 - p)));

const P = {
  light: {
    'bg-primary': '#F7F3ED', 'bg-card': '#FDFCF9', 'bg-card-alt': '#f9f6f1',
    'bg-elevated': '#EDE8DE', 'bg-inset': '#E8E2D6',
    'text-primary': '#1C1A17', 'text-secondary': '#4A453D', 'text-muted': '#6B6356',
    'accent': '#146B40', 'accent-ink': '#146B40', 'accent-hover': '#0F5632',
    'on-accent': '#FFFFFF', 'on-warning': '#1C1A17',
    'danger': '#A32219', 'warning': '#f59e0b', 'warning-text': '#8A5A0B', 'live': '#B3261E',
    'tint-accent': '#E2EAE1', 'tint-danger': '#F5E3DD', 'tint-warning': '#EFE8DD',
    'border': '#C8C3BC', 'border-subtle': '#D9D4CD', 'border-strong': '#8F877B',
  },
  dark: {
    'bg-primary': '#1A1F2E', 'bg-card': '#252B3D', 'bg-card-alt': '#1F2436',
    'bg-elevated': '#2C3344', 'bg-inset': '#161B28',
    'text-primary': '#EDEAE2', 'text-secondary': '#B7B2A8', 'text-muted': '#949BAB',
    'accent': '#1FA35F', 'accent-ink': '#2FB56C', 'accent-hover': '#37BE77',
    'on-accent': '#10141C', 'on-warning': '#1C1A17',
    'danger': '#F0736A', 'warning': '#f59e0b', 'warning-text': '#E0A63C', 'live': '#F0736A',
    'tint-accent': '#2A4647', 'tint-danger': '#533E4A', 'tint-warning': '#4D4745',
    'border': '#3E4559', 'border-subtle': '#2C3344', 'border-strong': '#6E7893',
  },
};
/* The grass is ONE value in both themes — see globals.css § "The pitch". */
const PITCH = '#497D59', PITCH_BAND = '#417551', PITCH_LINE = '#FFFFFF';

const fails = [], passes = [];
function check(theme, label, fg, bg, min) {
  const ratio = contrast(typeof fg === 'string' ? hexToRgb(fg) : fg, typeof bg === 'string' ? hexToRgb(bg) : bg);
  (ratio >= min ? passes : fails).push({ theme, label, ratio, min });
}

for (const theme of ['light', 'dark']) {
  const p = P[theme];
  const card = p['bg-card'], tintA = p['tint-accent'], tintD = p['tint-danger'], tintW = p['tint-warning'];

  /* ── The pitch ─────────────────────────────────────────── */
  check(theme, 'pitch: team label / touchline (white on grass)', PITCH_LINE, PITCH, 4.5);
  check(theme, 'pitch: team label on mown stripe', PITCH_LINE, PITCH_BAND, 4.5);
  check(theme, 'pitch: empty-slot label (outline chip, bare grass)', PITCH_LINE, PITCH, 4.5);
  check(theme, 'pitch: node chip keyline vs grass', PITCH_LINE, PITCH, 3.0);
  check(theme, 'pitch: node chip fill vs grass (keyline carries it)', card, PITCH, 1.0);
  check(theme, 'pitch: node name / points figure on chip', p['text-primary'], card, 4.5);
  check(theme, 'pitch: grass vs page', PITCH, p['bg-primary'], 3.0);

  /* ── Rail rows, washed and unwashed ────────────────────── */
  check(theme, 'rail: club (muted) on card', p['text-muted'], card, 4.5);
  check(theme, 'rail: club lifted to secondary on accent wash', p['text-secondary'], tintA, 4.5);
  check(theme, 'rail: selected row label (primary on wash)', p['text-primary'], tintA, 4.5);
  check(theme, 'rail: slot badge (muted) on card', p['text-muted'], card, 4.5);
  check(theme, 'rail: ghost button label on card', p['text-secondary'], card, 4.5);
  check(theme, 'rail: ghost-on label (primary on wash)', p['text-primary'], tintA, 4.5);
  check(theme, 'rail: status dot (danger fill) vs card', p['danger'], card, 3.0);
  check(theme, 'rail: doubt dot (warning-text as a mark) vs card', p['warning-text'], card, 3.0);
  check(theme, 'rail: error banner ink on danger tint', p['text-primary'], tintD, 4.5);
  check(theme, 'save: label on accent fill', p['on-accent'], p['accent'], 4.5);
  check(theme, 'save: label on accent hover fill', p['on-accent'], p['accent-hover'], 4.5);
  check(theme, 'save: error text on card', p['danger'], card, 4.5);
  check(theme, 'save: success text on card', p['accent-ink'], card, 4.5);

  /* ── Page masthead ─────────────────────────────────────── */
  check(theme, 'team: live badge on page', p['live'], p['bg-primary'], 4.5);
  check(theme, 'team: over-capacity ink on danger tint', p['text-primary'], tintD, 4.5);
  check(theme, 'team: over-capacity link (primary ink on wash)', p['text-primary'], tintD, 4.5);

  /* ── Club page ─────────────────────────────────────────── */
  check(theme, 'club: rank (accent-ink) on card', p['accent-ink'], card, 4.5);
  check(theme, 'club: "You" chip ink on accent tint', p['text-primary'], tintA, 4.5);
  check(theme, 'club: figure caption (muted) on card-alt', p['text-muted'], p['bg-card-alt'], 4.5);
  check(theme, 'club: switcher current (page on primary ink)', p['bg-primary'], p['text-primary'], 4.5);
  check(theme, 'club: seg label on elevated', p['text-secondary'], p['bg-elevated'], 4.5);
  check(theme, 'club: to-do badge ink on muted fill', card, p['text-muted'], 4.5);
  check(theme, 'club: to-do badge ink on warning fill', p['on-warning'], p['warning'], 4.5);
  check(theme, 'club: to-do deadline (warning-text) on card', p['warning-text'], card, 4.5);
  check(theme, 'club: to-do action (accent-ink) on card', p['accent-ink'], card, 4.5);
  check(theme, 'club: zone flag ink on warning tint', p['text-primary'], tintW, 4.5);
  check(theme, 'club: fieldable chip ink on accent tint', p['text-primary'], tintA, 4.5);
  check(theme, 'club: status word (accent-ink) on card', p['accent-ink'], card, 4.5);
  check(theme, 'club: status word (warning-text) on card', p['warning-text'], card, 4.5);
  check(theme, 'club: status word (danger) on card', p['danger'], card, 4.5);
  check(theme, 'club: status word goes to ink on a selected tile', p['text-primary'], tintA, 4.5);
  check(theme, 'club: tile meta lifted to secondary on wash', p['text-secondary'], tintA, 4.5);
  check(theme, 'club: net-vs-fee positive on card', p['accent-ink'], card, 4.5);
  check(theme, 'club: net-vs-fee negative on card', p['danger'], card, 4.5);
  check(theme, 'club: inspector error ink on danger tint', p['text-primary'], tintD, 4.5);
  check(theme, 'club: primary action label on accent fill', p['on-accent'], p['accent'], 4.5);
  check(theme, 'club: danger action label on danger tint', p['text-primary'], tintD, 4.5);
  check(theme, 'club: monogram initial on inset', p['text-secondary'], p['bg-inset'], 4.5);
  check(theme, 'club: retained "Returned" ink on accent wash', p['text-primary'], tintA, 4.5);
  check(theme, 'club: mini tag (warn) on card', p['warning-text'], card, 4.5);
  check(theme, 'club: table column head (muted) on card', p['text-muted'], card, 4.5);

  /* ── The age ramp: accent -> text-primary, four fills on the panel, with a
     2px gap of panel between them. Adjacency is carried by the GAP, so only
     the vs-card pair is a contrast obligation — see the derivation and the two
     rejected ramps in club.module.css and scratch/solve_age_ramp.mjs. ── */
  const ink = hexToRgb(p['text-primary']), acc = hexToRgb(p['accent']);
  const steps = [acc, mix(acc, ink, 0.66), mix(acc, ink, 0.33), ink];
  steps.forEach((s, i) => check(theme, `club: age ramp step ${i + 1} vs card`, s, card, 3.0));

  /* ── Score bars and sparkline: ink, not accent ─────────── */
  check(theme, 'club: score bar (starter) vs its track', p['text-primary'], p['bg-inset'], 3.0);
  check(theme, 'club: score bar (rotation) vs its track', p['text-muted'], p['bg-inset'], 3.0);
  check(theme, 'club: sparkline bar vs card', p['text-secondary'], card, 3.0);
}

const w = Math.max(...[...fails, ...passes].map((r) => (r.theme + r.label).length)) + 5;
const fmt = (r) => `${(r.theme + ' · ' + r.label).padEnd(w)} ${r.ratio.toFixed(2).padStart(6)}:1  min ${r.min.toFixed(1)}`;
if (fails.length) {
  console.log('FAILURES\n' + fails.map(fmt).join('\n') + '\n');
} else {
  console.log('All pairs pass.\n');
}
console.log(`${passes.length} pass, ${fails.length} fail, ${passes.length + fails.length} measured.`);
process.exit(fails.length ? 1 : 0);
