# Handoff — the performance block + rare-feat rework, 2026-08-25

**Branch:** `perf-block-preview` (not merged, not pushed). `main` is untouched
by this work.
**Build:** `npm run build` passes. 273/273 tests pass. Typecheck clean apart
from two pre-existing errors in `slotAppearance.test.ts` that predate all of it.
**Preview:** `next start` on port 3005 — `/share/stats`, click a player →
GAME LOG → click the scoring row. Port 3000 belongs to another session; leave it.

---

## 1. What this is

A component that explains a player's match without publishing the scoring
model. Four display groups (three for a keeper) over the engine's eight
components, **banded rather than numbered**, with public raw stats as evidence.

The reasoning behind every design decision — grouping, banding, the colour
ramp, the mobile ladder — lives in the Claude Design prototype
**"Gaffa 2.0 Performance Block"** in the *Gaffa 2.0 — Design System* project.
Read it before changing any of it; it records what was measured and rejected,
not just what shipped.

### The disclosure rule everything rests on

Gaffa's weights are calibrated, not derived. Publishing per-component scores
next to the public FPL inputs that produced them would let anyone fit the
sigmoid and then solve the weights. So:

- the wire format is **bands, never scores** — banding happens server-side in
  `cardData.ts`, and the composite never enters the payload;
- the bar geometry is **quantised to the band** — a continuous width is the
  score, in the DOM, at full precision;
- groups are ordered **fixed per position**, never by contribution, because
  contribution order publishes the weight order;
- the flex component is **never marked**.

These are written into the header of `src/lib/scoring/perfBand.ts`. They are
easy to undo by accident.

---

## 2. Engine change — SHIPPED on the branch

`docs/superpowers/specs/2026-08-25-rare-feat-bonus-design.md` has the full
argument and the measurements. Summary:

The rare-feat bonus used to bump the **composite**, consuming headroom toward
1.0. Composite 1.0 maps to 44.69 points, so it could never separate the games
it existed to separate — a hat-trick paid 42.47 and a 5G+2A game 44.58, 2.9
points apart. It also paid a *bigger* bonus to a *worse* supporting performance
(+7.24 off a 0.84 composite vs +2.90 off a 0.94 one).

Now: `points = curve(composite) + 3.0 × excess`, added after the curve. Feat
range spreads from 2.89 points to 11.00. A hat-trick pays +3.25, inside the
"3 to 5 extra points" `docs/USER_GUIDE.md` already publishes. The display
rating no longer receives the bonus at all.

Creativity's trigger moved from a **positional z-score of 3.9** to an
**absolute raw creativity bar of 90**. The z-score was measuring positional
baseline, not creative quality: clearing it needed raw 94.1 as an AM, 26.1 as a
CB, 8.2 as a GK — so 54 of 96 firings in 2025-26 were keepers and centre-backs,
against 13 for all four playmaking positions combined. At raw ≥ 90 it fires 11
times a season, zero of them defenders.

**Constants** (`matchRating.ts`): `FEAT_POINTS_PER_UNIT = 3.0`,
`FEAT_GI_SATURATION_RAW = 11.5`, `FEAT_GI_UNIT = 6`,
`FEAT_CREATIVITY_RAW = 90`, `FEAT_CREATIVITY_UNIT = 15`.

**A spec recommendation was wrong and the tests caught it.** The spec said to
delete the `posWeights.creativity > 0` gate. Doing so turned the golden suite
red on *"never triggers the creativity rare-feat kicker for a goalkeeper"*, and
the test was right: "a component weighted 0.00 for a position must never move
that position's score" is structural, and resting it on "the data says it can't
happen" is weaker than resting it on "the code says it can't". **Both gates
stay.** §8 of the spec records the correction.

**NOT DONE, deliberately, per Duke:** no backfill, no
`recompute_reference_stats.mjs`, no `backfill-scoring-v2.mjs`. Completed history
keeps its old scores. This joins the queue the 2026-08-24 curve retune is
already waiting in.

---

## 3. UI — built on the branch

**New files**
- `src/lib/scoring/perfBand.ts` — bands, group maps, band cuts, evidence prose,
  and the disclosure rules as comments.
- `src/components/players/PerformanceBlock.tsx` / `.module.css` — the component.
  **The app's first container queries** (`container-type: inline-size`).

**Wired into**
- `src/lib/players/cardData.ts` — computes the banded groups **server-side**,
  per gamelog row, in `attachPositionScores`.
- `src/lib/players/cardCache.ts` — `CardGamelogEntry.perf`.
- `src/components/players/PremiumPlayerCard.tsx` — a game-log row opens as an
  accordion (one at a time) and renders the block.

### The mobile rule

**The ladder trades height, never content.** An early draft dropped the
evidence line below 380px. Measured in the live app, **the card back is 312px
wide** — so that draft would have shown the evidence line *never*, in the only
place the block currently lives. Narrow stacks to three lines and keeps
everything.

```
< 200px   the signature — one quantised bar per group
< 380px   stacked: label+verdict / bar / evidence
< 560px   one line, evidence beneath
wider     + the rank anchor
```

---

## 4. Two bugs only the real page exposed

**`key_passes` is dead data.** Present on every row, ZERO on every row — all
14,521 in 2025-26 and 609 in 2026-27. FPL's element-summary never fills it. The
first Creating evidence line read it, so every player at every band rendered
*"MASTERFUL — No chances created."* Rewritten onto assists + xA. The header of
`evidenceFor` lists what IS populated; check against the table before adding a
field.

*Still open:* `MatchupPitch.fmtStats` reads the same dead field for its CMZ/AMZ
chips, so those chips have a KP branch that can never fire. Pre-existing, not
fixed here.

**Band saturation — Duke found this from the live page.** Fixed cuts at
34/44/55/69 do not survive contact with the data, because the scores are
sigmoids centred on a positional median: the mass piles up at 0.5. Measured
under the old cuts, `attacking` was **poor 0.0% / low 0.0% / mid 74.9% / good
5.2% / best 19.9%**, and 26.4% of all involvement rows read "Everywhere". Every
good attacker read "Decisive / Masterful / Everywhere".

Two changes fixed it:
1. Group score is now the **weighted mean** of its members, not the max. Max let
   one near-binary component (goal involvement: blanked or returned) speak for
   the whole group.
2. Band cuts are **per-group percentiles** (p15/p35/p65/p85) baked from the real
   2025-26 distribution — `BAND_CUTS` in `perfBand.ts`.

Resulting shares:

| group | poor | low | mid | good | best |
|---|---|---|---|---|---|
| attacking | 15.6% | 19.1% | 48.8% | 4.7% | 11.8% |
| creating | 15.2% | 19.9% | 29.9% | 20.1% | 15.0% |
| involvement | 15.3% | 19.7% | 30.1% | 20.0% | 15.0% |
| defending | 15.1% | 20.0% | 30.0% | 20.0% | 15.0% |
| shotStopping | 17.7% | 21.1% | 23.3% | 20.6% | 17.2% |
| goalsPrevented | 15.4% | 19.7% | 29.9% | 20.2% | 14.9% |

**`BAND_CUTS` must be refreshed when `rating_reference_stats` is regenerated** —
they are distribution-dependent the same way the medians are. The probe that
produced them is `scratch/band-distribution-probe.ts`; its header says how to
run it (copy into `__tests__`, run vitest, read `/tmp/band-probe.txt`, delete).

---

## 4a. Rank anchors — SHIPPED

`rankAnchor()` in `perfBand.ts`. A group scoring in the top quarter for its
position gets a line beside the evidence: **"TOP 5% FOR AN AM"**. Four tiers —
25 / 10 / 5 / 1 — and nothing below the top quarter, because between the median
and p75 the band has already said everything a percentile would, and "bottom
40%" is unpleasant without being actionable.

`PerfGroup.rank` carries it; the component's `ranks` prop survives as an
override for a surface that wants to rank against a different pool. A feat row
gets no anchor: a feat is rarer than 1%, so an anchor there *understates* it.

Three decisions worth not re-litigating:

- **Pooled by identical weight vector, not by position group.** LB/RB, LWB/RWB
  and LW/RW each share all eight weights, so their group scores sit on one
  scale and pooling is free sample size — RWB alone has 222 appearances, which
  cannot speak about a 1% tail. Positions with a distinct weight vector are
  never pooled. The anchor still names the player's own position.
- **Tie-safe thresholds, not quantiles.** CB attacking has p50 = p75 = p90 =
  0.513 — the blanks all score identically — so `score >= p90` would have put
  "Top 10%" on 40% of centre-backs. Each cut is instead the smallest observed
  value whose tail is *at most* the claimed share, so a label never overstates.
  Where a tie block drives the achieved share under half the label, that tier
  is `null` and the tier above speaks: four holes, all in `attacking`
  (CB top25, DM top5, LB/RB top25 and top10).
- **The ladder stays coarse.** Four tiers take a group from 5 ordinal levels to
  8 — too blunt to fit a sigmoid against, and a percentile of a monotone
  transform of public FPL inputs is computable by anyone. Making it finer, or
  emitting an interpolatable number, breaks the disclosure rule.

Coverage over 2025-26: ~75% of rows get no anchor, then roughly 15 / 5 / 4 / 1%
across the four tiers (`attacking` runs leaner — 83% none — because of the
dropped tiers).

`RANK_CUTS` is distribution-dependent exactly like `BAND_CUTS`; **refresh the
pair together.** Probe: `scratch/rank-anchor-probe.ts`.

Two smaller things went in alongside: `FEAT_GI_SATURATION_RAW`,
`FEAT_GI_UNIT`, `FEAT_CREATIVITY_RAW` and `FEAT_CREATIVITY_UNIT` are now
exported from `matchRating.ts` and imported by `cardData.ts` and `perfBand.ts`,
which had each hardcoded their own copies; and `perfBand.test.ts` now guards
the disclosure rules structurally (no score in the payload, every width
quantised, group order fixed under any scores) plus the anchor's monotonicity.

## 5. Known-unresolved

**Attacking still has an irreducible middle.** ~49% of appearances land in one
band because an attacker either returned or didn't, and the blanks score
identically. Its `good` band is starved at 4.7%. Percentile cuts cannot split
identical values. If this needs to be better, Attacking probably wants banding
on goals/assists/xG directly rather than on the sigmoid components — that is a
real piece of work, not a tuning pass.

**Top-of-the-top — FIXED by the rank anchors (see §4a).** GW1's eleven leading
attackers all read "Decisive"; they now split Top 5% / Top 10% / Top 25%, and
GW1's three "Commanding" centre-backs split Top 1% / Top 10% / Top 25%. The
band still cannot separate them on its own and is not meant to.

**Where else it lands** was asked and not answered. Current answer, unbuilt:
matchup detail (the per-player breakdown), the signature in list rows, the card
front for season scope, and a chip deep-link carrying the gameweek so tapping a
pitch chip opens the card at that match. Today the chip opens the card with no
match context at all — `MatchupPitch.tsx:384` passes only the player id.

---

## 6. Next steps, in order

1. ~~Rank anchors~~ — **DONE**, §4a.
2. **Game log → responsive list**, drop the `transform: scale(0.92)` at
   `PremiumPlayerCard.module.css:1335`. Still needs Duke's yes: it reworks
   something that currently works.
3. **Persist the banded breakdown** at scoring time so a completed match can be
   explained without re-scoring. Blocked for GK only, behind the open
   goalkeeper question in `docs/HANDOFF-2026-08-23-scoring.md` §1.
4. Matchup-detail landing + the signature in list rows.
5. Chip deep-link with gameweek.
6. Attacking's distribution (§5), if it still bothers him.

## 7. Do not

- Re-add a continuous bar width, or let a score into the API payload.
- Sort groups by contribution.
- Split the four display groups back into eight rows — the grouping is what
  hides `defensive` and `match_impact`, the two blends the league cannot
  already compute from public FPL data.
- Use an emoji for the feat mark; it is inline SVG on `currentColor` so it
  takes the row's band.
- Make the rank ladder finer than 25/10/5/1, or emit the percentile as a number
  a caller can interpolate. The coarseness is the disclosure argument.
- Add a sixth colour to the ramp. Its five stops are contrast-solved and all
  184 palette pairs pass with them; the feat tiers are blue/violet precisely
  because they leave the scale rather than extending it.
