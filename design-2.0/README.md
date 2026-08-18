# Gaffa 2.0 — design system

Status: **every route ported; a cross-cutting punch list remains** (see "Not done yet").
The 2.0 tokens landed in `src/app/globals.css`
additively on 2026-08-08 alongside the League Home redesign (see
`LEAGUE_HOME_HANDOFF.md`); both spec files, `--font-condensed` and the `Portrait` component
followed on 2026-08-10 (see "Not done yet"). **`transfers/auctions` was ported 2026-08-11**
— the first route to use the surface, the portrait and the condensed face against real
data, and the first to be fully free of raw hex and 1.0 scales. **The rest of the Market
hub followed the same day** — `transfers`, `transfers/listings`, `transfers/free-agents`,
`transfers/deals`, plus `TransfersSubNav` and `ListingCard` — so the whole section is on
2.0 together. **The squad pages followed on 2026-08-11**: `team` (the pitch) and
`team/roster` (the club), which also ports `clubs/[teamId]` for free — it is the same
ClubClient. That pass added the pitch to the palette and put the spectrum on a page for
the first time. **`stats` and the player card followed 2026-08-12**, and **`matchups` +
`matchups/[id]` the same day** — the port that finally rendered the scoreline, gave the
margin axis something to measure, and moved `MatchupPitch` onto the real grass.
**`standings`, `history` and `finance` followed 2026-08-15** — the podium and the full table
merged into one `.g-panel`, a third named colour-law exception, the first dark value
`--color-defeat` has ever had, and (on `finance`) an uncolourable ten-category bar chart
resolved by splitting each row into its own spent/earned segments instead. **`draft` closed
out the list the same day** — the final route, a fourth hand-rolled position badge replaced
by the shared component, and six controls' worth of a fill-token bug (`--color-text-inverse`
on an accent fill) fixed in one pass. Every dashboard route is now on 2.0; only the legacy
`trades` page and `admin/*` remain on 1.0, both deliberately.

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
| Green meant brand, live, success, hover, 3 positions, and neutral status | **One job per colour.** Green = Gaffa and "yours". Live is a broadcast tally red. Three knowing exceptions, all recorded with their cost: the winger sage, the performance ramp, and the standings form dot (win, not "yours"). |
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
  genuinely in play. Anywhere else it is decoration. *First used 2026-08-11*, on the pitch
  board and the depth chart — the first two panels in the app that qualify.
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

## The pitch

**Added 2026-08-11**, by the `team` port, as `--color-pitch` / `-band` / `-line` in
`globals.css`. It is a surface rather than a component, and it is the only one in the
system that depicts a real object.

`#497D59` grass, `#417551` for the mown stripe, `#FFFFFF` for every line. Derived by
holding 1.0's own hue and chroma and walking lightness down until full white clears **4.8**
(`scratch/solve_pitch_grass.mjs`) — the ramp's reasoning, since a ground carrying a
vignette and a stripe should not be solved to the AA floor exactly.

- **One value in both themes.** Twice over. A depicted object owes the colour law nothing —
  grass is grass, the same category as crest art or a kit — and a legal grass is *darker
  than the dark theme's own card*, so no single green could separate from a cream chip and
  a navy chip by fill anyway.
- **The chip keyline is the pitch's own white line**, which is what makes that work, and it
  is the spine's rule applied to a surface: the line clears 3:1, not the fill.
- **No faded ink.** Labels and the field boundary run at full strength. Alpha survives only
  on interior furniture (penalty box, arc, centre circle, halfway line), which carries no
  information and is not interactive.
- **The vignette only darkens**, so it can only improve every white pair measured against
  the flat grass.

~~`MatchupPitch` still draws 1.0's grass; it moves with port 5.~~ **Moved 2026-08-12** — see "What the round established".

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

Checks 194 text/surface pairs across both themes and exits non-zero on any failure. Where
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
4.5. (186 pairs, up from 184; 194 once the squad-page port added the pitch.) Worth knowing
when trusting a green run: the verifier's
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

## What the squad pages established (2026-08-11)

`team` (the pitch) and `team/roster` (the club). Both stylesheets end at **0 raw hex, 0
rem font-sizes, 0 1.0 scale tokens, 0 radius literals**, and **110 measured colour pairs
pass in both themes** (`scratch/verify_squad_pages.mjs`).

**1. The pitch was a surface the palette had never been checked against, and everything
on it was failing.** 1.0 painted a fixed `#5A8F6A` grass in *both* themes and laid white
on it: touchline **2.23:1**, team label **2.67:1**, empty-slot label **2.94:1**. The
alpha *fade* was most of it — the same white at full strength measured 3.77. So two
things moved together: the ink stopped being faded, and the grass moved to `--color-pitch`
`#497D59`, which is 1.0's own hue and chroma with lightness walked down until full white
reaches **4.8** (`scratch/solve_pitch_grass.mjs`). Alpha survives only on interior
furniture — penalty box, arc, centre circle, halfway line — which carries no information
and is not interactive.

Three things generalise out of it:

- **A depicted object is not a semantic colour.** Grass owes the "one job per colour" law
  no more than a red Man Utd shirt does, which is why the pitch is one value in both
  themes rather than a themed pair. It is the same category as the crest art the portrait
  chips on.
- **It also had to be one value, because no single green can work by fill in both
  themes.** A legal grass is darker than the *dark* theme's own card, so a green that
  separates from a cream chip cannot separate from a navy one. The chip takes a white
  keyline instead — the spine's own rule, that the line and not the fill clears 3:1 — and
  the pitch ends up with exactly one line colour for touchlines and player chips alike,
  which is how a real pitch is marked out.
- **A wash of the ink's own colour is the worst possible ground for it.** The empty slot
  had a 14%-white chip carrying a white label: **3.70:1**. The dashed keyline was already
  saying "empty", so the fill went and the label sits on bare grass at 4.81.

**2. "A board is one panel" is not a table rule.** Written for the auction room's
list-plus-rail, it applies just as hard to a pitch plus its squad rail — you move players
between them, and the rail's counts are arithmetic on what is on the grass. It was a bare
pitch beside four floating cards: **five elevation declarations for one composition**. It
is now one `.g-panel`, two columns, one internal hairline that turns horizontal when the
layout stacks, with the four tiers as sections of the rail. Being four separate rulesets,
the tiers had already drifted apart in padding, hover and selected state; one row class
serves all four now.

**3. The spectrum's first use in the app.** Every earlier port correctly left it off and
said so. A board carrying eleven positions on the field plus every reserve is exactly the
"whole squad or whole pool" panel it was rationed for. The depth chart is the second.

**4. "One tracked label per panel" rations a DEVICE, not an element.** The auction room's
four stat captions look like a breach of decision 5 and are not — a set of figures sharing
one caption style is one device used once. What the rule is actually against showed up on
the depth chart, where eight zone heads plus a formations block wanted to be nine tracked
caps lines down a single panel. Those became headings; the panel's one rationed label is
its head caption. Same call in the club toolbar, where "Show", "Sort" and the shown-count
went to plain muted text.

**5. An ordinal ramp of four steps is not available in this palette on one ground.** The
age profile was accent / a raw `#5A9F73` / `--color-gold` / `--color-defeat` — four
colours for a quantity that runs young to old, one invented, one a medal token, one a
match-result token with no dark value (**1.89:1**). Two replacements failed in opposite
directions, which is the useful part:

| ramp | vs the panel | vs its neighbour |
|---|---|---|
| accent → `bg-inset` | **1.66** light, **1.08** dark | 1.50–1.60 ✓ |
| accent → `text-muted` | 4.33 ✓ | **1.00–1.08** |
| accent → `text-primary` (best available) | 4.33 ✓ | 1.30 |

The second failure is the instructive one: both endpoints were chosen to be legible on the
*same* ground, which is another way of saying they sit at the same luminance. Nothing in
the palette clears both constraints, so the fourth axis is **form** — a 2px gap of panel
between segments — which is the hub port's rule for exactly this case. With the segments
separated, adjacency stops being a contrast problem. `scratch/solve_age_ramp.mjs`.

**6. A `color` set inline cannot be overridden, which is how a wash defect stays
invisible.** The club page's status word takes its tone from a data table and painted it
as an inline `style={{ color }}`, so no rule could lift it when a selected tile put an
accent wash underneath — accent-on-accent at **3.13:1** in dark, and the stylesheet looked
correct because the offending declaration was not in it. The tone now arrives as a custom
property (`--tone`) and the wash wins. Same move lifts every muted cell in a washed row to
secondary through `--row-ink`.

**7. A duplicated component decays into a wrong one.** The club page carried its own
position badge — a plain coloured rectangle keyed off `--color-pos-*` — which made it the
one surface in the app where **LB and RB, and LWB and RWB, were the same badge**. Those
pairs share a hue by design and are told apart by a clipped corner only the real
`PositionBadge` draws. This is `ListingCard`'s crest lesson again, one step further along:
the copy had stopped merely drifting and started being incorrect.

**8. A colour ramp on a raw point total is a second performance ramp, and there is only
one.** The pitch coloured its points badge through `getScoreIntensityColor()` — six stops
of invented hex, unverified in either theme. Beyond the palette problem it means what the
performance ramp means while keying on a different quantity: the raw total rather than the
composite that produced it, which the ramp explicitly forbids. The figure went to serif
ink. (`scoreColor.ts` stays: `MatchupPitch` still uses it, and that route is port 5.)

**9. A fill token is not a mark token.** The doubt indicator is a 5px dot and used
`--color-warning`, which is the bright amber a dark *label* sits on — **2.09:1** as a
standalone mark on cream. It takes `--color-warning-text`. Where a dot is the sole carrier
of a state it is held to the legible value, not the fill value.

**Two other things worth recording.** The pitch's node dropped its three-letter club
abbreviation, because the portrait's crest chip is where the club goes — the same deletion
"the club is a crest, not a line of text" made everywhere else, and it is what let the node
lose a row of type. And `my-team.module.css` **lost two thirds of itself**: 42 unreferenced
classes belonging to an earlier lineup editor `PitchUI` replaced, plus every class of
`RosterManager.tsx`, a 226-line client component nothing had imported since before the club
page existed (deleted; drop, transfer-out and the IR transitions all live on the club
page's Inspector, against the same endpoints). A page redesigned *in place* leaves its old
stylesheet behind almost intact, and the dead half is invisible until someone has to
migrate it.

**Also fixed in passing:** `Inspector` has always passed `styles.posNet` / `styles.negNet`
for "Net vs. fee" and `club.module.css` has never defined them, so the one figure on that
card carrying a direction rendered in plain ink. Found by porting, not by looking.

## What the stats pool established (2026-08-12)

`stats`, plus the deletion of `players`. `stats.module.css` ends at **0 raw hex, 0 rem
font-sizes, 0 1.0 scale tokens, 0 radius literals**, and **140 measured colour pairs pass
in both themes** (`scratch/verify_stats_page.mjs`).

**1. A washed row carries primary and secondary ink only — now under a POSITION hue.**
Rule 1 from the auctions port, arriving on a page whose rows sit on the *page ground*
rather than inside a `.g-panel`. That is the difference that bites: the ground has less
headroom to spend on a wash. Under `.g-row:hover`'s 12% tint the club caption's muted ink
measured **4.40 (ST)**, **4.50 (DM)**, **4.51 (CB)** — three of twelve at or under the
floor, and the rest of the spine only just over it. It lifts to secondary through
`--row-ink`, the club page's own move.

**2. The spectrum's third use, and the first that is literally the pool.** The device is
rationed to "a whole squad or the whole player pool"; the pitch board and depth chart are a
squad, this is everyone. It sits at the head of the page because the page *is* the panel
here — like Free Agency and the listings board this is a full-bleed browse surface, so
elevation is declared once, as the page, and there is no inner panel to hang it on.

**3. `SPINE` / `POS_COLOR` are now `src/lib/positions/spine.ts`.** The spectrum's second
consumer would otherwise have been a second copy of the twelve hues in a second file. Same
defect as ListingCard's crest and the club page's position badge, caught before it landed
rather than after.

**Found and NOT fixed, because it is not one page's to diverge on:** every `input` and
`select` on every ported surface draws its boundary in `--color-border` — **1.58:1 light,
1.72:1 dark**, against WCAG 1.4.11's 3:1 for a control boundary. `--color-border-strong`
clears it. See "Not done yet".

## What the player card established (2026-08-12)

`PremiumPlayerCard` + `PlayerDetailsModal`. **Duke's call: the design does not change.**
Two prototype revisions were built and both rejected — the first read as a 2.0 panel rather
than a card, the second overcorrected into a 430×610 trading card — and the decision was
that the shipping card's design is the one to keep. So this is a **token-and-contrast port
only**: no layout moved, no region was added or removed.

That constraint is what makes the findings worth recording, because they are all defects
rather than preferences.

**1. A component that pins itself to one theme by COPYING the palette is the worst case of
the duplicated-rule defect.** The card is deliberately light-only in both themes — a
trading card is a printed thing, the same category as the pitch grass. It implemented that
by restating 25 tokens inside `[data-theme="dark"] .container`, and the copy had gone
stale:

| token | the card's copy | measured | what globals.css holds |
|---|---|---|---|
| `--color-text-muted` | `#9A9488` | **2.94** on the card, **2.47** on the inset | `#6B6356` (5.78 / 4.85) |
| `--color-text-secondary` | `#4A4A4A` | passes | the warm `#4A453D` |
| `--color-text-primary` | `#1C1C1C` | passes | the warm `#1C1A17` |
| `--color-accent-hover` | `#1B8350` | the hover that **lightens** | `#0F5632` |

The muted value is the damaging one, and the irony is exact: `globals.css` replaced
`#9A9488` *because* it "measured 2.73–2.94:1 … and carried essentially every label,
caption, column head and timestamp in the app". The card kept the failing value and so
never got its own fix — every caption on it has been failing since.

The fix is **`.g-theme-light`** in `globals.css`: `:root, .g-theme-light { … }`, one line,
so a subtree can re-adopt the light palette instead of copying it. Custom properties
inherit from the nearest ancestor that sets them, so a `.g-theme-light` element inside
`[data-theme="dark"]` wins. There is now exactly one definition of the light palette.
**Any future light-locked surface should use this rather than pinning by hand.**

**2. A position FILL colour used as text fails even on a light ground.** `.posSpineText`
— the vertical role label down the card's edge — painted `--pos-color` at `opacity: .65`.
Worst pair (GK on an Aston Villa card) measured **2.17**, and **3.49** even at full
strength. The spine's own rule resolves it: the keyline carries the hue, the text goes to
ink. The rules above and below keep `--pos-color` and are decorative, because the word
itself says the position. Nothing else moves — same size, tracking and opacity.

**3. A per-club gradient is 27 unverified grounds, and the arithmetic has to be done
properly.** `.frontBg` runs the card face into `--team-color-deep` (the club colour at 33%
alpha) over the lower 58% of a fixed 520px card, and two regions carry ink over it. A first
pass assumed the ink sat on *full* team-deep and reported the identity bar failing on 13 of
27 clubs. **That was wrong.** Computing from the CSS literals — `height: 520px`,
`.posSpine { top: 56px; bottom: 193px }`, the identity bar's own wash reaching full
`bg-card` at 70% — the gradient has only travelled 36% by the time it reaches the spine and
the bar's own wash dominates above it. Measured correctly, the identity bar passes on
**all 27** (muted 5.12 worst). Recorded because reporting a failure that is not real is
worse than not checking: a gradient's contrast has to be evaluated **at the y the ink
actually sits at**, not at its endpoint.

**4. The rating ramp was six invented hex stops and five of them failed.** Re-solved
holding hue and chroma, walking OKLCH lightness only, to 4.8 against the card face — so it
reads as the same green/gold/orange/red ramp and is legible:

| band | was | measured | now |
|---|---|---|---|
| ≥ 8.5 | `#3A6B4A` | 6.05 | unchanged |
| ≥ 7.5 | `#5A9F73` | **3.08** | `#387D53` (4.84) |
| ≥ 6.5 | `#C8A642` | **2.28** | `#8C6C00` (4.80) |
| ≥ 5.5 | `#D17D3B` | **3.05** | `#AC5B0E` (4.81) |
| < 5.5 | `#EF4444` | **3.67** | `#D72930` (4.82) |
| null | `#9A9488` | **2.94** | `#757064` (4.81) |

They are declared on `.container`, **not** in `globals.css`, and `ratingHex()` returns
`var(…)` rather than a literal so they can be tokens at all (they are applied through
inline `style`). Keeping them component-scoped is deliberate: the colour law says there is
one performance ramp and it keys on the sigmoid score, while this keys on the 1–10 display
rating. The two are in fact monotonically related — `curveFinalRating()` is a monotone
function of the same composite — so this is arguably the same ramp on another scale rather
than a second one. *Arguably* is not *certainly*, so it stays out of the global token set.

**5. On a fixed canvas, the geometry IS the design, so the scale migration stops at
colour and type.** The card is a `360×520` fixed canvas packed to the pixel. Font sizes and
the two radius roles that land exactly on tokens were converted; the 3/5/6/7/10/11/14px
spacing nudges and the 18/27/60px type were **kept at their measured values**, because
snapping them reflows a card this port has no business reflowing. Same judgement
`globals.css` already makes for its own 5px and 6px values, and the dialogs port for
sub-floor optical nudges. Four `font-size: 9px` did move to `var(--t-10)` — that is the
stated floor rule, not a preference.

`.statGold` also went from `#B8893E` (**2.57**) to `--color-gold` (4.92), and
`PlayerDetailsModal`'s primary action from a hardcoded `#ffffff` on
`--color-accent-green` to `--color-on-accent` on `--color-accent` — the same
"`--color-accent` is a fill, `--color-on-accent` is the label on it" defect the auctions
port named, still present in a shared dialog. `scratch/verify_player_card.mjs`.

## What the round established (2026-08-12)

`matchups`, `matchups/[matchupId]` and `MatchupPitch`. All three stylesheets end at
**0 raw hex outside comments, 0 rem font-sizes, 0 1.0 scale tokens, 0 radius literals**,
151 2.0 token uses, and **148 measured colour pairs pass in both themes**
(`scratch/verify_matchups.mjs`).

**1. The scoreline had been locked for two days and rendered by nothing, and the thing
that was missing was not CSS.** `.g-score` landed in `globals.css` on 2026-08-10 out of
turn 1. Porting it was half an hour; the reason no page had used it is that the spec said
"margin axis full width beneath" and left open what the axis *measures*. A bar with no
quantity is decoration.

**Gaffa has a quantity no other fantasy app has: a matchup inside 10 points is a draw.**
So the axis is built the way the baseline rule is built — engrave the reference, lay the
ink over it, let the reference still show through. Centre is level, a marked zone either
side is the draw band, and the ink runs from the centre toward whoever leads, so its
*direction* is the result and its *length* is the size of it. A fixture you can see
sitting inside the band needs no sentence explaining why it drew.

It is `.g-axis*` in `globals.css` beside `.g-score`, driven by
`src/components/matchups/MarginAxis.tsx`, because both routes in this port draw one and
the clamp, the percentages and the verdict wording would otherwise exist twice on day one.
Two details worth keeping:

- **The tick is the same 2px of `--color-text-primary`, declared after the ink, as
  `.g-baseline-tick`.** Two components that share an argument should share a look; that is
  what makes them read as one family rather than two bars that happen to be near each other.
- **The half-scale is 50 points and margins beyond it clamp**, which puts the ±10 band at
  the middle fifth. That proportion is what makes the band read as a band instead of as a
  hairline pair.

**2. A token that clears 3:1 on one ground does not clear it on another.** The band edges
were drawn in `--color-border-strong`, which is exactly what that token is for — and it
measured **2.83** in light. `border-strong` was solved against the *page*; a `.g-track` is
recessed and darker than the page, so the headroom is not the same. They are
`--color-text-muted` now (4.59 / 6.17), which also leaves a clean three-step hierarchy:
primary for the tick that is level, muted for the rule that is the band, a wash for the
zone. This is the "a gradient ground is not free" lesson one scale down, and it is worth
generalising: **the surface a token was verified against is part of the token.**

**3. A hover that LIGHTENS spends the headroom every ink on the card was verified with.**
`--color-bg-card-hover` is `#2C3344` against a `#252B3D` card — lighter, in dark. Measured
on it, `--color-live` lands at **4.43** and even `text-muted` at **4.53**. This is the
auctions port's rule 1 arriving through a different door: not a tint, just the default
hover token, and it only bites in dark because dark's inks start with less room.

The fix is the panel gradient's own rule applied to a state instead of a surface — **the
row hover only ever darkens**, in both themes, so it can only improve every pair. It takes
`--color-bg-inset`, which is darker than the card in light *and* dark, and it reads as the
row being pressed in, which is what a recessed value is for. Worth grepping before the next
port: `--color-bg-card-hover` under coloured or muted ink is a dark-mode failure waiting,
the same way a token with no dark value is.

**4. The pitch's defects were the squad pitch's defects, unfixed, one route over.** The
squad-page port wrote "`MatchupPitch` still draws 1.0's grass; it moves with port 5", and
everything it had found was still here: a fixed `#5A8F6A` in both themes, faded white on
it, and `getScoreIntensityColor()` on every chip — six stops of invented hex, unverified in
either theme, meaning what the performance ramp means while keying on the raw point total
the ramp explicitly forbids. That was the last consumer, so **`src/lib/utils/scoreColor.ts`
is deleted.** Nothing generalises out of it except the obvious: a note in a stylesheet
saying another file has the same bug is not a fix, and the bug lives exactly as long as the
note does.

**5. The position chip was the club page's defect a third time, and further along.**
`MatchupPitch` hand-rolled its badge from a local `SLOT_COLOR` map that put LB and RB on one
token and LWB and RWB on another — so on this surface those pairs were **the same badge**.
They share a hue *by design* and are told apart by a clipped corner only the real
`PositionBadge` draws. Third occurrence (after `ListingCard`'s crest and the club page's own
badge), and the pattern is now reliable enough to state as a rule: **a component copied
rather than imported does not drift, it becomes wrong** — and the copy is always the one
that misses the fix.

The same map also painted the bench *category* (def / mid / atk / flex) in position hues,
which is the hub port's "the hue already means centre-back everywhere else" defect. A bench
category is not a position; flex had no hue at all and borrowed `text-muted`. A bench chip
takes the player's own position, and where there is no player there is no badge.

**5b. An import breaks the opposite way a copy does — not by drifting, but the instant its
source is renamed underneath it.** Found 2026-08-17, reported as "the login carousel's
position taxonomy screen is messed up": `AuthShowcase.tsx`'s `PositionsVisual` genuinely
`import`s `MatchupPitch.module.css` (not a copy) and builds a standalone pitch from four of
its classes — `halfOuter`, `pitchHalfZones`, `pitchHalfZoneRow`, `halfZone`. This port
renamed all four (`half`, `zones`, `zoneRow`, `zone`) while giving `MatchupPitch.tsx` itself
the real pitch and zone layout. `AuthShowcase` was never touched, so those four lookups
silently resolved to `undefined` — no build error, no console warning, just a missing
`class` attribute on each div — and eleven bare `PositionBadge`s fell back to plain
block-flow, stacking in one vertical column with no pitch beneath them. The five classes
that *didn't* rename (`halfField`, `halfTopLine`, `halfTopCircle`, `halfPenaltyBox`,
`halfPenaltyArc`, `halfGoalBox`) kept working, which is what made the break look like a
layout bug rather than a naming one. Fixed by renaming the four references to match; the
zone-row's `WBZ` modifier (`zoneWBZ`) was added at the same time since the real component
carries it and the taxonomy slide had silently never had it. Confirmed via the page's own
SSR output (`curl`, no session — every referenced class now resolves to a real hashed
name); `next build` clean. **The lesson is the mirror of 5 above: a genuine import doesn't
drift, but nothing stops its source from moving out from under it — and unlike a copy, grep
for the literal class name finds every consumer, so the fix is one search away once anyone
looks.**

**6. A board is one panel, for the fourth time, and a round is one too.** The list page was
a bordered gazette banner, a floating hero card, N floating fixture cards and a floating
glance strip — up to nine elevation declarations for one gameweek, where the glance figures
are arithmetic on the fixtures directly above them. The match board was a pitch pad, two
bench slabs and a breakdown block, three of them painting `--color-bg-secondary` directly.
Both are one `.g-panel` with internal hairlines now.

The featured fixture reads as featured through **size, position and the accent rule under
your figure**, not by being the thing that floats — which is worth recording because the
first instinct was option 3, keeping the hero separate so that "featured" had a carrier.
It did not need one.

**6b. An unset lineup rendered as a void.** A club with no lineup got a bare green
rectangle several hundred pixels tall with nothing in it — absence shown is right, absence
shown as a hole is not. It carries a sentence now, in the pitch's own white at 4.82:1.

**7. The spectrum's fourth use, and its first on two squads at once.** Rationed to a panel
representing a whole squad or the whole pool; the match board carries two complete XIs plus
both benches. The *list* correctly does not get it — a set of fixtures is neither.

**8. The Gazette kept its writing and lost its newsprint.** The match report was a clipping:
a tracked serif "THE FOOTBALL GAZETTE" kicker, a 2px double rule, an italic byline and a
2.25rem accent drop cap; the list page had the same device as "ROUNDUP GAZETTE". That is
four devices introducing one paragraph, and 2.0 gives the italic/tracked serif exactly one
job — the section or card heading, which a kicker and a byline are not. Every generated
word survives. What changed is that the report is now a headline and a lead in a panel, and
the roundup is the round's standfirst on the page ground. The roles it needed already
existed: the kicker is the panel's one rationed `.g-label`, the byline is the dateline
`.g-label-quiet` was written for.

**On the copy — a label NAMES a thing, it does not NARRATE one.**

The breakdown shipped labelled "How the score was built", which Duke called out as corny.
It was: the 1.0 name was "Player Points Breakdown", and the port replaced a label that
names with one that narrates. That is the whole distinction, and it is worth having because
the app has plenty of both and the good kind is not "plain" — it is football's own
vocabulary. **"Under the hammer", "Gone this week", "On the board", "Standing bid",
"Release clause", "The bidding"** all name things and all carry voice. **"How the board
will read him", "Where it stands", "When everything closes", "Who comes off"** describe
what a region is *for*, in a sentence, which is how a thing sounds when it is explaining
itself rather than being itself.

Swept 2026-08-12, across the app rather than this port:

| was | now | where |
|---|---|---|
| How the score was built | Points breakdown | `MatchupPitch` |
| Elsewhere in the round | Other fixtures | `matchups` |
| Read the detail / Hide the detail | Show more / Show less | `MatchReportCard` |
| How the board will read him | Board preview | `ListingEditor` |
| What you're after | In return | `ListingEditor` |
| Where it stands | The bidding | `AuctionsClient` |
| When everything closes | Deadlines | `MarketClient` |
| Who comes off | Player to drop | `BidDialog` |
| Would loan out | Open to loans | `ListingsClient` |

**Three things were deliberately NOT swept**, because the rule is about labels and these
are not labels:

- **Empty states are sentences and should stay sentences.** "Nothing is under the hammer
  right now", "Nothing has moved yet this season", "Nothing needs you". A region with no
  content has nothing to name.
- **Captions under a figure explain what the figure means**, which is prose doing its job:
  "Committed if you win", "Free after that", "Priced off his form and the length",
  "Reverts to you free if he returns".
- **`trades/` is legacy** and out of the nav ("Click to offer" / "Click to request" live
  there). Editing copy in dead code is noise.

"Board preview" rather than the more idiomatic "On the board" because that exact string
already means *the number of players currently listed* in `MarketClient` — same words, two
meanings, one section apart.

### Capitalisation: sentence case, and the exceptions are a list

**Swept 2026-08-12**, app-wide, in one pass. The house style was asserted before it was
measured, so it got measured: on the ported 2.0 surfaces, counting only multi-word labels
that render *as written*, it was **93 sentence case against 14 Title Case** — 87%. Sentence
case is the style. It is now 100 against 7, and those seven are all deliberate.

**Two things made the audit non-obvious, and both are worth reusing.**

- **Most Title Case in the source is invisible.** 300-odd classes carry
  `text-transform: uppercase`, so the casing a developer typed never reaches the screen.
  Auditing the strings alone would have produced a long list of changes with no visual
  effect and missed the ones that matter. The audit resolves each label's class against the
  set of uppercasing selectors first, and only then judges the text.
- **A capitalised word is not automatically wrong.** The exceptions are the product's own
  defined vocabulary, and `docs/USER_GUIDE.md` is the authority: it capitalises **Retained
  List**, **Injured Reserve** and **Academy**, and CLAUDE.md mandates **Club Balance**. The
  named rooms of the Market keep theirs too — **Free Agency**, and the four
  "Transfer Market → …" breadcrumbs, which are route names rather than descriptions. Those
  seven survivors are exactly that list.

Changed on **23 files**: `Age Profile`→`Age profile`, `Club File`/`Player File`→`… file`,
`Depth Chart`→`Depth chart`, `Fieldable Formations`, `Scoring Contribution`, `Pos Rank`,
`Club Ledger`, `Spending Breakdown`, `Club Credentials`, `Commissioner Controls`,
`Club Registrations`, `League Lobby`, `Direct Messages`, `Draft Order`, `Your Clubs`,
`Your Pick`, `Squad Age`/`Squad Value`/`Points For`, `All Positions`,
`Wide Defenders (…)`, `All Played Games (…)`, `Starter Games (…)`,
`Auction Draft (Waivers Only)`, the seven CrestBuilder swatch labels, and
`The History Books Are Empty`.

**Deliberately out of scope:** `privacy` and `terms` (legal headings are conventionally
Title Case), `admin/*` (never faces a manager), and `trades/` (legacy, out of the nav).

**Found, not fixed, because it is a naming defect rather than a casing one:** the league
chat is called **"League lobby chat"** in `SidebarChat`, **"League chat lobby"** in
`ChatNavIcon`'s tooltip, and **"League lobby"** in `PreDraftLobby` — three names for one
feature. Both were sentence-cased and neither was renamed; picking the name is a separate
decision.

**Two things found in passing, both app-wide rather than this page's:**

- **`.playercard-clickable-btn:hover` painted `--color-accent-green`** — the *fill* token as
  text, **4.33:1 in dark**, in a class every narrative surface renders. Rule 5 from the
  auctions port, still live a day after the dialogs port fixed six other instances of it.
  It is `--color-accent-ink` now; in light the two tokens are the same value, so this
  changes nothing there and fixes dark.
- **`renderBoldedText` emits a `<strong>` or a `<button class="playercard-clickable-btn">`**
  depending only on whether the bolded phrase resolved to a player id — and that button is
  `color: inherit`. So the same emphasis rendered in two different tones on the same line,
  keyed on a distinction the reader cannot act on. Any surface styling `strong` inside
  generated prose has to style both.

### The crest bug: a duplicated query that silently disagreed

**The single most valuable thing this port found, and it is not a design defect at all.**
Duke's report was "team crests don't even display properly" — every club on the matchups
list was rendering the generic green fallback shield instead of its own crest, while the
matchup DETAIL page next door showed them correctly.

`matchups/page.tsx` fetched its matchups twice: an initial select carrying `crest_config`,
and a post-sync re-fetch that did not — and the re-fetch **overwrites** the first result.
So `CrestBadge` received `config: undefined` for all twelve clubs and fell through to its
designed no-config state.

Three things make this worth recording rather than just fixing:

- **It fires under one specific condition, and it is the worst one.** The re-fetch is gated
  on `needsSync`, which is true when the current gameweek is still 0-0 — i.e. every live
  gameweek from kickoff until the first points land, which is exactly when managers are on
  this page. Outside that window the crests are correct, which is why it survived.
- **Nothing fails.** No error, no console warning, no missing element. The fallback crest is
  a *real designed state*, so the page looks entirely intentional while showing the wrong
  club identity for every club on it. This is the failure mode a good empty state buys you,
  and the reason a designed fallback needs its trigger checked as carefully as its look.
- **It is the duplicated-rule defect in a query.** Same shape as `ListingCard`'s crest, the
  club page's position badge, `MatchupPitch`'s SLOT_COLOR map and `DRAW_THRESHOLD` — but in
  a `.select()` string, where none of the usual tells apply: no component to compare, no
  constant to grep, and the two copies sit 40 lines apart in one file. The select is
  `MATCHUP_SELECT`, declared once, now.

**The general rule: a duplicated query does not drift, it silently disagrees.** Worth a
grep on any surface whose data is re-fetched after a mutation — the second query is the one
written in a hurry, and a dropped join column degrades to a plausible-looking default rather
than to an error. (Checked app-wide during this port: every other `teams!` join missing
`crest_config` feeds a name-only surface that renders no crest.)

### What only showed up on screen

Every number in this port passed before anyone looked at it: build green, 148 pairs green,
palette green. Duke looked and the surface was wrong. **Four defects, none of which a
contrast verifier can see**, and the pattern is worth naming — a colour checker proves that
ink is legible on its ground, and says nothing about whether the thing exists, has a size,
or fits its container.

**1. The margin axis was never given its track.** `.g-axis` shipped with
`background: rgba(0,0,0,0)` and `box-shadow: none` — an invisible 574px strip with a 115px
band floating in the middle of nothing. The band read as a stray grey lozenge because there
was no scale for it to be a zone *of*. `globals.css` § "6. Recessed tracks" literally names
"a margin axis" as the thing `.g-track` was written for, and the component did not apply it.
**The spec named the class and the port still did not use it**, because "recessed" reads as
a finish rather than as load-bearing.

**2. `width: 100%` alongside a margin is an overflow.** `.board` had both, so it ran 48px
wider than its container, pushed the second half-pitch off-screen and gave the page a
horizontal scrollbar. The half then had the *page* width to satisfy `aspect-ratio: 0.78`
with, which is what rendered the grass as a slab nearly 1000px tall. One declaration, three
symptoms, and every one of them looks like a design failure rather than a box-model one.

**3. A crest below ~28px is not a crest.** (Separate from the crest BUG above — this is
about size, that was about identity; both were live at once, which is why the row crests
read as meaningless green blobs.) The shield is a 100×120 viewBox with its initials
at `font-size: 26px`, so at the 20px used in a fixture row the lettering lands at about 5px
— an illegible green blob. The port had actually made them *smaller* than 1.0 (36→30 in the
hero, 22→20 in rows) while removing the W/L/D badges, so the surface lost its last colour
twice over. They are 44px in a scoreline and 28px in a row now. **Crests are where a
football page keeps its colour**, and they earn the size the same way the portrait's crest
chip earns its exception: real club identity art, not a status pill.

**4. Deleting a device is not the same as replacing it.** Six removals were each defensible
by a rule — the gazette banner, the W/L/D squares, the hero card's elevation, the filled
score badges, the bench category hues, the position-hue bar in the breakdown. The *sum* was
a page with no colour, no rules between rows and nothing tying one fixture to the next.
Three things brought the structure back without reintroducing anything the law forbids:
hairlines between fixture rows (a results list is a list), a rule under the section head,
and the club record moved from an orphaned line into the identity block beside the crest.

**5. A scoreline needs a measure.** Full-bleed on a 1184px panel, the two figures fly to
opposite ends and 600px of nothing sits between them — the hollow middle Duke read as "so
much white space". The round's content is capped at **920px and centred**, sections still
full-bleed so hairlines and hovers run edge to edge. It is what makes the scoreline read as
two sides facing each other across a centre, which is the only reason it has a middle.

**The process lesson, stated plainly:** these ports have been verified by measurement and
by build, and both were green on a page with an invisible component, a horizontal
scrollbar, illegible crests and the wrong club identity on every row. **Measurement checks
the pairs you thought to write down; a build checks that the code runs.** Neither can see
a component that renders nothing, a box that overflows, art that is too small to read, or
correct code fetching incomplete data. Every port from here ends by opening the page.

### The draw band is now one constant

`DRAW_THRESHOLD = 10` was written **seven times**: a local `const` inside
`matchupProcessor`, a `DRAW_BAND` in `buildHomeModel` whose comment already said *"Mirrors
DRAW_THRESHOLD"* (which is the tell), and bare `<= 10` literals in the matchups list, the
matchup detail, `LiveMatchupCard` and `matchReport`. The margin axis needed an eighth.

It is `src/lib/scoring/drawBand.ts` now — the same move the stats pool made when the
spectrum's second consumer would have been a second copy of the twelve hues. **The SQL side
is deliberately not covered**: `league_standings` encodes the same 10 in its own `CASE`, and
only a migration can reach a view, so changing the band still means changing two things.
That is written at the top of the file rather than left to be discovered.

## What standings established (2026-08-15)

`standings` alone — `history` and `finance` are still open. `standings.module.css` ends at
**0 raw hex, 0 rem literals, 0 1.0 scale tokens, 0 radius literals**, and **49 measured
colour pairs pass in both themes** (46 in `scratch/verify_standings.mjs`, 3 more — the form
dots — in `scratch/solve_defeat_dark.mjs`, where they sit beside the derivation that made
one of them legal).

**1. The podium and the table are a board, for the fifth time.** 1.0 had three podium tiles
each with their own border and shadow, floating above a separately-elevated table section —
four elevation declarations for one composition, where the podium is arithmetic on the
table's own first three rows (exactly the auction room's rail, one page later in the port
order). Now one `.g-panel` with an internal hairline. The leader tile reads as featured
through size (taller padding, larger type), position (centre of the 2nd | 1st | 3rd order)
and the medal ramp painted onto the trophy icon itself — never a second surface.

**2. Green is the win colour for the form dots — a third named colour-law exception,
Duke's call.** The law's own table only recorded two ("the winger sage, and the performance
ramp"); this is the first one made mid-port rather than inherited. Duke's reasoning: green
reading as "win" is closer to a sports-universal convention than to a Gaffa-specific rule,
and the law was "a bit overblown" here. Recorded with its cost, the same way the other two
are.

The cost turned out smaller than it looked. The risk was green-on-green: the "own row" wash
is 12% accent, so a win dot in your own recent form paints solid accent over an
already-green-tinted row. Measured as a graphical mark against WCAG 1.4.11's 3:1 floor (a
filled 8px dot is not a text-contrast case) rather than the 4.5 text floor, every combination
clears — dark win-on-wash is the tightest at 3.72. Draw takes `--color-warning-text` and loss
takes `--color-defeat`, both already-established "a dot takes the legible value, not the fill
value" moves from the squad-page port's doubt indicator.

**3. `--color-defeat` had never had a dark value**, one value serving both themes since it
was introduced — exactly the pattern the matchups port named as the reliable predictor of a
dark-mode failure, measured here at **1.89:1** on a dark card. Solved to 4.8 holding hue and
chroma, the same method as every other ramp in this file: **`#EA747B`**, now in `globals.css`
and cleared for its first real consumer, the loss dot.

**4. A washed row lifts EVERY muted slot, not just the ones that were already being
watched.** Rule 1 from the auctions port says a tinted ground carries primary and secondary
ink only; porting it here the first time, the rank number was left on a hardcoded
`--color-text-muted` while the manager cell correctly took `--row-ink`. `verify_standings.mjs`
caught it at **4.34** in dark, just under the floor — the rank cell now takes `--row-ink` too.
Worth naming because it is a narrower version of the duplicated-rule defect: not a second copy
of a whole rule, but one cell inside a single component that didn't get the memo the cell next
to it did.

**5. A ninth copy of the draw-band constant.** The matchups-port sweep found and collapsed
seven, plus an eighth for the margin axis, and missed this file because it computes a form
result (W/D/L) rather than drawing a scoreline — a different shape of the same 10, easy to
miss when grepping for `<= 10` near a score. It now imports `isDrawMargin` from
`src/lib/scoring/drawBand.ts`.

**6. The squad-peek trigger finally stopped restating `SquadPeekButton`'s press treatment.**
Named in "What the dialogs added" as still owed after `ListingCard`'s copy was found stale and
geometrically broken (its `border-radius: 50%` rendered as an ellipse once the row grew). This
page's copy was still in sync — nothing was visibly wrong — but "in sync today" is exactly the
state that precedes drift, so it is deleted rather than left as the one remaining place a
crest's hover has to be kept in agreement by hand.

**Also found and removed, unreferenced:** `.podiumEmoji` and `.podiumCardLeader .podiumEmoji`
(a leftover from an emoji treatment the trophy `Icon` had already replaced), and `.gdPos` /
`.gdNeg` (goal-difference cell styling for a column the table has never rendered — `gd` is
computed in the row data and was never wired to a `<td>`).

## What history and finance established (2026-08-15)

The rest of port 6, done the same day as standings. Both stylesheets end at **0 raw hex, 0
rem literals, 0 1.0 scale tokens, 0 radius literals**, and **86 measured colour pairs pass in
both themes** (`scratch/verify_history_finance.mjs`).

**1. The same podium grammar, reused rather than reinvented.** History's per-season podium
had the identical defect standings' did — three tiles each carrying their own border and
shadow, nested inside the season's own already-elevated card — so it takes the same fix:
tiers of one panel, told apart by a hairline. Left-to-right rank order stayed as it was
(not standings' 2nd | 1st | 3rd "stage" order); reordering a repeated historical record is a
product decision this port doesn't make on its own. **No colour-law exception was needed
here.** The medal ramp already exists for exactly this job, and unlike standings' form dots
this page never has an "own row" for green to collide with — nothing on it is scoped to the
viewing manager, so the ramp's ordinary "thin ring/text, never a fill" rule was enough.
Reused a second time on this page, for named cups: Champions Cup takes gold, League Cup
silver, Consolation Cup bronze — the tier the trophy already means, not a fourth hue.

**2. A finance page scoped to one manager makes green-for-earned NOT an exception.**
Worth stating plainly because standings' form dots and this page's summary strip look like
the same move and are not. `finance/page.tsx` queries one team's transactions start to
finish; every green figure on this page genuinely IS "yours" in the sense the law already
grants. So `--color-accent-green` (a 1.0 token, same value as 2.0's `--color-accent`) simply
becomes `--color-accent-ink` for text and `--color-accent` for fills — a retoken, not a
third exception layered on the second.

**3. A ten-category bar chart has nowhere near enough hues, and the map covering it was
already silently wrong.** The spending breakdown coloured each category by a hand-picked
hex, but `TX_META` defines ten real categories and the map only ever had seven — Recirculation,
Revenue, Sales and Loans fell through to a flat `--color-text-muted`, unnoticed because a
grey bar still looks like a bar. Even fixed, ten hues is twice what the Wire's five event
kinds already found no room for (README, "What finishing the hub established"). The category
name is already the row's own label, so colour was never doing identification work — it now
carries each row's own spent/earned split instead (`--color-danger` / `--color-accent`,
the same split as everything else on the page), two segments inside one `.g-track`. A row's
overall length still compares magnitude across categories; the fill now also shows
composition, which the flat colour never did.

**4. Three separately-elevated cards for one transaction list, collapsed to one panel.**
Finance's summary strip, category breakdown and ledger table are all arithmetic on the exact
same array — `totalSpent`/`totalEarned` and the per-category splits are computed from the
same `transactions` prop the ledger rows render — so it is the "board is one panel" rule
applied to three stacked sections instead of a list-plus-rail. One `.g-panel`, internal
hairlines between the three, elevation declared once for the whole ledger rather than three
times for one list.

**5. The redundant eyebrow-above-a-heading pattern, twice more.** Both pages' `sectionKicker`
("BY CATEGORY", "ALL TRANSACTIONS") sat above a `sectionTitle` that already said the same
thing in words ("Spending breakdown", "Club ledger") — exactly the case the matchups port's
copy sweep named for deletion: "a label sitting above a heading is deleted (the heading
carries its own weight)". Both kickers are gone; the headings carry it alone. The `eyebrow`
composing `ds-eyebrow-serif` in both pages' old masthead is the same defect one level up —
1.0's eyebrow roles are deliberately absent from 2.0 (see "Not done yet") — and both mastheads
now use the established `g-label` kicker instead. History's `seasonBadge`, an italicised serif
season year sitting beside a title that already said "Season 2025-26", was the same pattern a
third time and is deleted outright rather than restyled — it is also the one place this port
touched the italic serif accent, which 2.0 gives exactly one job (the section/card heading)
and this badge was not one.

**6. The filter tabs and the position filter are the same control**, so finance's pill-shaped
tabs are now literally `stats.module.css`'s `.segmented`/`.segment`/`.segmentOn` grammar:
filled in ink on selection, not the accent — a view toggle, not "yours" — which is also the
fix for a real dark-mode number: the 1.0 version's active tab used a raw
`box-shadow: 0 1px 3px rgba(0,0,0,.08)` that did nothing on Gaffa's own dark card.

Nothing else surfaced worth a numbered lesson — both ports were exactly what the port order
predicted: table-heavy, mostly typographic, low risk.

## What the draft room established (2026-08-15)

`draft` — the final route, and the one the port order deliberately deferred: largest and
most literal-ridden stylesheet in the app (1,519 lines) and dormant between seasons, since
the draft happens exactly once per league, ever (docs/USER_GUIDE.md), so it was cheap to
defer and never urgent. `draft.module.css` ends at **0 raw hex, 0 rem literals, 0 1.0 scale
tokens**, and **106 measured colour pairs pass in both themes**
(`scratch/verify_draft.mjs`). Structural dimensions — the 540px sidebar, the 220px sticky
player column, the 60px stat columns, the 68px pick-cell height — stayed in px un-tokenised,
the same call the dialogs port made for `ProposeBuilder`'s own column tracks: a control's own
dimension is not a spacing value.

**1. A fourth hand-rolled position badge, and the first one missing a whole axis of the
spine rather than just drifting from it.** The draft room built its own from a local
`.posBadge` + twelve-entry colour map, and — like `ListingCard`'s crest, the club page's own
badge, and `MatchupPitch`'s `SLOT_COLOR` map before it — put LB and RB on one shared token
and LWB and RWB on another. Every earlier occurrence at least drew *some* badge for the pair;
this one drew the identical badge, full stop, because the hand-rolled version never
implemented the clipped corner at all — the side was carried by nothing. Four call sites
(the scouting table's row, the board's picked-cell, the roster list, the queue list) now
render `<PositionBadge size="sm">`, and each name row that sits beside one takes
`.g-namerow`, the same optical-lift primitive the stats pool's rows use. "A component copied
rather than imported does not drift, it becomes wrong" (the round's own finding) — four
occurrences in is where that stops being a coincidence and starts being the reliable
prediction for any page that pre-dates the shared component.

**2. `--color-text-inverse` on an accent fill is rule 5, a seventh time**, and the most
repeated single defect in this file: six declarations across the banner's complete-CTA, the
on-the-clock clock block and the draft/queue-draft buttons. `--color-text-inverse` is not
white in dark — it's `#EDEAE2`, close to `--color-text-primary` — so every one of those
controls read at roughly the fill-token bug's usual ~2.5:1 in dark. All six are
`--color-on-accent` now, the token actually built for a label sitting on the fill, which
inverts by theme because dark's accent is the brighter colour.

**3. Three more view toggles move from the accent fill to ink**, extending the stats pool's
rule (`.segment`/`.segmentOn`, "a view toggle, not 'yours'") to the position filter row, the
role-matching toggle (Primary/Secondary/Both) and the roster sort toggle (By draft
pick/By position). None of the three says anything about which club is yours, and the roster
toggle's active state was also carrying an inline `box-shadow: 0 1px 3px rgba(0,0,0,.1)` —
elevation on a chip that never floats, dropped along with the accent fill.

**4. A tag that fails as text in BOTH themes, not just the usual dark-only case.**
`--color-accent-purple`, used for the "new to the Premier League" tag, has exactly one value
for both themes — 3.86:1 in light, 3.56 in dark, both under the 4.5 floor. Every other
single-value token this project has found (`--color-defeat`, `--color-accent-purple`'s own
neighbours) failed only in dark, because dark inks generally start with less headroom; this
one failed everywhere, which is what a colour with no verified pairing at all looks like.
A twelfth hue for one draft-only tag was never going to clear the law's "no free hues"
constraint regardless (the Wire's five event kinds already found none for fewer, README "What
finishing the hub established"), and the word already says "new" — the hub port's rule
applies directly: where the element carries a word, delete the hue and do not replace it. It
is a plain ink chip now, told apart by a dashed keyline in `--color-text-muted` — not
`--color-border-strong`, which was solved against the *page* and measures 2.91/2.87 against
this chip's `--color-bg-elevated` ground, under the graphical 3:1 floor. The same lesson the
margin axis's band edges hit one port ago: a token verified on one ground does not clear on
another.

**5. Two more `pickCellFilled`/`myTeamCell` hover states moved to darken-only**, the
matchups port's rule (`--color-bg-inset`, never `--color-bg-card-hover`, which lightens in
dark and spends the headroom every ink on the cell was verified with) — the board's pick
cells and the scouting table's player rows both had it.

**Found and removed, unreferenced:** `.playerRowRight` / `.playerPpg`, a leftover from an
earlier row layout that showed PPG inline; the current row renders points, PPG, rating and
value as their own stat columns, and nothing had imported these two classes since before that
layout existed.

**With this, all fifteen dashboard routes design-2.0 set out to cover are on 2.0.** Only
`trades` (legacy, out of the nav, kept alive solely because `AuthShowcase.tsx` imports
`TradeCard` for the login carousel) and `admin/*` (no manager ever sees it) remain on 1.0,
both by deliberate exclusion rather than by being left over.

## Port order for the remaining routes

**Order by adjacency first, then by how much a surface exercises the system.** The first
version of this list ranked purely on component coverage, which put `transfers/deals` at
the bottom as "redesigned recently and not urgent" — and that was wrong, for a reason worth
keeping. `transfers` is not five related pages; it is **one hub with four rooms**, and
`MarketClient` is a doorway that links straight into all of them. Porting the auction room
alone put a 2.0 page in the middle of four 1.0 ones, so a manager crossed the seam twice in
two clicks without leaving the section. A seam between distant sections is a blemish; a
seam inside one section is a bug. `free-agents` and `listings` were not on the list at all.

**Every route is on 2.0.** Fifteen surfaces (League Home, the whole Market hub, the two
squad pages — which is three routes, because `clubs/[teamId]` renders the club page too —
the stats pool, both matchups routes, standings, history, finance, and draft). `trades` and
`admin/*` are the only dashboard pages still on 1.0, and both are deliberate: legacy/no
manager ever sees them — see below.

1. ~~**`transfers/auctions`**~~ — **done 2026-08-11.** Exercised the portrait at both row
   and lot size, the countdown (mono), `--color-live`, the panel, the condensed face and the
   row tint. Ended at 0 raw hex, 0 rem literals, 0 1.0 scale tokens, 136 2.0 token uses.
2. ~~**The rest of the Market hub**~~ — **done 2026-08-11.** `transfers`,
   `transfers/listings`, `transfers/free-agents`, `transfers/deals`, `TransfersSubNav`,
   `ListingCard`. See "What finishing the hub established" below.
3. ~~**`team` + `team/roster`**~~ — **done 2026-08-11.** The pitch and the squad. Cleared
   the biggest raw-hex debt in the app (`pitch.module.css`, 101 literals and 38 rem
   font-sizes), added `--color-pitch*` to the palette, and put the spectrum on a page for
   the first time. `clubs/[teamId]` came with it. See "What the squad pages established"
   above. (`ListingEditor` is shared with this route and was already ported with the
   dialogs.)
4. ~~**`players` / `stats`**~~ — **done 2026-08-12.** `stats` (the pool) plus the player
   card. `players` was **deleted, not ported**: it was the pre-hub transfer market, out of
   the nav with zero inbound links, superseded wholesale by `transfers/auctions` and
   `transfers/free-agents`. See "What the stats pool established" and "What the player card
   established" below. **The baseline rule still has no home in the app** — see "Not done
   yet".
5. ~~**`matchups` + `matchups/[id]`**~~ — **done 2026-08-12.** The scoreline treatment
   from turn 1, rendered for the first time, plus the margin axis it had been waiting
   for and `MatchupPitch`. See "What the round established" below.
6. ~~**`standings`, `history`, `finance`**~~ — **done 2026-08-15.** `standings` merged the
   podium and the full table into one `.g-panel`, a third colour-law exception (green as the
   form-dot win colour, Duke's call), and `--color-defeat`'s first-ever dark value.
   `history` reused that exact podium grammar per season; `finance` collapsed three
   separately-elevated cards (summary, breakdown, ledger) into one panel and replaced an
   uncolourable ten-category bar chart with a spent/earned split. See "What standings
   established" and "What history and finance established" below.
7. ~~**`draft`**~~ — **done 2026-08-15. The final route.** Position badges moved to the
   shared `<PositionBadge>` component (a fourth occurrence of the hand-rolled-badge defect,
   this time missing the LB/RB and LWB/RWB clipped corners entirely), `--color-text-inverse`
   on an accent fill came off six controls, three view toggles moved from the accent fill to
   ink, and a colour-illegible-in-both-themes "NEW" tag lost its purple. See "What the draft
   room established" below.

The `transfers/` **dialogs** — `Modal`, `BidDialog`, `ListingEditor`, `ProposeBuilder` —
followed the surfaces on 2026-08-11. See "What the dialogs added" below. The section is now
wholly on 2.0: **0 raw hex across all 11 of its stylesheets**, and no `rem` literal of any
kind left in the four dialogs.

**`trades` is legacy and will never be ported.** It is out of the nav and nothing links to
it; it survives only because `src/components/auth/AuthShowcase.tsx` imports `TradeCard`
from it for the public login carousel. `admin/*` never faces a manager.

## Not done yet

- **0 dashboard routes left on 1.0** (`players` is gone, not ported; `standings`, `history`,
  `finance` and `draft` all came off 2026-08-15). `trades` and `admin/*` stay on 1.0
  deliberately — see "What the draft room established". **19** stylesheets still hold raw
  hex outside comments (was 21, 25, and 38 before the hub) — `draft.module.css` was never one
  of them, all of its colour already ran through tokens before this port touched it. Two of
  the remaining are in `components/players/`: `PremiumPlayerCard.module.css`, whose only hex
  is the six `--rating-*` declarations themselves — those ARE the token definitions — and
  `PlayerCard.module.css`, the small hover-preview card, which was not in port 4's scope and
  still carries 18. The rest sit in pages this project never targeted at all — `admin/*`,
  `trades`, `team-setup`, `activity`, `inbox`, `tournaments`, `league/create`, the top-level
  `/dashboard` leagues grid, the (auth) forms, `/share`, and shared layout chrome
  (`NotificationBell`, `ChatNavIcon`) — all still on 1.0 tokens, none of them one of the
  fifteen ported routes.

  **One of the 21 was a real regression, found sweeping the rest: `_home/home.module.css`
  (League Home, the very first port) still hand-rolled the on-accent inversion** — `.pipW`,
  `.pipL` and `.btnPrimary` set `color: #fff` and then overrode it to `#10141c` under
  `[data-theme='dark']`, the exact hand-rolled toggle `--color-on-accent` exists to replace,
  caught six times before across other ports (rule 5, "What the first route port
  established"). `.pipL` sits on `--color-danger`, not `--color-accent`, and no `on-danger`
  token existed — `globals.css`'s own comment on `--color-danger`'s dark value had already
  flagged that gap ("any new [fill] must invert, the same move .btn-primary makes") without
  anyone closing it. **`--color-on-danger` is now a token** (`#FFFFFF` light / `#10141C`
  dark, the same inversion as `on-accent`, both measured well clear of 4.5 against danger's
  fill in either theme) and checked in `verify-palette.mjs` alongside `on-accent` /
  `on-warning` (196 pairs now, up from 194). Fixed 2026-08-17.
- **26** `font-size` declarations between 8 and 10px (was 34; the count above hadn't been
  re-measured since history/finance). Re-auditing while sweeping this and the two items
  below found the "all now sit in pages that ARE on 2.0" claim didn't hold: token-checking
  each file, only **one** (`_home/home.module.css`'s `.pip`, 9px) was actually on a
  2.0-tokenised stylesheet — **fixed 2026-08-17**, to `var(--t-10)`. The other 25 are spread
  across pages this project never targeted — `league.module.css` (shared per-league layout),
  `activity`, `trades`, `tournaments`, `AuthShowcase`, `NegotiationCard`,
  `DepartureDecisionModal`, `SquadPeek` — all still majority 1.0 tokens by an actual count,
  not per-component debt inside ported routes as previously stated.
- Radius literals decision 3 was written to kill: 2px ×30, 3px ×24, 5px ×1, 7px ×0. The
  dialogs cleared every 7px in the app and all but one 5px. **Checked 2026-08-17**, same
  audit as the font-size line above: every remaining 2px/3px literal is either on an
  unported page (`admin/*`, `trades`, `activity`, `league.module.css`, `AuthShowcase`,
  `NegotiationCard`, `DepartureDecisionModal`, `SquadPeek`, and `.ds-meter` /
  `.ds-shield` in `globals.css`, both consumed only by the unported top-level `/dashboard`
  leagues grid) or deliberately fixed-canvas geometry the README already excludes —
  `PremiumPlayerCard`'s "the geometry IS the design" literals and the pitch's penalty-arc
  radii. Zero in-scope fixes; nothing changed.
- Elevation: 177 `box-shadow` against 590 `1px solid`. The rule is now stated in
  `globals.css`; surfaces carrying both get reconciled as they are ported. **Checked
  2026-08-17** on the fifteen ported routes for the specific violation decision 1 names — a
  panel or floating element carrying BOTH a border and a shadow. Found four; fixed one.
  **`team/roster`'s `.todoPop`** (the to-do dropdown) had `border-subtle` plus `shadow-lg` —
  a floating popover is exactly "things that genuinely float," so the border is gone,
  matching `Modal.module.css`'s own `.panel` ("Elevation declared ONCE: shadow, no
  border."). The other three — `PremiumPlayerCard`'s `.injuryTip` and `.actionIconBtn`, and
  `PlayerDetailsModal`'s `.actionBtn` — are left alone: both files are under the explicit
  "Duke's call: the design does not change" lock from the player-card port (a
  token-and-contrast port only, no layout or style-law changes), so decision 1 loses to that
  lock the same way the winger sage and the performance ramp already do to the colour law.
  `next build` clean.
- ~~The dialog controls (ghost/primary buttons, error box, tracked field label) are written
  four times over~~ **Fixed 2026-08-17.** `.g-dialog-ghost` / `-go` / `-danger` / `-error` /
  `-label` in `globals.css`; `BidDialog`, `ListingEditor` and `ProposeBuilder` now `composes:
  … from global` rather than restating them (Modal itself never had a copy — it's the shell,
  the three real dialogs each redeclared this inside it). Fixing the duplication surfaced two
  live defects the drift had already produced: **`ProposeBuilder`'s error box painted its
  text `--color-danger` on `--color-danger-dim`** — 3.92:1 in dark, the exact wash-and-word
  collision the other two dialogs' own comments warn against ("the wash carries the alarm,
  so the message is ink") — and lacked the left rail the other two use as the second carrier.
  And **every `.ghost`'s border was `--color-border`**, the same 1.58/1.72:1 boundary the
  input/select sweep found — a button is a control too, so it now takes
  `--color-border-strong` like the rest. Three small layout deltas fell out along the way:
  ListingEditor's footer buttons move from `--s4` to `--s5` padding and ProposeBuilder's from
  `--t-11` to `--t-12` type, both now matching the other two rather than each dialog's own
  guess. `verify-palette.mjs` unaffected (196/196, no new tokens); `next build` clean.
- The 1.0 eyebrow roles are deliberately absent from 2.0 — 34 call sites across
  `ds-eyebrow` (12), `ds-eyebrow-serif` (7) and `ds-label` (15). Mapping: a genuine
  dateline or metadata line keeps `ds-label`; a label sitting above a heading is deleted
  (the heading carries its own weight); everything else becomes `t-heading`. **Checked
  2026-08-17**: all 34 sites are in `admin/offseason`, the top-level `/dashboard` (`LeagueGrid`,
  `dashboard.module.css`), `activity`, `chat/Chat.module.css`, the mock draft room,
  `league.module.css` and `preDraftLobby.module.css` — none of the fifteen ported routes use
  any of the three classes. Zero in-scope fixes; nothing changed.
- **The baseline rule is still rendered by nothing.** Port 4 was meant to be where it
  became real; the card was its intended home, and the card's design is staying as it is
  (see above), so it did not land. Two prototype revisions exploring a home for it are in
  the design project as `Gaffa 2.0 Player Card.dc.html` (rev 2 in the file, rev 1 in its
  history) — both rejected, and the second one's argument, that a football card's front
  already has an attribute block and the six weighted components *are* those attributes, is
  worth keeping if the question reopens. `scratch/season_baseline_breakdown.mjs` produces
  real season-averaged breakdowns straight out of `matchRating.ts` for any future attempt.
  Candidate homes not yet tried: the match report, `matchups/[id]` (port 5), or a row
  expansion on the stats pool.

  **Port 5 looked at `matchups/[id]` and did not do it, and the reason is a data problem
  rather than a design one — which is the useful finding.** The rule needs
  `MatchRating.breakdown`, and **nothing stores it**: there is no `rating_breakdown` column
  on `player_stats`, so rendering it means re-running `calculateMatchRating()` on the stored
  `stats` JSON at read time. That page deliberately does not do that — the JSON can carry
  zeroed BPS/ICT when the sync ran before FPL finalised bonus, which is exactly why the
  authoritative value is the `fantasy_points` *column*. And `calculateMatchRating()` returns
  `breakdown` and `fantasyPoints` from the same pass, so a stale JSON gives you six
  components explaining a total the page is not showing. That is not a crash, it is the
  quiet kind: **a second derivation of a number an authoritative column already holds**,
  which is the same defect shape as every duplicated rule catalogued above.

  **The unblocker is not a design decision.** Store the breakdown at sync time — a
  `rating_breakdown` column written by the pass that already computes `fantasy_points` —
  and the rule becomes a lookup that cannot disagree with the figure beside it, on every
  candidate surface at once. One migration plus a change to the stats writer. Until then
  the component is correct and homeless for a reason, and building it on a re-derivation
  would be spending the signature component to hide a data gap.
- ~~Every `input` and `select` on every ported surface draws its boundary in
  `--color-border`~~ **Fixed 2026-08-17.** `--color-border` measured **1.58:1 light, 1.72:1
  dark** against WCAG 1.4.11's 3:1 for a control boundary. Nine rules across seven
  stylesheets — `transfers/listings`, `transfers/free-agents`, `team/roster` (`.tbSelect`,
  which was on the even weaker `--color-border-subtle`), `stats`, and the three dialogs
  (`BidDialog`, `ProposeBuilder` — `.message` and `.pickerSearch`, the latter also on
  `-subtle`, `ListingEditor`) — moved to `--color-border-strong`, which clears the floor at
  **3.20:1**, the tightest pair in the palette but a real pass. `draft.module.css`'s
  `.filterSelect` already used `-strong`; `ProposeBuilder`'s borderless underline fields
  (`.cashInline`, `ListingEditor`'s `.priceInput`) and the type=range sliders carry no
  boundary and needed nothing. Left alone deliberately: `trades/`, `admin/*`,
  `team-setup`, `PreDraftLobby`, the mock draft room, and the (auth) forms — all still on
  1.0 tokens, frozen by the scale policy above, not part of this pass.
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
- ~~The login carousel says "one of 7 supported formations"; the real number is 10.~~
  **Fixed 2026-08-17**, `AuthShowcase.tsx`.
