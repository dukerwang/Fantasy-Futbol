#!/usr/bin/env node
/**
 * Gaffa 2.0 — palette verifier.
 *
 * ⚠ RECONSTRUCTED 2026-08-08. The original was destroyed by a scripted
 * whole-file edit during the League Home implementation, and the file was
 * untracked so there was nothing to restore from. The PALETTE ITSELF was
 * never at risk — it lives in src/app/globals.css and in the design project's
 * gaffa.css — but the original's exact pair list is gone. This rebuild keeps
 * the same contract (report by default, `--emit` prints the token block) and
 * re-derives the pairs from the rules in design-2.0/README.md. If the original
 * checked something this one does not, it is worth re-adding.
 *
 * Gaffa 1.0's identity colours are pinned (the cream, the forest green, the
 * position hues), so this does NOT generate a palette. It takes the authored
 * hex, checks every text/surface pair that can legally occur, and where one
 * fails it walks OKLCH lightness — holding hue and chroma — to report the
 * nearest passing value. Holding H and S is the rule from the dark-accent
 * work: move lightness, or the colour reads as a different brand.
 *
 *   node design-2.0/verify-palette.mjs          # report
 *   node design-2.0/verify-palette.mjs --emit   # print the CSS token block
 */

/* ---------- colour math ---------- */

const clamp01 = (n) => Math.min(1, Math.max(0, n));
const srgbToLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const linToSrgb = (u) =>
  u <= 0.0031308 ? 12.92 * u : 1.055 * Math.pow(clamp01(u), 1 / 2.4) - 0.055;

function hexToRgb(h) {
  const s = h.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(s.slice(i, i + 2), 16));
}
const rgbToHex = (rgb) =>
  '#' +
  rgb
    .map((v) => Math.round(clamp01(v / 255) * 255).toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();

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

const relLum = ([r, g, b]) =>
  0.2126 * srgbToLin(r / 255) + 0.7152 * srgbToLin(g / 255) + 0.0722 * srgbToLin(b / 255);

function contrast(a, b) {
  const x = relLum(a), y = relLum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

/**
 * Walk OKLCH lightness — holding hue and chroma — until `fg` clears `target`
 * against `bgRgb`. Tries both directions and returns the nearest passing hex,
 * or the original when nothing in range works.
 */
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

/* ---------- the palette ----------
 *
 * Authored, not generated. Notes worth keeping:
 *   dark surfaces  keep Gaffa's charcoal-navy. A warm-derived dark was built
 *                  and rejected: warm light with a cool dark is a legitimate
 *                  pairing, and the warm cream TEXT on cool navy is the
 *                  tension that keeps it recognisably Gaffa.
 *   accent         --color-accent is a FILL and large-text token;
 *                  --color-accent-ink is the body-text one. #1FA35F on a dark
 *                  card is 4.33:1, so the token splits by role rather than
 *                  moving a pinned brand value.
 *   warning        stays the bright amber because stylesheets use it as a
 *                  FILL with dark ink on top; warning-as-TEXT is its own
 *                  token, because the amber is 1.87:1 on cream.
 */
const P = {
  light: {
    'bg-primary':    '#F7F3ED',
    'bg-secondary':  '#EDE8DE',
    'bg-card':       '#FDFCF9',
    /* Three values below are the APP's, not 2.0's earlier proposals, because
       measuring settled them the other way:
         bg-card-alt  #F3EFE6 gave a zebra separation of 1.118 — above this
                      file's own 1.03-1.10 target, i.e. stripey. #f9f6f1 is 1.051.
         border /     2.0's #D6D0C4 / #E3DED3 are FAINTER than the app's
         border-subtle (1.39 vs 1.58 on the page). Neither carries an AA
                      obligation, and the audit's strongest finding was that
                      hairlines are what make the newer pages read as precise.
                      Softening 591 call sites to no benefit is not a fix. */
    'bg-card-alt':   '#f9f6f1',
    'bg-inset':      '#E8E2D6',
    'border':        '#C8C3BC',
    'border-subtle': '#D9D4CD',
    'border-strong': '#8F877B',
    'text-primary':  '#1C1A17',
    'text-secondary':'#4A453D',
    'text-muted':    '#6B6356',
    'accent':        '#146B40',
    'accent-hover':  '#0F5632',
    'accent-ink':    '#146B40',
    'live':          '#B3261E',
    'danger':        '#A32219',
    'warning-text':  '#8A5A0B',
    'gold':          '#8A6A1F',
    'silver':        '#6C7176',
    'bronze':        '#8A4A22',
    'tint-accent':   '#E2EAE1',
    'tint-danger':   '#F5E3DD',
    'tint-warning':  '#EFE8DD',
    /* Performance ramp. Colours a figure by how it sits against the player's
       OWN positional median. Solved in OKLCH, lightness only, against the
       HARDER of card and page — these are 11px figures. Derived at 4.8 rather
       than the 4.5 the check enforces: solving to the floor exactly put every
       stop at 4.50:1, the tightest pairs in the palette, one background nudge
       from failing. Same reason the keylines aim past 3.0.
       Cost recorded, not argued, exactly like the winger sage below: `perf-best`
       is 1 degree in hue from the accent and `perf-poor` 1 degree from danger,
       so a strong figure is the same green as "yours" and a weak one the same
       red as danger. A teal-to-clay ramp 47-56 degrees off the accent was built,
       measured and set aside — green-to-red reads instantly and Duke judged that
       worth the collision. Contained to TEXT ON FIGURES; never fills or badges. */
    'perf-poor':     '#B04B3D',
    'perf-low':      '#9B5B2B',
    'perf-good':     '#42764E',
    'perf-best':     '#147B47',
  },
  dark: {
    'bg-primary':    '#1A1F2E',
    'bg-secondary':  '#232A3D',
    'bg-card':       '#252B3D',
    'bg-card-alt':   '#1F2436',
    'bg-inset':      '#161B28',
    'border':        '#3E4559',
    'border-subtle': '#2C3344',
    'border-strong': '#6E7893',
    'text-primary':  '#EDEAE2',
    'text-secondary':'#B7B2A8',
    'text-muted':    '#949BAB',
    'accent':        '#1FA35F',
    'accent-hover':  '#37BE77',
    'accent-ink':    '#2FB56C',
    'live':          '#F0736A',
    'danger':        '#F0736A',
    'warning-text':  '#E0A63C',
    'gold':          '#D6B052',
    'silver':        '#AEB4BA',
    'bronze':        '#CD8450',
    'tint-accent':   '#2A4647',
    'tint-danger':   '#533E4A',
    'tint-warning':  '#4D4745',
    'perf-poor':     '#E37969',
    'perf-low':      '#CC8758',
    'perf-good':     '#6DA378',
    'perf-best':     '#4EA972',
  },
};

/* ---------- position spine ----------
 *
 * ONE fill per position across BOTH themes, white ink throughout.
 *
 * Dark used to lighten all twelve and switch the label to dark ink, which made
 * a position a different colour depending on the theme — awkward for the one
 * token set where hue carries identity. White text needs the fill at luminance
 * <= 0.183 to clear 4.5:1, so the fill cannot be lightened for dark; what it
 * loses that way is its EDGE against a dark card, and that is exactly what the
 * keyline (derived below) restores.
 *
 * Goalkeeper moved from 1.0's #D4A017 to #9E6D00: at luminance 0.42 it was the
 * one pale badge in a spine that otherwise sits at 0.10-0.17, so it was the
 * only position that needed dark ink. Holding hue and chroma and moving
 * lightness only, white first clears 4.5:1 at #9E6D00.
 *
 * Wingers were briefly moved to a terracotta so that green could mean one
 * thing (Gaffa, and "yours"). Duke reverted them to 1.0's deep sage. The cost
 * is recorded rather than argued: sage sits near the accent, so a winger badge
 * reads adjacent to ownership on surfaces that tint your own row green.
 */
const SPINE = {
  gk:  '#9E6D00',
  cb:  '#2A5A92',
  lb:  '#2C6FD8',
  rb:  '#2C6FD8',
  lwb: '#1F6B70',
  rwb: '#1F6B70',
  dm:  '#6A47A0',
  cm:  '#8763AC',
  am:  '#A8406C',
  lw:  '#2F7A4E',
  rw:  '#2F7A4E',
  st:  '#A62626',
};

const POS = {
  light: Object.fromEntries(
    Object.entries(SPINE).map(([k, field]) => [k, { field, on: '#FFFFFF' }]),
  ),
  dark: Object.fromEntries(
    Object.entries(SPINE).map(([k, field]) => [k, { field, on: '#FFFFFF' }]),
  ),
};

/* ---------- checks ---------- */

const fails = [];
const passes = [];

function check(theme, label, fgHex, bgHex, min) {
  const fg = hexToRgb(fgHex), bg = hexToRgb(bgHex);
  const ratio = contrast(fg, bg);
  const row = { theme, label, ratio, min, fgHex, bgHex };
  if (ratio >= min) passes.push(row);
  else fails.push({ ...row, suggestion: nudge(fgHex, bg, min) });
}

/** Surfaces a given ink can legally sit on. */
const SURFACES = ['bg-primary', 'bg-secondary', 'bg-card', 'bg-card-alt', 'bg-inset'];

for (const theme of ['light', 'dark']) {
  const p = P[theme];

  // Body inks against every surface they can occur on.
  for (const ink of ['text-primary', 'text-secondary', 'text-muted']) {
    for (const surface of SURFACES) {
      check(theme, `${ink} on ${surface}`, p[ink], p[surface], 4.5);
    }
  }

  // Semantic inks that carry sentences: full 4.5.
  for (const ink of ['accent-ink', 'live', 'danger', 'warning-text']) {
    for (const surface of ['bg-primary', 'bg-card', 'bg-card-alt']) {
      check(theme, `${ink} on ${surface}`, p[ink], p[surface], 4.5);
    }
  }

  // The performance ramp carries the 11px baseline-rule figures, so it gets the
  // full 4.5 — no large-text discount, even though the points figure it also
  // colours is 32px. `perf-mid` is not listed: it IS text-primary, already
  // checked above against every surface.
  for (const ink of ['perf-poor', 'perf-low', 'perf-good', 'perf-best']) {
    for (const surface of ['bg-primary', 'bg-card', 'bg-card-alt']) {
      check(theme, `${ink} on ${surface}`, p[ink], p[surface], 4.5);
    }
  }

  // The medal ramp is rank 1/2/3 only — large figures and thin rings, never
  // body copy — so it is held to the large-text/non-text floor of 3:1.
  for (const ink of ['gold', 'silver', 'bronze']) {
    for (const surface of ['bg-primary', 'bg-card', 'bg-card-alt']) {
      check(theme, `${ink} (medal) on ${surface}`, p[ink], p[surface], 3.0);
    }
  }

  // Tinted grounds take PRIMARY ink only — green on a green tint is both
  // redundant and, in dark, below AA.
  for (const tint of ['tint-accent', 'tint-danger', 'tint-warning']) {
    check(theme, `text-primary on ${tint}`, p['text-primary'], p[tint], 4.5);
  }

  // Fills that carry a label.
  check(theme, 'white on accent fill', '#FFFFFF', p['accent'], 3.0);
  check(theme, 'accent fill vs card', p['accent'], p['bg-card'], 3.0);
  check(theme, 'border-strong on page', p['border-strong'], p['bg-primary'], 3.0);
  check(theme, 'border-strong on card', p['border-strong'], p['bg-card'], 3.0);

  // Band separation wants to be visible but not stripey. Only a floor is
  // meaningful, so this is informational.
  const bandDelta = contrast(hexToRgb(p['bg-card-alt']), hexToRgb(p['bg-card']));
  passes.push({ theme, label: 'band vs card (informational)', ratio: bandDelta, min: 1.0 });

  /* Every badge carries a keyline. The keyline — not the fill — is what has to
   * separate the badge from the page, which frees a fill to sit wherever the
   * label needs it. The label at 4.5:1 is what carries the meaning. */
  for (const [key, pos] of Object.entries(POS[theme])) {
    /* Derive against whichever of page and card is HARDER. A badge appears on
     * both, and in dark the card is lighter than the page — deriving against
     * the page alone lands on its minimum and then falls short on the card,
     * which is where most badges actually sit. */
    const pageRgb = hexToRgb(p['bg-primary']);
    const cardRgb = hexToRgb(p['bg-card']);
    const harder =
      contrast(hexToRgb(pos.field), pageRgb) <= contrast(hexToRgb(pos.field), cardRgb)
        ? pageRgb
        : cardRgb;
    const worst = Math.min(
      contrast(hexToRgb(pos.field), pageRgb),
      contrast(hexToRgb(pos.field), cardRgb),
    );
    /* Aim at 4.0, not the 3.0 the check enforces. Deriving to the legal floor
     * lands every keyline at exactly 3.00:1, which is compliant and faint;
     * the floor is what must never be breached, not what to design to. */
    pos.line = worst >= 4.0 ? pos.field : nudge(pos.field, harder, 4.0);

    check(theme, `pos ${key.toUpperCase()} label on field`, pos.on, pos.field, 4.5);
    check(theme, `pos ${key.toUpperCase()} keyline vs page`, pos.line, p['bg-primary'], 3.0);
    check(theme, `pos ${key.toUpperCase()} keyline vs card`, pos.line, p['bg-card'], 3.0);
  }
}

/* ---------- report ---------- */

if (process.argv.includes('--emit')) {
  const block = (theme) => {
    const p = P[theme];
    const out = [];
    for (const [k, v] of Object.entries(p)) out.push(`  --color-${k}: ${v};`);
    for (const [key, pos] of Object.entries(POS[theme])) {
      out.push(
        `  --color-pos-${key}: ${pos.field};  --color-pos-${key}-on: ${pos.on};  --color-pos-${key}-line: ${pos.line};`,
      );
    }
    return out.join('\n');
  };
  console.log('/* light */\n:root {\n' + block('light') + '\n}\n');
  console.log('/* dark */\n[data-theme="dark"] {\n' + block('dark') + '\n}');
  process.exit(0);
}

const total = fails.length + passes.length;
const w = Math.max(...[...fails, ...passes].map((r) => (r.theme + r.label).length)) + 4;
const fmt = (r) =>
  `  ${r.ratio >= r.min ? '✓' : '✗'} ${(r.theme + ' · ' + r.label).padEnd(w)} ${r.ratio.toFixed(2)}:1 (needs ${r.min})` +
  (r.suggestion ? `  → nearest passing: ${r.suggestion}` : '');

console.log(`Gaffa 2.0 palette — ${total} pairs checked\n`);

if (fails.length) {
  console.log(`${fails.length} FAIL:\n`);
  for (const f of fails) console.log(fmt(f));
  console.log('');
} else {
  console.log(`${passes.length} pass. Tightest:\n`);
  const tight = [...passes]
    .filter((r) => r.min > 1)
    .sort((a, b) => a.ratio / a.min - b.ratio / b.min)
    .slice(0, 8);
  for (const t of tight) console.log(fmt(t));
}

console.log('\nBand separation (wants ~1.03-1.10 — visible, not stripey):');
for (const theme of ['light', 'dark']) {
  const p = P[theme];
  console.log(
    `  ${theme}: ${contrast(hexToRgb(p['bg-card-alt']), hexToRgb(p['bg-card'])).toFixed(3)}:1`,
  );
}

process.exit(fails.length ? 1 : 0);
