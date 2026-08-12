# Gaffa 2.0 — design system

Status: **partially implemented.** The 2.0 tokens landed in `src/app/globals.css`
additively on 2026-08-08 alongside the League Home redesign (see
`LEAGUE_HOME_HANDOFF.md`); both spec files, `--font-condensed` and the `Portrait` component
followed on 2026-08-10 (see "Not done yet"). **`transfers/auctions` was ported 2026-08-11**
— the first route to use the surface, the portrait and the condensed face against real
data, and the first to be fully free of raw hex and 1.0 scales. **The rest of the Market
hub followed the same day** — `transfers`, `transfers/listings`, `transfers/free-agents`,
`transfers/deals`, plus `TransfersSubNav` and `ListingCard` — so the whole section is on
2.0 together. Every other surface still runs 1.0.

- **Prototype:** Claude Design project `f4858479-5b36-4ba3-9a4f-04da9725c7db`, built
  **unbound** (the bound "Fantasy Futbol Design System" has the wrong accent, fonts and
  currency). All files share `gaffa.css`:
  - `Gaffa 2.0 Design System.dc.html` — the system reference
  - `Gaffa 2.0 Surfaces.dc.html` — four full screens at real density
  - `League Home.dc.html` — the shipped page's prototype
  - `Gaffa 2.0 Refinements.dc.html` — the surface-treatment study (turn 1)
  - `Gaffa 2.0 Portraits and Type.dc.html` — the label-face study (turn 2)
  - `Gaffa 2.0 Portrait Treatments.dc.html` — portrait treatments (turns 3–4)
  - `Gaffa 2.0 Portrait LOCKED.dc.html` — the portrait across a real XI (turn 5)
  - `Gaffa 2.0 Player Meta.dc.html` — how the club and graded role sit under a name
    (turns 6–7); the crest chip was chosen here
  - `Gaffa 2.0 Baseline Rule.dc.html` — the baseline rule, locked against the real engine
  - **`Gaffa 2.0 LOCKED.dc.html`** — the locked system, rendered from the spec files below
- **Spec files** (these are what get ported, not the pages):
  - `gaffa-surface.css` — the "1f" treatment: ground, panel, spectrum, scoreline, row tint
  - `gaffa-portrait.css` — the portrait: crop, ground, shadow, three sizes, fallback
- **Palette tool:** `verify-palette.mjs` in this directory.

## What 2.0 is

Gaffa's identity is preserved: warm cream, Newsreader over Hanken Grotesk, the forest
green `#146B40` / `#1FA35F`, the twelve-position spine, serif tabular figures. What is
rebuilt is the system underneath.

| Problem in 1.0 | 2.0 |
|---|---|
| Green meant brand, live, success, hover, 3 positions, and neutral status | **One job per colour.** Green = Gaffa and "yours". Live is a broadcast tally red. Two knowing exceptions, both recorded with their cost: the winger sage, and the performance ramp. |
| — | Dark **keeps** Gaffa's charcoal-navy. A warm-derived dark was tried and rejected: warm light with a cool dark is a legitimate pairing, and the navy reads clean |
| GK badge 2.4:1, CM 3.3:1, several position hues ~2.3:1 as dark-mode text | **104 pairs verified at build time**, both themes |
| Gold `#93702F` and bronze `#92400E` converged | Pulled apart; medal ramp reads 1/2/3 at a glance |
| `#ef4444` / `#f59e0b` were raw Tailwind defaults | Retuned into the warm palette |
| Italic serif accent carried headings, live, eyebrows, and suffix tags | **One job:** the section / card heading |
| Nothing showed that scoring is against a positional baseline | **The baseline rule** — the new signature component |
| No image treatment existed in the system at all | **Portraits** — see "The portrait" below. The position-tinted plinth was tried and rejected |
| The italic serif and the UI sans left no face for column heads, club names and axis labels, so JetBrains Mono took the job | **Archivo Narrow** carries that role. Mono is reserved for values that genuinely tick — countdowns, lot numbers, bid clocks |
| LW/RW were sage green, colliding with the accent | Moved to a muted **terracotta** matched to the spine's own saturation; LWB/RWB pushed off the green band |

## The baseline rule

**Locked 2026-08-10.** Prototype: `Gaffa 2.0 Baseline Rule.dc.html`. In code: `.g-baseline*`
in `globals.css` + `src/components/players/BaselineRule.tsx`.

The one component no other fantasy app can copy, because no other fantasy app scores
this way. A stat is never a bar filling toward a maximum. The median for the player's
**own position** is engraved as a fixed tick and his ink is laid over it, so you always
read "against his role" rather than "out of some total".

Three things only became clear once it was built against the real engine:

- **The tick is a constant 50%, and there is nothing to look up.** `sigmoidNormalize()`
  (`matchRating.ts`) is centred on the positional median, so `score = 0.5` *is* that median
  for every component and every position. An earlier mock put the tick at 57 / 55 / 56% on
  three rows of one player, which the maths does not allow. Nothing reads
  `rating_reference_stats` at render time — normalisation already folded it in.
- **So the ticks stack into one continuous vertical rule.** That is the whole payoff: "judged
  against his role" stops being a caption and becomes the structure of the card.
- **The figure is 0–100, and it is the same number as the bar length.** The score is already a
  logistic CDF value, so ×100 reads as a position-relative mark where **50 is his own median**;
  the bar fills to 87 and the label says 87. Caveat to keep in view: this is the engine's own
  logistic scale, not an empirical rank. 87 is not "better than 87% of attacking midfielders",
  it is 87 on the curve that produced his points.

  Two alternatives were built and set aside, both in the prototype if the question reopens.
  **Signed ±50** (0 at the rule) is the more principled reading — if the rule is the point,
  measure from the rule — and it was tried; it makes the figure agree with the rule but
  disagree with the ink, which still runs from the left, and it made a plain component feel
  like a statistics readout. **σ** (`ln(s/(1−s))`) is honest and reads as homework. There is a
  fully coherent version — ink diverging from the rule so bar and figure are the same
  quantity — but it throws away absolute level: a 63 and a 38 look equally emphatic in
  opposite directions.

Implementation note worth keeping: the continuous rule **cannot** be one element spanning the
grid. The rows are `display: contents` and auto-place, so an explicitly placed spanning child
shoves every track a column right — it did, tracks rendered at the value column's width.
Each row's tick fills its own row box with `row-gap: 0` instead, so ticks butt together
exactly at any row height, with no offsets to re-tune when the type scale moves.

### The performance ramp

**Locked 2026-08-10**, by Duke's call, and it is the one place 2.0 knowingly breaks its own
colour law. Recorded here rather than argued, the same way the winger sage is.

The 0–100 figures and the points figure are coloured by how they sit against the player's own
positional median. Five stops, `--color-perf-*`, applied through `perfClass()`
(`src/lib/scoring/perfBand.ts`) so the bands are defined once:

| stop | band | light | dark |
|---|---|---|---|
| poor | ≤ 34 | `#B04B3D` | `#E37969` |
| low | 35–44 | `#9B5B2B` | `#CC8758` |
| mid | 45–55 | `--color-text-primary` | same |
| good | 56–69 | `#42764E` | `#6DA378` |
| best | ≥ 70 | `#147B47` | `#4EA972` |

- **The midpoint is plain ink, not amber.** The median is not a verdict, and no mid-ramp
  yellow clears 4.5:1 on cream — so the ramp runs warm / ink / cool rather than
  red / yellow / green. That is what makes it accessible at all.
- **Derived at 4.8, not 4.5.** Solving to the AA floor exactly put every stop at 4.50:1, the
  tightest pairs in the whole palette and one background nudge from failing. Same reason the
  keylines aim past 3.0. All 184 pairs pass and the ramp is no longer among the tightest.
- **The cost:** `perf-best` is **1° in hue** from `--color-accent` and `perf-poor` **1°** from
  `--color-danger`. A strong figure is the same green as "yours"; a weak one the same red as
  danger. A teal→clay ramp 47–56° off the accent was built and measured
  (`Gaffa 2.0 Baseline Rule.dc.html`) and set aside — green-to-red reads instantly, and that
  was judged worth the collision.
- **The mitigation is containment.** The ramp is only ever **text on a figure** — never a
  fill, badge, tint or status. Extending it anywhere else is what would actually break the
  law, rather than bend it.
- **The points figure takes the band of the composite that produced it**, never the raw point
  total, or its colour would mean something different from the figures directly beneath it.

Below-median rows also drop the ink to `.55`. They no longer mute the figure — the ramp is
what says "below" now, and muting would override it.

**Where it goes on the page.** Full panel width, on its own row *beneath* the player's
identity — not in a hero's text column. Two things break if it shares a row with the
portrait: the track collapses (measured at **76px inside a 430px card**, against **310px**
full-width), and six rows make the text column outgrow the 120px portrait, so an
`align-items: end` hero drops the photograph to the floor with a hole above it. The header
that belongs above it is **`.g-player-head`**.

## The player head

**Locked 2026-08-10.** `.g-player-head` in `globals.css`. Portrait | identity | figure on one
row, centred against each other, with the baseline rule spanning the full width beneath.

**The figure gets its own column.** It had been the last flex child of the name line with
`margin-left: auto`, which is exactly why it read as floating — pinned to the far right of a
row whose only other content was a short name, tied to nothing, with no baseline of its own.
A column plus a caption ("Points") turns it into an instrument reading. The type steps up
with it (name `--t-20`, figure `--t-32`) so the identity occupies the portrait's height
rather than hovering in the middle of it.

`minmax(0, 1fr)` and the ellipsis on the identity column are **load-bearing**. With
`min-width: 0` and a nowrap name, a long name spills out of its column and sits on top of the
figure — measured at a **31px overlap** on "Bruno Fernandes" at hero type in a 430px card.
Names should never truncate at real panel widths; this is the guard for when they would
otherwise collide.

A 104×120 hero portrait will always leave some air, because two lines of text cannot fill
120px — but it reads as margin around a photograph rather than a number floating in a gap.
The 66×78 alternative is in the prototype and takes about 40px off the block.

## The surface ("1f")

**Locked 2026-08-10.** Spec: `gaffa-surface.css`. Rendered with the portrait in
`Gaffa 2.0 LOCKED.dc.html`, which links both spec files and adds only layout glue, so the
specs cannot drift from the proof.

The approved direction is depth from a real light source, the position spine used
structurally but rationed, and the scoreline given the presence of an instrument.

**The rule that governs it:** a gradient ground is not free. 1.0 verified its inks against
a *flat* page and a *flat* card, so any gradient reaching past those values invents surface
the palette was never checked on. The first draft broke four things:

| surface | first draft | measured | needs |
|---|---|---|---|
| light ground, dark end | `#EFE9DF` | `border-strong` 2.94 | 3.0 |
| dark ground, light end | `#2B3348` | `live` / `danger` 4.41 | 4.5 |
| dark ground, light end | `#2B3348` | `border-strong` 2.86 | 3.0 |
| dark panel, light end | `#2A3145` | `border-strong` 2.94 | 3.0 |

So every ramp now **ends on a value the palette already verifies** and travels only in the
direction that improves contrast. The darkest point of any surface is one 1.0 already
cleared. That also solves the long-page problem for free: because the final stop equals
`background-color`, a page taller than the gradient has no seam and no unverified region
below the fold.

- **Ground** `radial-gradient(120% 90% at 50% -18%)` from `#FFFFFF` into `--color-bg-primary`.
  Dark: from `#292E3E` into `--color-bg-primary`.
- **Panel** elevation declared **once** — shadow, no border — plus a 1px inset top highlight,
  which is a line rather than a surface and so carries no contrast obligation. In dark the
  panel darkens *from* the verified card value and must never lighten past it.
- **Header wash** is **light-only**. On cream it reads as light landing on the panel; on navy
  the same device would have to lighten past the verified card, so dark uses the rule alone.
  A theme is allowed to solve something differently.
- **Spectrum** twelve hues as a 3px rule, **rationed exactly like the tracked label**: only on
  a panel representing a whole squad or the whole player pool, where all twelve positions are
  genuinely in play. Anywhere else it is decoration.
- **Scoreline** figures on the top line, margin axis full width beneath. The figure stays in
  **ink** — a red score reads as danger, not as live, and live already has its own marker.
  Your side is ruled in the accent, because accent means "yours".
- **Row tint** position hue on **hover only**. Tinting every row at rest turns a squad into a
  paint chart.
- **Labels** the condensed face (`--font-condensed`, Archivo Narrow), not mono.

## The portrait

**Locked 2026-08-10.** The spec is `gaffa-portrait.css` in the design project — that file
is what gets ported, not the page. Rendered at all three sizes across a real XI in
`Gaffa 2.0 Portrait LOCKED.dc.html`.

Premier League headshots are **500×500 transparent PNG cut-outs**, not 110×140 — an
earlier version of this file said otherwise, and that single wrong line is what produced
an undersized, shirt-heavy crop. The id is FPL bootstrap's `elements[].code`.

**Availability is a status question, not a byte-size one** (measured against the full
2026-27 bootstrap, 2026-08-10, during the port). A player with no cut-out gets a **403**,
not a 404 and not a placeholder image; the ~250-byte body this file previously called a
placeholder is that 403's XML error document. So an `<img>`'s own `onerror` is enough, and
no size check is needed. Two things the same pass established:

- **156 of 573 players (27%) have no 500×500 cut-out.** The fallback is a designed state
  carrying a quarter of the pool, not an edge case.
- **The two CDN sizes are different pictures with different coverage.** `110x140` serves a
  220×280 cut-out framed tight to its edges; `500x500` is square with the figure centred,
  and the locked crop is measured against that one. Some players have the small one and not
  the square one, so `photo_url` being non-null does not imply a portrait exists. A
  `250x250` path does not exist at all — every request 403s.

**The 220×280 is therefore a second tier, with its own crop** (added 2026-08-10). Its
framing is tighter, so reusing the locked zoom would over-crop it. Derived by matching head
width in the composed frame across eight players (`scratch/solve_portrait_zoom.mjs`;
interpolated exact match 1.418):

| | square source | tall source |
|---|---|---|
| hero / lot zoom | 156.25% | **142%** |
| row zoom | 150% | **136%** |
| inset | 9 / 6 / 4px | **unchanged** |

The insets do not move because the head is flush to the top edge in both (0–0.4% square,
0–1.1% tall), so "push the image down, never crop higher" carries over untouched.
Per-player variance is wider in the tall source, which is why it is a fallback and not a
replacement. Order is square → tall → serif initial.

Measured across five cut-outs (`headmeasure` pass, 2026-08-10):

| | head top | shoulders begin | head centre x | head width |
|---|---|---|---|---|
| range | **0.4–0.8%** | 45–51% | 46–51% | 29–34% |

The head is **flush to the top edge** — there is no headroom in the source. Any crop that
zooms and shifts upward removes the top of the skull. The framing is consistent enough
across players that one rule serves all of them.

- **Crop window** `x 18–82%, y 0–69%` — `background-size: 156.25%`, `background-position: 50% <inset>`.
- **Inset** 9px hero / 6px lot / 4px row. Breathing room above the head comes from pushing
  the image **down**, never from cropping higher.
- **Ground** a radial light at **0.6** strength, centred at `50% 25.6%` (0.5 read flat, 1.0
  read like a portrait studio). **Never tinted by position** — the kit already carries
  strong colour, and a position tint fights it (a mauve AM ground behind a red Man Utd
  shirt was the tell).
- **Shadow** `drop-shadow` on the image element, so it follows the player's real silhouette.
  This is only possible because the source is a cut-out, and it replaces a blurred contact
  ellipse that was faking the same effect badly.
- **Frame** `--r-control` plus a 1px hairline. Elevation declared once.
- **Sizes** hero 104×120, lot 66×78, row 44×44.
- **Club crest** chipped on the lower-left corner, 28 / 22 / 16px. Chosen 2026-08-10 over a
  club text line under the player name — see below.
- **No photo** a serif initial on the same lit ground. Absence shown, never faked.

### The club is a crest, not a line of text

The club used to be a tracked-caps line under the player name, stacked with the "graded as…"
caption. Three things were wrong: the club **ran long** and wrapped; two stacked caps lines
gave a club and an explanation **the same rank** when they are different kinds of thing; and
the badge, name and caps lines **staggered on the left** (badge, indent, back out). The spec
also contradicted itself — it reaches for the condensed face because *"a club name is a
name"*, then set that name in tracked capitals.

A crest is how football says a club name. It needs no words, and it cannot run long. Four
treatments were built and measured (`Gaffa 2.0 Player Meta.dc.html`); the corner chip won:

| | hero block height |
|---|---|
| club as two caps lines (before) | 170px |
| crest 26px above the portrait | 186px |
| crest 20px + short name above the portrait | 180px |
| **crest chipped on the portrait corner** | **153px** |

The versions that sat the crest *above* the portrait made the block **taller**, not shorter.
The hero's height is `max(left column, right column)`; the right column was the taller one,
which is what created the gap above the photo in the first place, so shortening the text side
hands the job to the left one. The chip is positioned out of flow and costs nothing. It also
lets a squad row collapse from two lines to one, since the club was the only reason for the
second.

Two things this decision owes:

- **It reintroduces a filled circular mark**, which the 1.0 indicator language deliberately
  deleted. It earns the exception by being real club identity art rather than a status pill —
  the thing that rule was written against — and by being the only element here that survives
  at row size without words.
- **`overflow: hidden` on the frame would clip it**, so the chip is a *sibling* of the frame,
  never a child.

Badge art is `/team-logos/{slug}.png` via `resolveClub()` — never an FPL `teams[].id`.
`resolveClub` returns null rather than guessing, so an unrecognised spelling renders no crest
instead of confidently rendering the wrong club. Note the registry's own display name for
Man Utd is **"Man Utd"**; "Manchester United" is only an alias, so the long form was never
the house style.

Rejected along the way, with reasons: the position-tinted plinth (fights the kit), a
bottom contact ellipse (a fake shadow), the shield crop (its point drives a V through the
chest), a full-strength floodlight (studio-portrait, not product), and a desaturated
treatment (throws away the only real photography the product has).

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

## Palette reconciliation (2026-08-10)

The verifier used to certify values the app did not run, so a green run proved nothing
about nine tokens. Every one is now resolved and `verify-palette.mjs` reports **zero drift
against `globals.css`** — a passing run is now a real guarantee. Re-check with:

```bash
node design-2.0/verify-palette.mjs
```

**Four were live WCAG failures**, not preferences:

| token | was | measured | now |
|---|---|---|---|
| `--color-accent-blue-hover` (dark) | `#18814D` | **2.87:1** on a card — every hovered link | `#37BE77` (5.90) |
| `--color-accent-hover` (dark) | `#18814D` | **3.76:1** with `.btn-primary`'s dark ink | `#37BE77` (7.72) |
| `--color-silver` | `#94a3b8` | **2.32:1** on the light page | `#6C7176` / `#AEB4BA` |
| `--color-bronze` | `#92400e` | **1.99:1** on a dark card | `#8A4A22` / `#CD8450` |

Silver and bronze failed because the medal ramp had **no dark theme at all** — one set
served both. That, not "gold and bronze converged", is the real defect: hue separation is
~34° in the old ramp and the new one alike.

Also adopted: `--color-danger` `#ef4444` → `#A32219` / `#F0736A` (was 3.40:1 as text across
29 call sites, and had no dark override), `--color-accent-hover` light `#1B8350` → `#0F5632`
so hover **moves away from the ground** in both themes, and warm `--color-text-primary` /
`--color-text-secondary`.

**Three went the other way — the app was right and 2.0's proposal was wrong:**

- `--color-bg-card-alt` — 2.0's `#F3EFE6` gives a zebra separation of **1.118**, above this
  file's own 1.03–1.10 target. The app's `#f9f6f1` is **1.051**. Kept.
- `--color-border` / `--color-border-subtle` — 2.0's are *fainter* (1.39 vs 1.58 on the
  page), carry no AA obligation, and the audit's strongest finding was that hairlines are
  what make the newer pages read as precise. Softening 591 call sites buys nothing. Kept.

## Scale policy

Three token systems ship at once (`--text-*` ×329 vs `--t-*` ×72, `--space-*` ×779 vs
`--s*` ×121, `--radius-*` ×302 vs `--r-*` ×23). A blanket sweep is ~1,410 substitutions
across 63 stylesheets for zero visual gain and a large regression surface, so:

> **2.0 scales in new and ported surfaces. 1.0 frozen everywhere else.** A page pays its
> own migration when it is ported, and no page is half-migrated.

The one exception, already applied because it is a defect rather than a preference: every
`font-size` **at or below 8px is gone** — 63 declarations across 15 files, now `var(--t-10)`.
141 declarations between 8 and 10px remain and move with their page.

## What the first route port established (2026-08-11)

`transfers/auctions`. Three rules came out of it, all forced by measurement rather than
argued, and all general — they belong to the system, not to that page.

**1. A washed row carries primary and secondary ink only.** Decision 4 says a tinted ground
carries primary ink; measuring showed how literally that holds, and that **dark is where it
bites**. On `--color-tint-accent` in dark: `text-muted` **3.65**, `accent` **3.13**,
`danger` **3.57**. Even at a far weaker 12% wash, dark gives muted **4.32**, accent
**3.70**, danger **4.22** — because dark's `text-muted` starts at only **5.05** on the card
and a wash spends the headroom. `text-secondary` survives at **5.70**. Light is forgiving
by comparison (only `gold` fails, at 4.11). So a state row lifts its muted meta to
secondary through one variable, and the tint tokens stay what they are: a ground for a
single primary-ink statement, **not** a row wash.

**2. The wash and the coloured status word are alternatives, not partners.** "Leading" in
accent on an accent wash is green on green — **3.70** in dark, and the same "both at once"
defect `verify-palette.mjs` already calls out for tints. The row is green; the word goes to
ink. An unwashed row keeps the coloured word, because there it is the only carrier.

**3. Live money is mono, settled money is serif.** 2.0 reserves mono for values that tick,
and "is it money" turned out to be the wrong question. A standing bid ticks — it moves while
you look at it, and it is what the countdown counts down to. Club Balance and the "gone this
week" price record do not; they are figures you compare down a column, which is decision 6's
serif job. The split runs by liveness.

**4. A row of mixed type sizes aligns on a baseline, not a centre line.** Where half a row's
columns carry a caption under their value and half do not, centring every cell drops the
caption-less ones into the gap **between** a figure and its caption — measured at **13–14px**
below the figure they are meant to be read alongside. Every column was individually correct
and the row still read loose. `align-self: baseline`, not `start`: the values are different
sizes, so top-aligning trades one misalignment for a subtler one. Objects (a portrait, a
button) keep the row's centre; type takes the baseline.

**5. `--color-accent` is a fill; `--color-accent-ink` is the text.** `globals.css` already
said so and the port used the fill token for text anyway — **4.33:1** in dark on every accent
figure and label. The genuinely missing token was **`--color-on-accent`**, the label *on* an
accent fill, which has to **invert by theme** because dark's accent is the brighter colour:
white is 6.4:1 on light's `#146B40` and only ~2.5:1 on dark's `#1FA35F`. Reaching for
`--color-bg-card` instead, as this port first did, produced a 4.33:1 button label. Both are
now tokens, so the next port cannot repeat it.

Three more failures worth recording because **each theme failed differently**, which is the
whole argument for verifying both: light `--color-warning` **2.09** as an ink (it is a fill),
dark `--color-defeat` **1.89** (a match result, with no dark value at all), and dark
`--color-pos-cb` **2.00** — a position *field* colour borrowed for a filter chip, breaking
the colour law and the contrast floor in one move.

### A board is one panel

**Applies to every main-plus-rail surface, not just this page** — the Market's *The Wire*,
League Home's rail, and anything else that puts a feed or a ledger beside a list. Duke's
call, and it is the general rule.

**A list and its rail are one panel with an internal hairline, never two panels with a gap.**
The first port got this wrong: it read "elevation is declared once" as "every region is a
panel" and floated the lot list and the saleroom side by side. Three things break.

- **Two panels is two elevation declarations** for one composition. Decision 1 asks for
  elevation declared once *per thing that floats*, and a board is one thing.
- **The rail is short and the list is long.** As an independent card the rail ends where its
  content ends — measured ~200px above the bottom of the list — leaving a column of dead
  ground beside it. As a *column* of one panel it simply stretches.
- **It severs a real relationship.** "Committed if you win / Free after that" is arithmetic
  on the lots in the table beside it. A hairline between two columns of one field says they
  belong together; a gap between two cards says they do not.

Two details that make the joined version read as one field rather than two things sharing a
shell: the rail's own head takes **no bottom rule** (the table's column-head rule belongs to
the table and stops at the divider — a second rule reads as a competing header band), and
when the layout stacks, the divider **turns** from a vertical hairline into a horizontal one
rather than disappearing.

One fix to a primitive, found by its first real consumer: **`.g-row:hover` now paints with
`background-image`, not the `background` shorthand.** The shorthand resets
`background-color` to transparent before painting, so any row carrying a state colour of its
own lost that state the moment the pointer touched it. A row with no background of its own
renders identically either way.

Two judgements worth recording. **The spectrum stayed off** — it is rationed to panels
representing a whole squad or the whole pool, and a list of live lots is neither. **The
lot-size portrait went in the drawer, not the row**: the row's name column was already
measured 10px short of the string it wanted at 1280, and a 66px portrait would have made a
measured problem worse, so the row takes the 44px size (+6px, paid for out of the leader
column) and the expansion is where the 66×78 lands.

## What finishing the hub established (2026-08-11)

`transfers`, `transfers/listings`, `transfers/free-agents`, `transfers/deals`, plus the two
shared pieces every room renders — `TransfersSubNav` and `ListingCard`. All seven
stylesheets end at **0 raw hex, 0 rem font-sizes, 0 1.0 scale tokens, 0 radius literals**,
and **60 measured colour pairs pass in both themes**.

**1. A shared chrome element has to take the gutter of the surfaces it caps.**
`TransfersSubNav` used a `1.75rem` gutter against the ported page's `var(--s6)` beneath it,
so the nav items sat **4px outside** the title they label — visible on the auction room the
day it shipped. One shared element inherits its offset onto every page it lands on, which
is what makes this different from a page getting its own padding slightly wrong.

**2. "Recently redesigned" is not "already on the system", and can be further off than
old code.** The four rooms were rebuilt weeks ago and had **85 raw `rem` font-sizes**
between them, including the 8.5–9.6px band, and almost no `--text-*` / `--space-*` /
`--radius-*` at all. `trades`, which is older and legacy, was properly on 1.0 tokens.
Recency predicted improvisation, not conformance — a page written between systems reaches
for literals because neither scale is obviously the one to use.

**3. The colour law breaks hardest at the *fills*, and the position spine is where it
goes.** Nine separate places used `--color-pos-cb` or `--color-pos-wb` to mean "trade" and
"loan" — chips, tags, buttons, stat figures, schedule pips and wire dots. It is an easy
substitution to make, because those hues are the only large set of distinct colours the
palette has, and it is always wrong: the hue already means centre-back and wing-back
everywhere else. Two rules came out of removing them:

- **Where the element carries a word, delete the hue and do not replace it.** A stance chip
  that says "Wants players", a facet that says "Would loan out", a tag that says "Loan · GW3–8"
  — the word was always the carrier and the colour was decoration that happened to break
  the law. Nothing is lost.
- **Where colour is the sole carrier, add a form axis rather than a hue.** The Wire's five
  event kinds have no words. The palette has no five free hues (every remaining one means
  medal, live, or danger), so a **loan is a ring and a trade is a disc** in the same ink —
  which reads as "the player goes back" better than a colour did. Same move as the auction
  room's provenance tag, which is told apart by border style.

**4. `--color-on-warning`**, added here. `--color-warning` is a fill, and the label on it
was a `#1C1C1C` literal doing the job by hand. Unlike `--color-on-accent` it **does not
invert**, because the fill does not — warning is `#f59e0b` in both themes, so its ink is
dark in both. It is declared in both blocks anyway, so no consumer has to know that.

Both are now in `verify-palette.mjs`, which had a real hole here: it checked
`'white on accent fill'` at **3.0**, and passed, while the label dark actually paints
measured **2.70**. Two errors compounding — it tested a colour the app does not use, at a
floor a button label does not owe. It now checks `on-accent` and `on-warning` themselves at
4.5. (186 pairs, up from 184.) Worth knowing when trusting a green run: the verifier's
tables are a **hand-maintained copy** of `globals.css`, not a parse of it, so they can still
drift — reconciliation is a manual pass, last done 2026-08-10.

**5. Three of the eight failures found were on tokens that have no dark value**, and every
one of them failed only in dark: `--color-warning` as an ink (2.09 light, and it is a fill),
`--color-defeat` (2.20 dark, a match-result colour used for "offers to answer" and for The
Wire's live marker), `--color-pos-cb` / `--color-pos-wb` (2.00 / 2.28 dark). A token with a
single value serving both themes is the reliable predictor of a dark-mode failure —
worth grepping for on the next port before reading anything else.

**6. The liveness split survives contact with a page that has both kinds side by side.**
Free Agency puts a live-auction chip strip directly above a table of season totals. The
chips keep mono (a standing bid and a countdown both move while you look at them); the
table went **mono → serif**, because value, points, PPG and form are compared down a column.
The whole table having been mono is most of what made a set of season totals read like a
set of tickers.

**7. One primary action per card.** The listing card had four action buttons in four
colours — accent, gold, and two position hues — which is four primaries and therefore none.
The same shape appeared on the deals propose bar (three filled buttons, two hues). Both are
now one accent fill plus ink/ghost siblings. Two of the tints were also contrast failures
(gold 4.13 light on the elevated bar; the position pair 1.79 / 2.04 dark), but the
hierarchy was the real defect.

**Also fixed on the already-ported auction room**, found by applying its own rules next
door: its "You're leading" facet painted `--color-accent` as text, **4.33:1 in dark**. Rule
5 from that port — accent is a fill, `--color-accent-ink` is the text — written a day
earlier, in the file that broke it.

**Left as it is, deliberately:** the deals and market main-plus-rail surfaces are *not*
wrapped in `.g-panel`. They already satisfy "a board is one panel" — one grid, one internal
hairline, the rail stretching rather than ending where its content does — and unlike the
auction room's board these two are full-bleed browse surfaces, as the listings board and
Free Agency are. Elevation stays declared once, as the page.

## What the dialogs added (2026-08-11)

`Modal`, `BidDialog`, `ListingEditor`, `ProposeBuilder`. Four things the surfaces had not
surfaced:

**1. An accent-ink control must not gain an accent wash on its own hover or selected
state.** This is rule 2 from the auctions port, but applied to a *control* rather than a
row, and it turned out to be the single most repeated defect in the section — **six
instances**, two of them on the already-ported auction room. Every one was an outline button
or a selectable card in `--color-accent-ink` whose active state added
`background: var(--color-accent-dim)`, giving accent-on-accent at **4.41:1 in dark**:
`.goGhost:hover` and `.q:hover` (auctions), `.chipGoGhost:hover` (free agents),
`.closingGoGhost:hover` (market), `.templateOn .templateName` and `.dirOn .dirTitle`
(propose builder), plus `.add:hover` and `.pickOn .pickNameBtn:hover` inside the builder.
The keyline and the tint are the state; when the wash arrives the label goes to ink.

It is worth naming as its own rule rather than filing under rule 2, because the shape is
different and much easier to miss: with a row, the wash and the word are written in the same
place. With a control, the ink is on the base class and the wash is on `:hover` — two rules,
often far apart in the file, each defensible alone.

**2. A duplicated rule decays into a stale rule.** `ListingCard`'s crest restated
`SquadPeekButton`'s press treatment instead of letting it own it, and the copy had drifted
to a superseded version — a hard `box-shadow` ring rather than the current lift and
silhouette drop-shadow. Worse, the copy's geometry assumption had quietly stopped holding:
`border-radius: 50%` on a flex child with no `align-self` renders as an **ellipse** once the
row grows, which it did when the portrait moved to the lot size. Two bugs from one
duplicated rule. `standings` still carries its own copy of the same treatment, currently in
sync; it should be collapsed onto the shared class before it drifts too.

**3. A cross-file coupling stated in a comment is not a coupling.** `ListingEditor`'s three
gates were coloured from `--color-pos-cb` / `--color-pos-wb` with a note saying they took
"the colour its pill wears on the card, so the dialog and the board agree without a legend".
When the card's pills dropped those hues, nothing failed and nothing complained — the
comment simply became false. The gates now share **one** selected state (the accent keyline
plus its tint) with their own words saying which is which, which is both what the card does
now and one fewer thing to keep in sync.

**4. Money splits by liveness even inside a form.** `BidDialog`'s amount field stays mono —
it is the live figure, and the thing the countdown counts down to. `ListingEditor`'s three
price inputs went to **serif**, because they are the same three figures the card's ladder
shows and the board compares down a column. What you type in the editor is now the face you
see on the board. The bid dialog's ladder splits the same way per rung: standing bid and
countdown mono, minimum and clause serif.

**On porting a 1,000-line stylesheet:** `ProposeBuilder`'s scale migration was done by an
explicit scripted mapping rather than by hand, so no rule could be silently dropped — the
transform is recorded at the top of that file. Two judgements in it generalise. Values
**below the scale floor** (1.6–3.2px optical nudges on checkboxes and glyphs) were kept at
their measured size in px rather than snapped up to `--s1`; `globals.css` already does this
where it needs a 5px or 6px value, and rounding them would move things a port has no
business moving. And **widths are not spacing** — a column track or a control dimension does
not belong on the space scale, so those were converted to px and left alone.

**Still duplicated, worth extracting:** the ghost/primary button pair, the error box and the
tracked field label are now written four times across the dialogs. They are consistent
today because they were ported in one pass; point 2 above is the argument for not leaving
them that way.

## Port order for the remaining routes

**Order by adjacency first, then by how much a surface exercises the system.** The first
version of this list ranked purely on component coverage, which put `transfers/deals` at
the bottom as "redesigned recently and not urgent" — and that was wrong, for a reason worth
keeping. `transfers` is not five related pages; it is **one hub with four rooms**, and
`MarketClient` is a doorway that links straight into all of them. Porting the auction room
alone put a 2.0 page in the middle of four 1.0 ones, so a manager crossed the seam twice in
two clicks without leaving the section. A seam between distant sections is a blemish; a
seam inside one section is a bug. `free-agents` and `listings` were not on the list at all.

Six surfaces are on 2.0 (League Home, and the whole Market hub).

1. ~~**`transfers/auctions`**~~ — **done 2026-08-11.** Exercised the portrait at both row
   and lot size, the countdown (mono), `--color-live`, the panel, the condensed face and the
   row tint. Ended at 0 raw hex, 0 rem literals, 0 1.0 scale tokens, 136 2.0 token uses.
2. ~~**The rest of the Market hub**~~ — **done 2026-08-11.** `transfers`,
   `transfers/listings`, `transfers/free-agents`, `transfers/deals`, `TransfersSubNav`,
   `ListingCard`. See "What finishing the hub established" below.
3. **`team` + `team/roster`** — the pitch and the squad. The twelve-position spine at full
   density, and the biggest raw-hex debt (`pitch.module.css`, 98 hex literals). Note
   `ListingEditor` is shared with this route, so the dialog pass below overlaps it.
4. **`players` / `stats`** — where the **baseline rule** finally becomes a real component
   rather than prototype CSS.
5. **`matchups` + `matchups/[id]`** — the scoreline treatment from turn 1.
6. **`standings`, `history`, `finance`** — table-heavy, mostly typographic, low risk.
7. **`draft`** — largest and most literal-ridden (1,519 lines), and dormant between
   seasons, so it is last and cheapest to defer.

The `transfers/` **dialogs** — `Modal`, `BidDialog`, `ListingEditor`, `ProposeBuilder` —
followed the surfaces on 2026-08-11. See "What the dialogs added" below. The section is now
wholly on 2.0: **0 raw hex across all 11 of its stylesheets**, and no `rem` literal of any
kind left in the four dialogs.

**`trades` is legacy and will never be ported.** It is out of the nav and nothing links to
it; it survives only because `src/components/auth/AuthShowcase.tsx` imports `TradeCard`
from it for the public login carousel. `admin/*` never faces a manager.

## Not done yet

- 25 dashboard routes still on 1.0; 31 stylesheets still hold raw hex (was 38).
- 91 `font-size` declarations between 8 and 10px, to move with their page — 39 in `rem`,
  52 in `px` (was 141 before the auctions port, 130 after it, 103 after the hub surfaces).
- Radius literals decision 3 was written to kill: 2px ×30, 3px ×24, 5px ×1, 7px ×0. The
  dialogs cleared every 7px in the app and all but one 5px.
- Elevation: 177 `box-shadow` against 590 `1px solid`. The rule is now stated in
  `globals.css`; surfaces carrying both get reconciled as they are ported.
- The dialog controls (ghost/primary buttons, error box, tracked field label) are written
  four times over — see "What the dialogs added".
- `standings` carries its own copy of the squad-peek press treatment, currently in sync with
  `SquadPeekButton.module.css`. Collapse it before it drifts, as `ListingCard`'s copy did.
- The 1.0 eyebrow roles are deliberately absent from 2.0 — 34 call sites across
  `ds-eyebrow` (12), `ds-eyebrow-serif` (7) and `ds-label` (15). Mapping: a genuine
  dateline or metadata line keeps `ds-label`; a label sitting above a heading is deleted
  (the heading carries its own weight); everything else becomes `t-heading`.
- ~~The baseline rule has no component in `src/`.~~ **Landed 2026-08-10** as `.g-baseline*` in
  `globals.css` + `src/components/players/BaselineRule.tsx`, which takes
  `MatchRating.breakdown` straight from the engine. See "The baseline rule" above.
  `POSITION_LONG` (the twelve positions in prose) is exported from that component for reuse.
  The header above it is `.g-player-head` — see "The player head".
- ~~Nothing from the two spec files is in `src/` yet.~~ **Both landed 2026-08-10**, ahead of
  the first route port and used by no page yet:
  - `--font-condensed` is Archivo Narrow via `next/font` (`src/app/layout.tsx`), tokenised in
    `globals.css` next to `--font-serif` / `--font-sans` / `--font-mono`.
  - `gaffa-surface.css` → `globals.css` § "GAFFA 2.0 — THE SURFACE" (`.g-page`, `.g-panel`,
    `.g-panel-hd`, `.g-spectrum`, `.g-score*`, `.g-label`, `.g-row:hover`, `.g-track`),
    unchanged, plus one addition below.
  - **`.g-label-quiet`** (added 2026-08-10, not in the spec file). `.g-label` at 12/700/.10em
    is right for an axis tick or a column head and too heavy for a caption sitting *under*
    something — as a club under a 13px player name it competed with the name rather than
    sitting beneath it. The quiet variant is 10/500/.05em: same family, same job, one step
    back. Tracking eases too, because tracking adds apparent size.
  - `gaffa-portrait.css` → `globals.css` § "GAFFA 2.0 — THE PORTRAIT", with the two-letter
    class names namespaced (`.pfw`/`.pf`/`.im`/`.fb` → `.g-portrait*`) because a global
    stylesheet cannot own names that short. **One deliberate deviation:** the spec paints the
    cut-out as a `background-image`, which fires no event when it fails; the port uses a real
    `<img>` at the same zoom and inset so the 403 reaches the fallback.
    ~~Every measured value is unchanged and the two render identically.~~ **They did not
    (fixed 2026-08-11).** `background-size: 156.25%` answers to nothing, but `width: 156.25%`
    on an `<img>` is clamped by the base reset's `img, svg { max-width: 100% }` — so the zoom
    was silently discarded and **every portrait in the app rendered at 1.0**, the whole
    cut-out scaled to the frame's width. A square frame (`sm`) hid it, because a square source
    fits one exactly; the tall frames ran out of picture and left a 5–6px band of empty ground
    along the bottom edge, which is how it was finally caught. The fix is `max-width: none` on
    `.g-portrait-img`; the spec's numbers were right all along. Measured after: 103×103 in a
    66×78 frame, 69.8% of the source visible — the documented `y 0–69%` window. The lesson is
    the general one: **moving a value into a property the global reset already owns is a
    silent change, not a neutral one.** `gaffa-portrait.css` still specifies the
    background-image form — worth reconciling if the prototype is ever rebuilt from the port.
  - **`.g-portrait-crest`** (added 2026-08-10, now also in `gaffa-portrait.css` as `.crest`) —
    the club crest chip. See "The club is a crest, not a line of text" above.
  - `Portrait` is `src/components/players/Portrait.tsx`; URL and availability rules are
    `src/lib/players/photo.ts` (`fplPhotoCode`, `portraitUrl`, `portraitFallbackUrl`,
    `portraitSources`, `resolvePortrait`, `portraitInitials`). The code is read back out of
    `players.photo_url`, which the sync writes as `.../110x140/{code}.png`; there is no code
    column. The component cascades square → tall → serif initial, keyed on the player so a
    recycled row does not inherit the previous occupant's failures.
- Breakpoints are documented in `globals.css` but cannot be tokenised: custom properties
  do not resolve inside a media query. Twelve distinct widths are in use against five legal.
- The login carousel says "one of 7 supported formations"; the real number is 10.
