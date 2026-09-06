#!/usr/bin/env node
/**
 * Gaffa UI tripwires — the mechanical half of docs/UI_RULES.md.
 *
 * Run standalone (`node scripts/check-ui-rules.mjs [files...]`, no args = whole
 * repo) or via the PostToolUse hook in .claude/settings.json, which pipes it
 * one edited file at a time.
 *
 * WHY THIS EXISTS. Three UI rules were broken in one session despite all three
 * being written down somewhere: headings went sentence case (CLAUDE.md said to,
 * contradicting the code), white panels went back on the cream ground (the rule
 * lived only inside one CSS file), and headings were written as captions (no
 * rule existed). Prose in a doc an agent reads once at session start does not
 * hold. This runs at the moment of the write.
 *
 * Only rules a machine can judge live here. Rule 2 (name things, don't narrate
 * them) is a warning with a deliberately tiny pattern set, because the general
 * case needs judgement. The rest of docs/UI_RULES.md is not checkable and is
 * not attempted.
 *
 * ERRORS exit 2 (the hook feeds them back). WARNINGS exit 0.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();

/**
 * --added <file>: only report findings whose matched text appears in <file>.
 * The hook writes the edit's new_string (or a Write's whole content) there, so
 * an edit to a legacy file is judged on what it ADDS, not on debt it inherited.
 * Without the flag every finding is reported — that is the audit mode.
 */
const addedIdx = process.argv.indexOf('--added');
let ADDED_TEXT = addedIdx > -1 && process.argv[addedIdx + 1]
  ? (fs.existsSync(process.argv[addedIdx + 1]) ? fs.readFileSync(process.argv[addedIdx + 1], 'utf8') : '')
  : null;
const isNew = (snippet) => ADDED_TEXT === null || ADDED_TEXT.includes(snippet);
const errors = [];
const warnings = [];

const rel = (f) => path.relative(ROOT, f) || f;
const err = (f, line, rule, msg, snip) => { if (isNew(snip ?? '')) errors.push({ f: rel(f), line, rule, msg }); };
const warn = (f, line, rule, msg, snip) => { if (isNew(snip ?? '')) warnings.push({ f: rel(f), line, rule, msg }); };

const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** Words that stay lowercase inside a title. */
const MINOR = new Set([
  'a', 'an', 'and', 'as', 'at', 'but', 'by', 'for', 'from', 'in', 'into', 'nor',
  'of', 'on', 'onto', 'or', 'over', 'per', 'so', 'the', 'to', 'up', 'v', 'via',
  'vs', 'with', 'yet',
]);

/** Rule 2's tiny denylist: headings that narrate rather than name. */
const COY = [/^How\b/, /\bThat\b/, /\bIt\b/];

// ── 1. Docs must not contradict the decisions log ──────────────────────────
// This is the exact failure that produced eleven months of lowercase headings:
// CLAUDE.md instructed sentence case long after f2552ff2 changed the code.
function checkDocs() {
  for (const f of ['CLAUDE.md', 'DESIGN.md', 'docs/UI_RULES.md']) {
    const p = path.join(ROOT, f);
    if (!fs.existsSync(p)) continue;
    const src = fs.readFileSync(p, 'utf8');
    const m = src.match(/sentence case for (headings|section titles)/i);
    if (m) {
      err(p, lineOf(src, m.index), 'doc-contradiction',
        `"${m[0]}" contradicts docs/UI_RULES.md rule 1 (headings are title case).`);
    }
  }
}

// ── 2. Heading case + coy headings, in TSX ─────────────────────────────────
function checkTsx(f, src) {
  const re = /<h([1-3])(\s[^>]*)?>([^<>{}]+)<\/h\1>/g;
  let m;
  while ((m = re.exec(src))) {
    const text = m[3].trim();
    if (!text || text.length < 3) continue;
    if (/[{}]/.test(text)) continue;                  // interpolated
    if (/[.!?]$/.test(text)) continue;                // a sentence, not a title
    if (/^\d/.test(text)) continue;                   // numbered legal/doc heading
    const words = text.split(/\s+/).filter(Boolean);
    if (words.length < 2) continue;

    const bad = words.slice(1).filter((w, i) => {
      if (/^&[a-z]+;/i.test(w)) return false;         // HTML entity
      const bare = w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, '');
      if (!bare || bare.length < 2) return false;
      if (MINOR.has(bare.toLowerCase())) return false;
      if (words[i] && /[:—–-]$/.test(words[i])) return false;  // after a dash, new clause
      return /^\p{Ll}/u.test(bare);
    });
    if (bad.length) {
      err(f, lineOf(src, m.index), 'heading-case',
        `"${text}" — headings are title case. Lowercase: ${bad.join(', ')}`, text);
    }
    if (COY.some((p) => p.test(text))) {
      warn(f, lineOf(src, m.index), 'heading-narrates',
        `"${text}" reads as a caption. Name the thing instead (UI_RULES rule 2).`, text);
    }
  }
}

// ── 3. Elevation is border XOR shadow ──────────────────────────────────────
function checkCss(f, src) {
  const ruleRe = /([^{}]+)\{([^{}]*)\}/g;
  let m;
  while ((m = ruleRe.exec(src))) {
    const [, selector, body] = m;
    if (selector.trim().startsWith('@')) continue;
    const hasBorder = /(^|\s|;)border\s*:\s*(?!none|0)/.test(body);
    const hasShadow = /(^|\s|;)box-shadow\s*:\s*(?!none)/.test(body);
    if (hasBorder && hasShadow) {
      err(f, lineOf(src, m.index), 'ghost-card',
        `${selector.trim().split('\n').pop().trim()} declares both border and box-shadow. Elevation is border XOR shadow (UI_RULES rule 7).`, body.trim());
    }
    if (/border-(left|top)\s*:\s*\d+px solid var\(--color-(accent|pos|gold|danger|warning)/.test(body)) {
      err(f, lineOf(src, m.index), 'accent-edge',
        `${selector.trim().split('\n').pop().trim()} puts a coloured bar on a container edge (UI_RULES rule 8).`, body.trim());
    }
  }
}

// ── Drive ──────────────────────────────────────────────────────────────────
function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(tsx|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

/**
 * --hook: read Claude Code's PostToolUse payload on stdin and derive both the
 * file and the added text from it. Keeps the hook a single command with no jq
 * dependency (jq is not installed on this machine).
 */
async function hookPayload() {
  const chunks = [];
  for await (const c of process.stdin) chunks.push(c);
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}

let args = process.argv.slice(2).filter((a) => a !== '--hook');
let files;

if (process.argv.includes('--hook')) {
  const j = await hookPayload();
  const ti = j.tool_input ?? {};
  const f = ti.file_path ?? j.tool_response?.filePath;
  if (!f || !/\.(tsx|css)$/.test(f)) process.exit(0);
  const added = [ti.new_string, ti.content, ...(ti.edits ?? []).map((e) => e.new_string)]
    .filter(Boolean).join('\n');
  ADDED_TEXT = added;
  files = [f];
} else {
  files = args.filter((a) => !a.startsWith('--') && a !== (process.argv[addedIdx + 1] ?? ''));
  if (!files.length) files = walk(path.join(ROOT, 'src'));
}

checkDocs();
for (const f of files) {
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
  let src;
  try { src = fs.readFileSync(f, 'utf8'); } catch { continue; }
  if (f.endsWith('.tsx')) checkTsx(f, src);
  if (f.endsWith('.css')) checkCss(f, src);
}

const fmt = (x) => `  ${x.f}:${x.line}  [${x.rule}] ${x.msg}`;
if (warnings.length) {
  console.error(`UI rules — ${warnings.length} warning(s):`);
  warnings.forEach((w) => console.error(fmt(w)));
}
if (errors.length) {
  console.error(`UI rules — ${errors.length} error(s). See docs/UI_RULES.md.`);
  errors.forEach((e) => console.error(fmt(e)));
  // Audit mode reports the standing debt without failing; only the hook (which
  // scopes findings to what an edit ADDS) and --strict are gates.
  if (ADDED_TEXT !== null || process.argv.includes("--strict")) process.exit(2);
}
if (!warnings.length && !errors.length && args.length === 0 && !process.argv.includes('--hook')) console.log('UI rules: clean.');
