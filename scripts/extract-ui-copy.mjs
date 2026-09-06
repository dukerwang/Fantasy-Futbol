#!/usr/bin/env node
/**
 * Harvest every user-facing heading, title, label and caption in the app, with
 * file:line, so a copy sweep judges a finite list instead of re-reading the UI.
 *
 * Deterministic on purpose: this script finds the strings, an agent judges them
 * against docs/UI_RULES.md. Splitting it that way keeps the sweep cheap and
 * repeatable, and keeps the judgement out of a regex.
 *
 *   node scripts/extract-ui-copy.mjs            # TSV to stdout
 *   node scripts/extract-ui-copy.mjs --json
 *   node scripts/extract-ui-copy.mjs --suspect  # only ones worth a second look
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const rel = (f) => path.relative(ROOT, f);
const lineOf = (src, i) => src.slice(0, i).split('\n').length;

/** Elements whose text a reader treats as a name for what follows. */
const NAMING_CLASS = /(title|heading|^head|Head|label|caption|subtitle|sectT|kicker|hint|empty|desc)/;

/** Props that carry a name rather than prose. */
const NAMING_PROP = /^(title|label|heading|placeholder|aria-label|emptyLabel|cta)$/;

const rows = [];
const push = (f, src, i, kind, text) => {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t || t.length < 2 || t.length > 120) return;
  if (/^[^\p{L}]+$/u.test(t)) return;          // punctuation / numbers only
  if (/[{}<>]/.test(t)) return;                 // interpolated or markup
  rows.push({ file: rel(f), line: lineOf(src, i), kind, text: t });
};

function scan(f) {
  const src = fs.readFileSync(f, 'utf8');
  let m;

  const h = /<h([1-6])(\s[^>]*)?>([^<>{}]+)<\/h\1>/g;
  while ((m = h.exec(src))) push(f, src, m.index, `h${m[1]}`, m[3]);

  const el = /<(\w+)\s[^>]*className=\{?[^>]*?["'`]([^"'`]*)["'`][^>]*>([^<>{}]+)</g;
  while ((m = el.exec(src))) {
    if (NAMING_CLASS.test(m[2])) push(f, src, m.index, 'label', m[3]);
  }

  const prop = /\b([a-zA-Z-]+)=["']([^"']{2,120})["']/g;
  while ((m = prop.exec(src))) {
    if (NAMING_PROP.test(m[1])) push(f, src, m.index, m[1], m[2]);
  }

  const named = /\b(?:const|let)\s+\w*(?:Title|Label|Heading|Caption)\s*=\s*["'`]([^"'`]{2,120})["'`]/g;
  while ((m = named.exec(src))) push(f, src, m.index, 'const', m[1]);
}

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

for (const f of walk(path.join(ROOT, 'src'))) scan(f);

// Dedupe identical strings from the same file, keeping the first sighting.
const seen = new Set();
let out = rows.filter((r) => {
  const k = `${r.file}::${r.text}`;
  if (seen.has(k)) return false;
  seen.add(k);
  return true;
});

/**
 * --suspect: the subset most likely to be wrong, so a sweep can start where the
 * hit rate is highest. Not a verdict — the agent still judges every row.
 */
if (process.argv.includes('--suspect')) {
  const MINOR = /^(a|an|and|as|at|but|by|for|from|in|into|nor|of|on|onto|or|over|per|so|the|to|up|v|via|vs|with|yet)$/i;
  out = out.filter((r) => {
    // aria-label and placeholder are prose, not names: only the wording test
    // applies to them, never title case.
    const isName = /^(h[1-6]|label|const|title|heading)$/.test(r.kind);
    const w = r.text.split(/\s+/);
    if (w.length < 2) return false;
    if (/[.!?]$/.test(r.text)) return false;
    const lower = w.slice(1).some((x) => /^\p{Ll}/u.test(x) && !MINOR.test(x.replace(/[^\p{L}]/gu, '')));
    const coy = /^How\b|\bThat\b|\bIt\b|\bWe\b|\bYour\b.*\?/.test(r.text);
    return (isName && lower) || coy;
  });
}

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(out, null, 2));
} else {
  for (const r of out) console.log(`${r.file}:${r.line}\t${r.kind}\t${r.text}`);
  console.error(`\n${out.length} string(s).`);
}
