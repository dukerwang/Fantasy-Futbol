# UI rules

The short, binding list. Every entry here is either a decision Duke stated
(quoted and dated in `docs/DECISIONS.md`) or a rule the shipped code enforces.
`scripts/check-ui-rules.mjs` checks the mechanical ones on every UI file write.

This file exists because the rules were previously spread across a 200-line
`CLAUDE.md`, a `DESIGN.md` and a decisions log — and agents kept re-deriving
them and getting them wrong. If you change a rule, change it here first.

## Writing

1. **Headings and section titles are title case.** "Record Book", not "Record
   book". Buttons stay sentence case ("Submit proposal"). Never uppercase
   button labels. — `f2552ff2`, DECISIONS 2026-09-04
2. **A heading names the thing beneath it; it does not caption it.**
   "Title-Winning XI", not "The XI That Won It". "League & Cups", not "How It
   Splits". "Previous Meetings", not "Every Meeting". — DECISIONS 2026-09-04
3. **No eyebrow labels above titles.** No uppercase kicker over a heading.
   — DECISIONS 2026-08-22
4. **"Club Balance", never "FAAB"** in anything a user reads.

## Surfaces

5. **No white panels floating on the cream ground.** A section is a serif title
   over a 2px `--color-text-primary` rule with flat content beneath it. See
   `_home/home.module.css` (`.mast`, `.sect`). — DECISIONS 2026-09-04
6. **Only a genuinely bounded object gets a box** — a hero, a board, a table.
   `border: var(--line-strong)` + `--r-shell` + `--color-bg-card`.
7. **Elevation is border XOR shadow, declared once.** A 1px border under a soft
   shadow is the ghost-card tell. — `globals.css`
8. **No coloured accent bars on container edges.** No left stripes, no top
   rules, no gradient header strips, no coloured dots before labels.
   — DECISIONS 2026-08-22
9. **No generic three-card bento rows.** Use one panel with internal hairlines,
   or an asymmetric grid.

## Type and colour

10. **Serif for figures you compare; mono only for figures that tick** —
    countdowns, lot numbers, bid clocks, live money. Settled history is serif.
    Labels and column heads are Archivo Narrow. — `design-2.0/README.md:378`
11. **Reuse `--color-*` tokens.** No raw hex in component CSS.
12. **Both themes are first class**, and WCAG AA is a hard requirement in both.

## Process

13. **Gaffa is not a themed costume.** Don't pitch design as football pastiche.
    — DECISIONS 2026-08-22
14. **Don't invent a named rule and cite it back as Duke's.** If you cannot cite
    a file or a quote, it is `[inferred]`. — `docs/DECISIONS.md`
