# AGENTS.md

This file provides guidance to Antigravity and AI agents working in this repository.

## Project overview

Gaffa is a dynasty fantasy football platform for the Premier League, live at [gaffa.live](https://gaffa.live).
- **Core product spec & architecture**: See `CLAUDE.md` and `README.md`.
- **Game mechanics & intent**: See `docs/USER_GUIDE.md`.
- **Verification**: Run `npm run build` and `npm test` before declaring work complete.

---

## 1. Frontend & UI design requirements

Before modifying, designing, or refactoring any UI components, CSS modules, layout, or typography:

1. **Read `DESIGN.md`**:
   - Design tokens: Cream ground (`--color-bg-primary: #F8F4EC`), card surfaces, and the green ramp (`globals.css`).
   - Typography roles: Newsreader serif (`--font-serif`) for display/names/scores, Archivo Narrow (`--font-condensed`) for column heads/badges/buttons, JetBrains Mono (`--font-mono`) for live ticking figures, Hanken Grotesk (`--font-sans`) for body.
   - Mobile standards: Dynamic viewport (`dvh`), safe-area insets, bottom sheets on `<640px`, and touch targets.
   - Banned anti-patterns: No title kickers/eyebrows, no colored left-edge container stripes, no uncalibrated neon drop shadows, no heavy wireframe borders, no generic bento formulas.

2. **Check `docs/DECISIONS.md` before making design decisions**:
   - Only decisions documented in `docs/DECISIONS.md` are binding from Duke.
   - Do not invent rules or cite past agent inferences as binding decisions.

---

## 2. Writing style: Google Developer Style (anti-AI slop)

All frontend UI copy, microcopy, error messages, docs, commit messages, and assistant responses must adhere to the Google Developer Documentation Style Guide (`developers.google.com/style`) to eliminate "Claude-lish" AI assistant mannerisms.

### Rules of style:

1. **Voice and person**:
   - Use active voice ("Click Submit", "The server returns an acknowledgment").
   - Address the reader as "you", not "we" (cut "we recommend", "we can see that").

2. **Tone**:
   - Direct, conversational, and plainspoken.
   - **No throat-clearing**: Never start responses with "Certainly!", "Great question!", "I'd be happy to help!", or "Absolutely!". Answer directly.
   - **No polite filler**: Do not say "please" on routine instructions ("Click Save", not "Please click Save").

3. **Word choice**:
   - **Cut filler words**: Delete "simply", "easily", "just", and "obviously".
   - **Replace weak phrasing**: "allows you to" → "lets you". Use specific verbs instead of "access" (view, edit, open).
   - **No hedge-stacking**: Cut "it is worth noting that", "this might potentially", etc. Say the fact directly.

4. **Punctuation and formatting**:
   - **Em-dash restraint**: Do not use em dashes as a continuous sentence-joining crutch. Split thoughts into clean sentences.
   - **Prose over bulleted lists**: Do not list-ify everything. Write natural prose paragraphs by default. Reserve lists only for sequential steps or genuinely parallel options.
   - **Sentence case**: Use sentence case for headings, section titles, and button labels ("Submit proposal", not "Submit Proposal" or "SUBMIT PROPOSAL").
   - **Selective bolding**: Use bold only for actual UI elements or key terms, not for manufacturing artificial emphasis on ordinary nouns.
   - **Serial comma**: Always use the Oxford comma.

---

## 3. Agent skills policy

### Recommended skills:
- **`emil-design-eng`**: Implements §4.A of `DESIGN.md` (button press physics, modal/drawer transitions, origin-aware popovers, snappy <250ms threshold).
- **`apple-design`**: Implements §4.B of `DESIGN.md` (mobile touch ergonomics, dynamic viewport `dvh`, safe-area insets, bottom sheets).
- **`google-dev-style`**: Guides all UI copy, error messages, docs, and communication.
- **`modern-web-guidance`**: Provides modern CSS APIs (`:has()`, container queries, modern dialog/popover) instead of JS workarounds.
- **`impeccable` (in `Operate` mode)**: High-density dashboard, data table, and app shell refinement.
- **`full-output-enforcement`**: Prevents code truncation and placeholder comments.
- **`animate`**: Targeted CSS and Framer Motion transitions calibrated to Gaffa's tokens.

### Banned skills (do not use in this repo):
- **`industrial-brutalist-ui`**: Conflicts with Gaffa's calm European broadsheet journal identity; enforces military/CRT terminal aesthetics and all-caps headings.
- **`high-end-visual-design` (`soft-skill`)**: Mandates title eyebrows (banned by Duke), bans sticky topbars (violates the green topbar), and forces pill buttons.
- **`design-taste-frontend` (`taste-skill` v1/v2) & `gpt-taste`**: Designed for marketing landing pages/portfolios, not dashboards or data tables; attempts to introduce Tailwind and GSAP marketing heroes.
- **`minimalist-ui`**: Bans colored header sections (breaks green topbar) and forces monochrome `#111111` buttons with pastels, conflicting with the green ramp and 12 tactical position colors.
- **`stitch-design-taste`**: Designed to generate new `DESIGN.md` files from scratch; risks overwriting Gaffa's custom palette and locked decisions.
- **`image-to-code`**: Scaffolds disposable marketing pages from synthetic mockups rather than working inside Gaffa's design system.
