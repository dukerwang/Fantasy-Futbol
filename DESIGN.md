<!--
  HOW TO READ THIS FILE — read this before treating anything below as binding.

  This file RECORDS what the code currently does. It does not legislate.

  Every claim is tagged:
    [code]     verifiable in the repo right now; the file is cited. Trust it,
               but re-check the citation before relying on it — code moves.
    [decided]  Duke said it, in his own words. See docs/DECISIONS.md for the
               quote and the date. This is the only category that is binding.
    [inferred] an agent's reading. NOT policy. Contradict it freely if the work
               is better for it, and say so rather than working around it.

  WHY THE TAGS EXIST. An earlier version of this file (written by Claude on
  2026-08-20) promoted several agent-authored observations into named "laws" —
  "The One Job Rule", "The Keyline Rule", "The Tabular Rule" and others — and
  then cited them back to Duke as his own design law. They were not. The
  phrasing originated in design-2.0/README.md, itself agent-written, and had
  spread to roughly twenty places across the codebase before anyone checked.

  If you are an agent reading this: do not invent named rules. Do not restate
  an inference as doctrine. If you cannot cite a file or a quote, tag it
  [inferred] and let the reader decide.

  Gaffa's visual system is ACTIVELY BEING REVISED as of 2026-08-22. Treat this
  as a snapshot to measure against, not a target to conform to.
-->

# Design: Gaffa

## Status

The 2.0 token system shipped across every dashboard route between 2026-08-08
and 2026-08-15. A follow-up rework (green topbar, flatter content, cream table
headers) was specced 2026-08-20 and is partly in the working tree.

**A revised palette was applied to `globals.css` on 2026-08-22** and verified at
zero contrast failures across ground/sunken/card/inset in both themes, plus the
full position spine. The green ramp (`--color-green-50` … `-900`) was added the
same day. Both are in the working tree, uncommitted. See "Not applied" below for
what was proposed and deliberately left out. [code]

## Tokens as shipped

All in `src/app/globals.css`. Light values under `:root, .g-theme-light`; dark
under `[data-theme="dark"]`.

**Surfaces (light)** `--color-bg-primary` #F7F3ED · `--color-bg-secondary`
#EDE8DE · `--color-bg-card` #FDFCF9 · `--color-bg-inset` #E8E2D6 [code]

**Surfaces (dark)** #1A1F2E · #232A3D · #252B3D · #161B28 — a charcoal-navy
ramp, not a warm-derived one [code]

**Ink** #1C1A17 / #4A453D / #6B6356 light; #EDEAE2 / #B7B2A8 / #949BAB dark [code]

**Green** `--color-topbar` #1A5C3A (same value in both themes) ·
`--color-accent` #146B40 light / #1FA35F dark · `--color-accent-ink` #146B40 /
#2FB56C [code]

**Position spine** twelve `--color-pos-*` values, each with an `-on` label ink
and a `-line` keyline. One fill per position across both themes [code]

**Type** four faces loaded by `next/font` in `src/app/layout.tsx`: Newsreader
(serif), Hanken Grotesk (sans), Archivo Narrow (`--font-condensed`), JetBrains
Mono [code]

**Scales** `--t-10`…`--t-40` px-named type scale alongside the older
`--text-xs`…`--text-5xl` rem scale — both live, both in use [code] ·
`--s1`…`--s16` spacing · five role-named radii (`--r-shell` 10px,
`--r-control` 4px, `--r-micro` 2px, `--r-round`, `--r-pill`) ·
`--dur-instant/fast/base/slow` 90/140/220/420ms with
`--ease-standard: cubic-bezier(.22,1,.36,1)` · six `--z-*` steps [code]

**Breakpoints are documented, not tokenised** — 440 / 600 / 768 / 900 / 1080px,
because a custom property does not resolve inside a media query. The app
currently carries twelve distinct widths [code]

## Conventions observed in the code

These are *recorded in the codebase*, mostly as comments in `globals.css` and
`design-2.0/README.md`. They are cited, not endorsed. Several were written by
agents rather than by Duke; where that matters it is noted.

- **Elevation is border XOR shadow, declared once.** Recorded in `globals.css`
  under `--shadow-*`. The same file notes the codebase does not actually obey
  it: 168 `box-shadow` declarations against 586 `1px solid`. [code]
- **Colour is sourced from domain data** — position, crest, medal, form,
  accent-as-yours — rather than added decoratively. [code]
- **"One job per colour."** Recorded in `design-2.0/README.md` as decision 7.
  **This was agent-authored and Duke has explicitly declined to be bound by it**
  (2026-08-22). It is no longer a constraint. See docs/DECISIONS.md. [decided]
- **Eligibility, auto-subs, lockouts and cup tie-breaks** are product rules, not
  visual ones — they live in `docs/USER_GUIDE.md` and `CLAUDE.md`. Do not
  restate them here.
- **`.g-namerow` exists because a chip centred beside a name lands ~2.25px low.**
  The measurement and reasoning are in `globals.css`; this one is worth keeping
  because it is arithmetic, not taste. [code]
- **Contrast is machine-checked.** `design-2.0/verify-palette.mjs` walks pairs
  in both themes and exits non-zero on failure, resolving failures by moving
  OKLCH lightness only. [code]

## What Duke has actually decided

Full list with quotes and dates in **`docs/DECISIONS.md`**. Summary: [decided]

- Cream ground stays; brighter and less yellow is the direction. Beige reads
  dated.
- The green topbar stays.
- Wingers stay green.
- No coloured accent bars on the edges of containers.
- No eyebrow labels above page titles.
- Gaffa is a fantasy football app for a general audience — sophisticated product
  UI that may draw on football aesthetics, never a themed costume.
- "One job per colour" is not binding.

## Known problems

Measured, not asserted.

- **Four surfaces where three would do.** `--color-bg-card` #FDFCF9 sits 4% from
  the page ground — below the threshold at which it reads as a distinct layer.
- **Surface chroma rises as lightness falls** (0.009 → 0.014 → 0.017), which is
  the mechanical definition of beige.
- **The position spine is not internally consistent**: lightness spreads 10.8
  and chroma spreads 0.103 across the twelve, so some positions read far louder
  than others.
- **Three reds** (`--color-live`, `--color-danger`, `--color-defeat`) sit within
  11° of hue and 3 points of lightness — a distinction the system claims but
  cannot express.
- **24 distinct rgba bases** do shadow and overlay work in `globals.css` alone,
  17 of them pure black. Black over cream greys out as it fades.
- **`:focus-visible` appears in 9 of 66 stylesheets** and nowhere in
  `globals.css`. Most of the app has no visible keyboard focus.
- **A pre-existing hydration error** fires on League Home in dev. Unrelated to
  styling; noted here only because it surfaced during a design pass.

## Applied 2026-08-22

- Neutrals rebuilt on one hue with chroma falling as lightness falls, which is
  what stops a darker step reading as beige. [code]
- Position spine locked to a single lightness and chroma with hue rotated by
  phase of play, so the twelve read as one family. [code]
- Semantics and medals re-tuned; silver brought into the warm family. [code]
- Green ramp added as eight named steps on one hue. [code]

## Proposed and NOT applied

Deliberately left out. Do not apply these without asking — each has a reason.

- **A second, brighter neutral pass** (ground to #F9F6EF, hue 88°). Verified,
  but it would overwrite a palette another session had already applied and which
  passes on its own. Duke has not chosen between them. [inferred]
- **Dropping JetBrains Mono** and absorbing its role into Archivo Narrow with
  tabular figures. Touches `layout.tsx` plus 15 stylesheets using
  `--font-mono`; mechanical but not yet requested. [inferred]
- **Deleting `--color-bg-card`.** It sits close enough to the page ground that
  it does not read as a distinct layer, but removing it is a structural change
  to `.g-panel` and every module that uses it, not a token swap. [inferred]

## A note on concurrent sessions

On 2026-08-22 two agent sessions were editing `globals.css` at the same time and
neither knew about the other. If you are an agent about to write to that file:
check its mtime and `git diff` first, and do not assume the version you read at
the start of your session is still current.
