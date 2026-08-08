# Gaffa 2.0 — design system

Status: **prototype approved-pending-review, not implemented.** Nothing in `src/` has
been touched. The live app still runs the 1.0 system in `src/app/globals.css`.

- **Prototype:** Claude Design project `f4858479-5b36-4ba3-9a4f-04da9725c7db`, built
  **unbound** (the bound "Fantasy Futbol Design System" has the wrong accent, fonts and
  currency). Two files, sharing `gaffa.css`:
  - `Gaffa 2.0 Design System.dc.html` — the system reference
  - `Gaffa 2.0 Surfaces.dc.html` — four full screens at real density
- **Palette tool:** `verify-palette.mjs` in this directory.

## What 2.0 is

Gaffa's identity is preserved: warm cream, Newsreader over Hanken Grotesk, the forest
green `#146B40` / `#1FA35F`, the twelve-position spine, serif tabular figures. What is
rebuilt is the system underneath.

| Problem in 1.0 | 2.0 |
|---|---|
| Green meant brand, live, success, hover, 3 positions, and neutral status | **One job per colour.** Green = Gaffa and "yours". Live is a broadcast tally red. |
| — | Dark **keeps** Gaffa's charcoal-navy. A warm-derived dark was tried and rejected: warm light with a cool dark is a legitimate pairing, and the navy reads clean |
| GK badge 2.4:1, CM 3.3:1, several position hues ~2.3:1 as dark-mode text | **104 pairs verified at build time**, both themes |
| Gold `#93702F` and bronze `#92400E` converged | Pulled apart; medal ramp reads 1/2/3 at a glance |
| `#ef4444` / `#f59e0b` were raw Tailwind defaults | Retuned into the warm palette |
| Italic serif accent carried headings, live, eyebrows, and suffix tags | **One job:** the section / card heading |
| Nothing showed that scoring is against a positional baseline | **The baseline rule** — the new signature component |
| No image treatment existed in the system at all | **Portraits** — position-tinted plinth, four sizes, serif-initial fallback |
| LW/RW were sage green, colliding with the accent | Moved to a muted **terracotta** matched to the spine's own saturation; LWB/RWB pushed off the green band |

## The baseline rule

The one component no other fantasy app can copy, because no other fantasy app scores
this way. A stat is never a bar filling toward a maximum. The median for the player's
**own position** is engraved as a fixed tick and his ink is laid over it, so you always
read "against his role" rather than "out of some total".

## Position spine

Hue is ramped by phase of play — keeper gold, defender blues, midfield violets,
attacking oranges and reds — so the palette teaches the taxonomy. Hue gives the phase;
the letters give the exact role. Left/right variants share a hue and are separated by a
clipped corner, so colour is never the sole carrier.

Each position carries three tokens: `--color-pos-{x}` (field), `-on` (label colour,
chosen per position so warm hues stay bright instead of being dragged to mud), and
`-line` (keyline). The **keyline**, not the fill, is what clears 3:1 against the page —
that is what lets goalkeeper gold stay gold.

## The seven decisions

Taken from the audit (`AUDIT.md`) and now encoded in the prototype's `gaffa.css`. The audit
observes; these decide. Where the newer pages had the right instinct it is made law; where
they improvised, 2.0 resolves it rather than copying it.

| # | Decision | Why |
|---|---|---|
| 1 | **Elevation is border XOR shadow**, declared once. Panels get a hairline; shadow is reserved for things that genuinely float. | Newer pages already lean this way (hairline:shadow 5.5:1 vs 3.0:1). A 1px border under a soft shadow is the ghost-card tell. |
| 2 | **Type scale extends down to 10px**, steps named by px (`--t-10` … `--t-40`). Floor is 10, not 8. | The audit's root cause: `--text-xs` floored at 12px, pages wanted 9–11px, so the only way down was a rem literal — and 8px text shipped. Extend the scale, don't police the escapes. |
| 3 | **Radius is five tokens, one per role** — `shell` 10px, `control` 4px, `micro` 2px, `round`, `pill` (toggles only). The 3/5/7px literals are gone. | The newer cohort had three tokens plus five undocumented literals. That is improvisation, not a rule. |
| 4 | **Tints are tokens, one strength per theme** (12% light / 24% dark). A tinted ground carries **primary ink only**. | Replaces ad-hoc `color-mix` at 4/5/6/7/8%, differences no eye can resolve. Restricting to primary ink is what buys a 24% dark tint you can see instead of a 16% one you can't. |
| 5 | **The tracked label is rationed** — one `.t-col` per panel. | Newer pages use 0.06–0.14em tracking 87 times. A device that introduces every group signals nothing. |
| 6 | **Every number is tabular.** Serif for figures you compare, mono for figures that tick. | Proportional digits in body sans is most of what made older screens read as casual. |
| 7 | **Colour law**: one job per colour. | Unchanged from the earlier pass; see the table above. |

Not changed: the spacing scale. The audit found its escapes (`0.55rem 0.75rem`) were
unnecessary — those values already existed as `--s2`/`--s3`. Enforcement, not extension.

## Running the verifier

```bash
node design-2.0/verify-palette.mjs --emit
```

Checks 110 text/surface pairs across both themes and exits non-zero on any failure. Where
a pair fails it reports the nearest passing value, walking OKLCH **lightness only** and
holding hue and chroma — move lightness or the colour reads as a different brand, which
is the lesson from the dark-accent retune that produced `#1FA35F`.

`--emit` prints the full token block. Names match 1.0's existing `--color-*` so porting
is close to a drop-in rather than a rename sweep across the 33 stylesheets that
currently hardcode hex.

## Not done yet

- Not ported into `src/`. When porting, replace the token block in
  `src/app/globals.css`, then sweep the 33 component stylesheets holding hardcoded hex.
- `PositionBadge.module.css` needs the three-token treatment (field / on / line); it
  currently hardcodes `color: #fff` for all twelve.
- The 1.0 `ds-eyebrow` role is deliberately absent from 2.0. Call sites need to move to
  `t-heading` or drop the label.
- The login carousel says "one of 7 supported formations"; the real number is 10.
