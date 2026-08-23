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

/* ---------- the palette, READ FROM globals.css ----------
 *
 * This file used to carry its own hardcoded copy of every token. That copy
 * drifted: by 2026-08-23 it still held the pre-lock spine (GK at #9E6D00) and
 * reported "196 pass" against a palette the app no longer shipped — a verifier
 * that agrees with itself rather than with the code. It now parses
 * src/app/globals.css, so it cannot pass unless the SHIPPED tokens pass.
 *
 * Gaffa's identity colours are pinned (the cream, the forest green, the
 * position hues), so this does NOT generate a palette. It reads the authored
 * hex, checks every text/surface pair that can legally occur, and where one
 * fails it walks OKLCH lightness — holding hue and chroma — to report the
 * nearest passing value. Holding H and C is the rule from the dark-accent
 * work: move lightness, or the colour reads as a different brand.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const CSS_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'app', 'globals.css');
const CSS = readFileSync(CSS_PATH, 'utf8');

/**
 * Pull `--color-*` declarations out of one rule block.
 *
 * `startRe` matches the block's selector; we then take everything up to the
 * first line that is a bare `}` at column 0, which is how every token block in
 * globals.css closes. Nested at-rules inside a token block would break this,
 * and there are none — if that changes, this needs a real parser.
 */
function blockTokens(startRe) {
  const lines = CSS.split('\n');
  const start = lines.findIndex((l) => startRe.test(l));
  if (start < 0) throw new Error(`verify-palette: no block matching ${startRe} in ${CSS_PATH}`);
  const out = {};
  for (let i = start; i < lines.length; i++) {
    if (i > start && lines[i] === '}') break;
    // Several tokens share a line (`--color-warning: X;  --color-warning-dim: Y;`).
    for (const m of lines[i].matchAll(/--color-([a-z0-9-]+)\s*:\s*([^;]+);/g)) {
      out[m[1]] = m[2].trim();
    }
  }
  return out;
}

/** Resolve `var(--color-x)` aliases, and drop anything that is not plain hex. */
function resolveHex(map) {
  const out = {};
  for (const [k, raw] of Object.entries(map)) {
    let v = raw;
    for (let hops = 0; hops < 4 && /^var\(/.test(v); hops++) {
      const ref = v.match(/var\(\s*--color-([a-z0-9-]+)/);
      if (!ref) break;
      v = map[ref[1]] ?? v;
    }
    if (/^#[0-9a-fA-F]{6}$/.test(v)) out[k] = v.toUpperCase();
  }
  return out;
}

const lightRaw = blockTokens(/^\.g-theme-light\s*\{/);
const darkRaw = blockTokens(/^\[data-theme="dark"\]\s*\{/);

const light = resolveHex(lightRaw);
// The dark block only RE-declares what changes; everything else cascades from
// :root. Merging light-under-dark is what the browser actually resolves, and
// checking dark against a partial map is how a token with no dark value (the
// pitch, the warning fill) silently escapes verification.
const dark = resolveHex({ ...lightRaw, ...darkRaw });

const P = { light, dark };

/* ---------- position spine ----------
 *
 * ONE fill per position across BOTH themes, with a per-position label ink.
 * Read from the same source: `--color-pos-<k>` is the field, `-on` the label,
 * `-line` the keyline. The keyline — not the fill — is what has to separate a
 * badge from the page, which frees the fill to sit wherever the label needs it.
 */
const POS_KEYS = ['gk', 'cb', 'lb', 'rb', 'lwb', 'rwb', 'dm', 'cm', 'am', 'lw', 'rw', 'st'];

function spineFor(themeMap) {
  return Object.fromEntries(
    POS_KEYS.map((k) => {
      const field = themeMap[`pos-${k}`];
      if (!field) throw new Error(`verify-palette: --color-pos-${k} missing from ${CSS_PATH}`);
      return [k, { field, on: themeMap[`pos-${k}-on`] ?? '#FFFFFF', line: themeMap[`pos-${k}-line`] ?? field }];
    }),
  );
}

const POS = { light: spineFor(light), dark: spineFor(dark) };

/* ---------- checks ---------- */

const fails = [];
const passes = [];

const missing = [];

function check(theme, label, fgHex, bgHex, min) {
  /* A token this file asks for but globals.css does not declare is a FAILURE,
     not a crash and not a silent skip. While this file carried its own copy of
     the palette, a renamed or deleted token simply went on passing against the
     stale value; now it is named in the report so the check list and the
     stylesheet stay honest about each other. */
  if (!fgHex || !bgHex) {
    missing.push(`${theme} · ${label} — ${!fgHex ? 'ink' : 'surface'} token not declared in globals.css`);
    return;
  }
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

  /* The performance ramp used to be checked here (perf-poor/low/good/best at
     the full 4.5, because it carried the 11px baseline-rule figures). Removed
     because the ramp is gone: `--color-perf-*` is declared nowhere in
     globals.css and nothing in src/ references it. Those four checks kept
     passing only because this file held its own copy of the tokens — the exact
     drift that reading globals.css is meant to make impossible. Re-add them if
     the ramp comes back; `check` will now report a missing token by name
     rather than passing it or throwing. */

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

  /* Fills that carry a label. These are held to 4.5, not 3.0: what sits on an
     accent or warning fill is a BUTTON LABEL — body text at 10-13px, not a
     large figure or a graphical mark. This check used to hardcode '#FFFFFF' at
     3.0, which passed while dark's real label measured 2.70:1, because white is
     not the token dark uses and 3.0 is not the floor a label owes. Checking the
     token the app actually paints is the whole point of this file. */
  check(theme, 'on-accent on accent fill', p['on-accent'], p['accent'], 4.5);
  check(theme, 'on-warning on warning fill', p['on-warning'], p['warning'], 4.5);
  check(theme, 'on-danger on danger fill', p['on-danger'], p['danger'], 4.5);
  check(theme, 'accent fill vs card', p['accent'], p['bg-card'], 3.0);
  check(theme, 'border-strong on page', p['border-strong'], p['bg-primary'], 3.0);
  check(theme, 'border-strong on card', p['border-strong'], p['bg-card'], 3.0);

  /* The pitch. One grass in both themes — it is a depicted object, not a
     semantic colour (see globals.css § "The pitch") — so both theme passes
     check the same pair, and that is deliberate: it is what proves the single
     value is legal on both sides rather than only on the one it was drawn for.
     1.0's #5A8F6A put white at 3.77:1 here even at full strength, and every
     ink it actually painted was faded well below that. */
  check(theme, 'pitch-line on grass', p['pitch-line'], p['pitch'], 4.5);
  check(theme, 'pitch-line on mown stripe', p['pitch-line'], p['pitch-band'], 4.5);
  check(theme, 'card chip on grass (keyline carries the edge)', p['pitch-line'], p['pitch'], 3.0);
  check(theme, 'grass vs page', p['pitch'], p['bg-primary'], 3.0);

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

console.log(`Gaffa palette — ${total} pairs checked, read from src/app/globals.css\n`);

if (missing.length) {
  console.log(`${missing.length} MISSING TOKEN(S) — this file asks for colours globals.css does not declare:\n`);
  for (const m of missing) console.log(`  ✗ ${m}`);
  console.log('');
}

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

// A missing token is as much a failure as a failing ratio: it means the check
// list and the stylesheet have drifted apart, which is the whole thing this
// file now exists to prevent.
process.exit(fails.length || missing.length ? 1 : 0);
