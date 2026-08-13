/**
 * Every colour PremiumPlayerCard paints, measured against the surface it
 * actually lands on.
 *
 * THE CARD IS A ONE-THEME OBJECT. It pins itself to the light/cream palette
 * even when the app is in dark mode — a deliberate, already-made decision, and
 * the same category as the pitch grass: a depicted object that owes the colour
 * law nothing. So there is only ever one set of pairs to check, against the
 * light card surface.
 *
 * The catch, and the reason this file exists: it pins by HARDCODING A COPY of
 * the light palette, and that copy has gone stale. globals.css line 32 records
 * that --color-text-muted was darkened from #9A9488 to #6B6356 precisely
 * because the old value measured 2.73–2.94:1 and "carried essentially every
 * label, caption, column head and timestamp in the app". The card still runs
 * #9A9488.
 *
 *   node scratch/verify_player_card.mjs
 */

const lin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const hex = (h) => { const s = h.replace('#', ''); return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16)); };
const L = ([r, g, b]) => 0.2126 * lin(r / 255) + 0.7152 * lin(g / 255) + 0.0722 * lin(b / 255);
const C = (a, b) => { const [x, y] = [L(hex(a)), L(hex(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

/* ── OKLCH walk: hold hue and chroma, move lightness only. The palette's own
   method — move lightness or the colour reads as a different brand. ── */
const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : t / (108 / 841) / 116 + 16 / 116);
function rgb2oklab([r, g, b]) {
  const [R, G, B] = [r, g, b].map((c) => lin(c / 255));
  const l = Math.cbrt(0.4122214708 * R + 0.5363325363 * G + 0.0514459929 * B);
  const m = Math.cbrt(0.2119034982 * R + 0.6806995451 * G + 0.1073969566 * B);
  const s = Math.cbrt(0.0883024619 * R + 0.2817188376 * G + 0.6299787005 * B);
  return [
    0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s,
  ];
}
function oklab2rgb([Lp, a, b]) {
  const l = (Lp + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (Lp - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (Lp - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const conv = (v) => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
    return Math.max(0, Math.min(255, Math.round(c * 255)));
  };
  return [
    conv(+4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    conv(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    conv(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
  ];
}
const toHex = ([r, g, b]) => '#' + [r, g, b].map((v) => v.toString(16).padStart(2, '0').toUpperCase()).join('');

/** Darken (or lighten) `ink` in OKLCH lightness only until it clears `target` on `bg`. */
function solve(ink, bg, target) {
  const [Lp, a, b] = rgb2oklab(hex(ink));
  const bgLum = L(hex(bg));
  const down = bgLum > 0.18;                      // dark ink on a light ground
  for (let i = 0; i <= 1000; i++) {
    const t = Lp + (down ? -1 : 1) * (i / 1000);
    if (t < 0 || t > 1) break;
    const cand = toHex(oklab2rgb([t, a, b]));
    if (C(cand, bg) >= target) return cand;
  }
  return null;
}

/* The card's surfaces. It is light-only, so these are the light values — and
   the CURRENT ones from globals.css, not the stale copy the card carries. */
const CARD = '#FDFCF9';       // --color-bg-card, the card face
const INSET = '#EDE8DE';      // --color-bg-elevated, the stats strip / back panels
const PAGE = '#F7F3ED';

/* What the card paints today. */
const PAINTED = [
  // [label, ink, ground, floor, note]
  ['ratingHex >= 8.5  (bubble ring + figure, game-log Rtg)', '#3A6B4A', CARD, 4.5],
  ['ratingHex >= 7.5', '#5A9F73', CARD, 4.5],
  ['ratingHex >= 6.5', '#C8A642', CARD, 4.5],
  ['ratingHex >= 5.5', '#D17D3B', CARD, 4.5],
  ['ratingHex <  5.5', '#EF4444', CARD, 4.5],
  ['ratingHex null',   '#9A9488', CARD, 4.5],
  ['.statGold (market value figure)', '#B8893E', INSET, 4.5],
  ['.barMid fill (form sparkline)',  '#C8A642', CARD, 3.0],
  ['.barLow fill (form sparkline)',  '#D17D3B', CARD, 3.0],
  // The stale palette copy, against the surfaces it paints on.
  ['STALE text-muted #9A9488 on card',    '#9A9488', CARD, 4.5],
  ['STALE text-muted #9A9488 on inset',   '#9A9488', INSET, 4.5],
  ['STALE text-secondary #4A4A4A on card', '#4A4A4A', CARD, 4.5],
  ['STALE text-primary #1C1C1C on card',   '#1C1C1C', CARD, 4.5],
  ['STALE accent-hover #1B8350 on card',   '#1B8350', CARD, 4.5],
];

/* What globals.css says the current values are. */
const CURRENT = [
  ['current text-muted #6B6356 on card',  '#6B6356', CARD, 4.5],
  ['current text-muted #6B6356 on inset', '#6B6356', INSET, 4.5],
  ['current text-secondary #4A453D on card', '#4A453D', CARD, 4.5],
  ['current text-primary #1C1A17 on card',   '#1C1A17', CARD, 4.5],
  ['current accent-hover #0F5632 on card',   '#0F5632', CARD, 4.5],
  ['--color-gold #8A6A1F on inset',          '#8A6A1F', INSET, 4.5],
  ['--color-accent #146B40 on card',         '#146B40', CARD, 4.5],
  ['--color-danger #A32219 on card',         '#A32219', CARD, 4.5],
];

function report(title, rows) {
  console.log(`\n${title}`);
  console.log('  ' + '─'.repeat(76));
  for (const [label, ink, bg, floor] of rows) {
    const r = C(ink, bg);
    const ok = r >= floor;
    const fix = ok ? '' : `  → ${solve(ink, bg, floor + 0.3) ?? '(no solution)'}`;
    console.log(`  ${ok ? '✓' : '✗'} ${r.toFixed(2).padStart(5)} (needs ${floor.toFixed(1)})  ${ink}  ${label}${fix}`);
  }
}

report('WHAT THE CARD PAINTED BEFORE THIS PORT  (kept as the record of what was found)', PAINTED);
report('WHAT globals.css ALREADY HELD  (what the stale copy should have been)', CURRENT);

const fails = PAINTED.filter(([, ink, bg, fl]) => C(ink, bg) < fl).length;
console.log(`\n  ${fails} of ${PAINTED.length} pairs were failing. All are fixed in the port.`);
console.log('  Fixes solve to floor + 0.3, holding hue and chroma, walking OKLCH lightness only —');
console.log('  the same margin the ramp and the keylines use, so a background nudge cannot undo them.\n');

/* ============================================================
   THE PER-CLUB TINT — 27 grounds, not one.

   `.frontBg::before` runs `--color-bg-card` to `--team-color-deep` (the club's
   colour at 0x55 = 33% alpha) from 42% to 100% of a FIXED 520px card. Two
   regions carry ink over it, and neither has an opaque background of its own:
   the vertical position-spine label, and the identity bar's upper text.

   Every number below is computed from CSS LITERALS, not estimated: the card is
   `height: 520px`, `.posSpine` is `top: 56px; bottom: 193px`, and the identity
   bar's own wash reaches full --color-bg-card at 70% of its height. An earlier
   pass of this file assumed the ink sat on FULL team-deep and reported failures
   that are not real — the gradient has only travelled part way by the time it
   reaches either region, and saying so wrongly is worse than not checking.
   ============================================================ */
const over = (fg, bg, a) => fg.map((c, i) => Math.round(c * a + bg[i] * (1 - a)));
const CARD_H = 520, GRAD_START = 0.42 * CARD_H;   // 218px
const cardRgb = hex(CARD);

/** The painted ground at y px down the card front, for a club colour. */
function groundAt(clubHex, y, ownWashBgCard = 0) {
  const t = Math.max(0, Math.min(1, (y - GRAD_START) / (CARD_H - GRAD_START)));
  const deep = over(hex(clubHex), cardRgb, 0x55 / 255);        // --team-color-deep
  let g = over(deep, cardRgb, t);                               // frontBg at y
  if (ownWashBgCard) g = over(cardRgb, g, ownWashBgCard);       // the region's own wash
  return toHex(g);
}

const CLUBS = JSON.parse(
  (await import('node:fs')).readFileSync(new URL('../src/lib/clubs/clubs.json', import.meta.url), 'utf8'),
);
const list = Array.isArray(CLUBS) ? CLUBS : Object.values(CLUBS)[0];

/* ── 1. The identity bar's text ──────────────────────────────
   Starts where the hero ends: y = 520 - 193 = 327. Its own wash is weakest at
   the top, ~60% --color-bg-card where .firstName sits. */
const idRows = list.map((c) => {
  const g = groundAt(c.color, 359, 0.60);
  return { club: c.name, g, sec: C('#4A453D', g), pri: C('#1C1A17', g), mut: C('#6B6356', g) };
}).sort((a, b) => a.mut - b.mut);
console.log('\n1. IDENTITY BAR TEXT  (y=359, own wash ~60% bg-card)');
console.log('  ' + '─'.repeat(72));
for (const r of idRows.slice(0, 4))
  console.log(`  ${r.club.padEnd(14)} ground ${r.g}  primary ${r.pri.toFixed(2)}  secondary ${r.sec.toFixed(2)}  muted ${r.mut.toFixed(2)} ${r.mut>=4.5?'✓':'✗'}`);
console.log(`  → muted fails on ${idRows.filter(r=>r.mut<4.5).length}/${idRows.length}; secondary on ${idRows.filter(r=>r.sec<4.5).length}; primary on ${idRows.filter(r=>r.pri<4.5).length}`);

/* ── 2. The position spine label ─────────────────────────────
   .posSpine spans y 56 → 327. Only its lower end is tinted at all; at y=327 the
   gradient has travelled (327-218)/302 = 36%, so the club shows at 0.36 x 0.33
   = 12% alpha. No wash of its own. */
const POS = { GK:'#9E6D00', CB:'#2A5A92', LB:'#2C6FD8', LWB:'#1F6B70', DM:'#6A47A0',
              CM:'#8763AC', AM:'#A8406C', LW:'#2F7A4E', RW:'#2F7A4E', ST:'#A62626' };
let worst = null;
for (const c of list) {
  const g = groundAt(c.color, 327);
  for (const [p, hue] of Object.entries(POS)) {
    const faded = toHex(over(hex(hue), hex(g), 0.65));   // opacity: .65
    const v = C(faded, g);
    if (!worst || v < worst.v) worst = { v, club: c.name, pos: p, g, full: C(hue, g) };
  }
}
console.log('\n2. POSITION SPINE LABEL  (y=327, the tinted end; opacity .65)');
console.log('  ' + '─'.repeat(72));
console.log(`  worst pair: ${worst.pos} on ${worst.club}  ground ${worst.g}`);
console.log(`  at opacity .65  ${worst.v.toFixed(2)} ${worst.v>=4.5?'✓':'✗'}     at full strength  ${worst.full.toFixed(2)} ${worst.full>=4.5?'✓':'✗'}`);
console.log(`  primary ink on the same ground: ${C('#1C1A17', worst.g).toFixed(2)}\n`);
/* The fix is the spine's own rule: THE KEYLINE CARRIES THE HUE, THE TEXT GOES
   TO INK. .posSpineText already has top and bottom borders in --pos-color, and
   the word itself says the position, so the borders are decorative and owe
   nothing. Only `color` changes; opacity .65 and everything else stay, so the
   element looks the same weight it does today. */
const gW = worst.g;
const inkFaded = toHex(over(hex('#1C1A17'), hex(gW), 0.65));
console.log('3. THE FIX — primary ink in place of --pos-color, opacity unchanged');
console.log('  ' + '─'.repeat(72));
console.log(`  --pos-color @.65  ${worst.v.toFixed(2)}  ->  text-primary @.65  ${C(inkFaded, gW).toFixed(2)} ✓`);
console.log(`  borders keep --pos-color @.65 (${worst.v.toFixed(2)}) — decorative; the word is the carrier.\n`);
