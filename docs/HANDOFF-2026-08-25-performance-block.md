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
< 560px   one line, evidence and anchor stacked beneath
wider     evidence and anchor share a line
```

The anchor used to be dropped below 560px, which meant it never rendered at
all — the game-log cell on the card back is ~312px, and that is the only place
the block lives today. It now takes a line of its own instead, because the
anchor is the whole answer to "the top performances all read alike".

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
fixed here. Note the block's own evidence lines were separately wrong about
`fpl_cbi` — see §4d; check what a field MEANS as well as whether it is
populated.

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

**Watch `defending` in 2026-27.** Measured on GW1's 609 rows against the
2025-26 cuts, most groups hold their shape (creating best 18.6% vs a 14.9%
target, inside one week's noise) but `defending` came in **poor 4.5% / good
34.3%** against targets of 15% / 20%. One gameweek is far too little to retune
on — an opening weekend full of clean sheets looks exactly like this — so this
is a thing to re-measure around GW5, not to act on now.

**`BAND_CUTS`, `BAND_CUTS_BY_POS` and `ANCHOR_TIERS` must all be refreshed when
`rating_reference_stats` is regenerated** —
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

`ANCHOR_TIERS` (called `RANK_CUTS` when first written — see §4e, which
re-derived it against the band floor) is distribution-dependent exactly like
`BAND_CUTS`; **refresh the
pair together.** Probe: `scratch/rank-anchor-probe.ts`.

Two smaller things went in alongside: `FEAT_GI_SATURATION_RAW`,
`FEAT_GI_UNIT`, `FEAT_CREATIVITY_RAW` and `FEAT_CREATIVITY_UNIT` are now
exported from `matchRating.ts` and imported by `cardData.ts` and `perfBand.ts`,
which had each hardcoded their own copies; and `perfBand.test.ts` now guards
the disclosure rules structurally (no score in the payload, every width
quantised, group order fixed under any scores) plus the anchor's monotonicity.

## 4b. Mute groups — SHIPPED

**A row that structurally cannot vary no longer spends a row.** Distinct values
of the raw `attacking` score over 2025-26, with the share sitting on one value:

| pos | distinct | on one value | | pos | distinct | on one value |
|---|---|---|---|---|---|---|
| RB | 5 | 89.7% | | LWB | 43 | 29.7% |
| LB | 6 | 89.6% | | CM | 121 | 27.9% |
| DM | 7 | 86.6% | | AM | 146 | 15.9% |
| CB | 216 | 28.6% | | ST | 928 | 12.5% |

No percentile cut can touch the top three — they are one near-binary component
(goals×6 + assists×4, zero about nine games in ten) wearing a group's clothes.

The rule is structural rather than a per-position list: a group is
*mute-capable* when every member the position actually weights is near-binary
(`goal_involvement`, `finishing`), and it then renders only when the match gave
it something to report — a goal, an assist, or xG ≥ 0.05, since a real chance
missed is exactly what `finishing` judges. It recomputes from
`POSITION_WEIGHTS`, so a weight change carries it rather than leaving a stale
list. LWB/CM/ST and the rest all weight `threat`, which is continuous, so they
are never muted — a blanking striker still reads ANONYMOUS, which is that row
doing its job.

Effect on signature collision — P(two random same-position appearances read
identically), whole season: LB 1.0→0.7%, RB 1.1→0.9%, DM 1.2→0.9%, CB
1.9→1.7%, with distinct signatures up (DM 411→544, LB 242→297).

**The collisions that remain are honest, and that was checked rather than
assumed.** Every modal signature is a nothing-game whose points agree: ST
"poor low mid" is 248 appearances scoring 0.2–2.1, LW "low poor poor" is 0.4–1.8,
AM "poor poor low" is 0.0–0.2. Two identical bad games *should* read alike. The
number that matters is collision among the top 10% by points, and that is under
2.1% everywhere but GK (§5). Probe: `scratch/signature-collision-probe.ts`.

## 4c. Matchup detail + the chip deep-link — SHIPPED

The block now has a second home, and it is the one that matters weekly.

**The Points breakdown row opens in place.** `buildLineupPerformance` in
`matchups.ts` builds the banded groups for every starter, server-side, **at the
slot he was fielded in** — the same rule the chips already follow, because the
block has to explain the number on the row beside it. Szoboszlai at CM shows
CM's group order and picks up a Defending row he would not have as an AM.
Bench players are skipped deliberately: the bench depth bonus is not a slot, so
there is no position to grade the appearance under.

**Two affordances, two questions.** The pitch chip still opens the player card;
the breakdown row expands the *why* of the points. Collapsing them would have
meant a modal every time you wanted to read a score already on screen.

**The chip now carries the gameweek.** `OpenPlayerOptions.gameweek` threads
provider → modal → card, and `PremiumPlayerCard` flips to the game log and
opens that gameweek's row. It waits for the back payload rather than firing on
mount (there is no row to open before it lands) and fires once per requested
gameweek, so it will not fight a reader who closes the row by hand.

Verified against Matchday Militia's real GW1 (170.95–101.65): 21 blocks for 22
starters, the missing one a player who did not appear, out-of-position slots
graded correctly, and no score in the payload.

Alongside: `featExcessFor` is now exported from `matchRating.ts` and used by
the engine, the card and the matchup. The card's inline copy had already
drifted — it omitted the positional gates, so it would have credited a feat to
a position not scored on the component that produced it. `roleArticle` moved to
`perfBand.ts` for the same reason, so both surfaces name a position identically.

## 4d. Band calibration and the evidence lines — SHIPPED

Duke read one row and it broke three things open. A centre-back showing
**"5 tackles, 10 clearances, 6 recoveries"** and a verdict of **STEADY**, with
**INCISIVE** above **"Little creative output."** underneath it.

### The evidence lines were citing facts that did not produce the band

Josh Acheampong, CB, GW1: tk 5, cbi 10, rec 6, no clean sheet, 2 conceded
against 1.33 xGC. The engine computed `tackles + cbi × 0.5` = 10, dropped the
recoveries (the CB branch does not count them), added no clean-sheet bonus, and
took 3.35 straight back off for conceding above expected. Raw 6.65 — almost
exactly the CB median, so STEADY was correct. The *line* was not:

1. **`fpl_cbi` was labelled "clearances".** It is FPL's
   `clearances_blocks_interceptions`, so **blocks are counted** — the label hid
   two of the three things in the number. (Duke asked directly whether blocks
   were included. They are, and always were.)
2. **It printed a centre-back's recoveries**, which his defensive score drops
   entirely. Citing a stat the score ignores is worse than citing nothing.
3. **It never mentioned the outcome term**, which is usually what sets the
   band — the clean sheet, or goals conceded against expected.

Fixed: name the actions the position is graded on, then the outcome that
discounted them. Six tests now guard it, each from a real miss.

### One league-wide band table could not survive a compressed position

The scores are positionally normalised by the sigmoid, but `BAND_CUTS` graded
them against one all-positions distribution. Where a position's distribution is
compressed the two disagree and bands die. Measured over 2025-26:

| | poor | low | mid | good | best | median raw creativity in good+best |
|---|---|---|---|---|---|---|
| CB creating | **0%** | **0%** | 64% | 14% | 22% | **10.7** |
| AM creating | 23% | 15% | 28% | 19% | 14% | 33.0 |

A centre-back could not grade below STEADY on Creating, and 36% read INCISIVE
or MASTERFUL on a tenth of the raw creativity an AM needed for the same word.
**Nine of 43 position+group pairs had a band under 3%.**

`BAND_CUTS_BY_POS` is the fix — tie-safe percentile cuts per position bucket,
pooled by `POS_BUCKET` exactly like `ANCHOR_TIERS`. **It is an override, not a
replacement**, and that matters: three pairs come out *worse* per-position, and
they are the near-binary `attacking` groups the mute rule already exists for.
DM and LB/RB land all four cuts on 0.8320, which would grade a full-back with
0.3 xG and no goal as ANONYMOUS where the league-wide table says INVOLVED — the
truer word. So a per-position entry is used only when its four cuts are
strictly increasing. 29 of 32 qualify.

Dead bands: **9 of 43 → 4 of 43**, and the survivors are exactly the four
irreducible near-binary attacking groups (CB, DM, LB, RB), whose scores take
5–7 distinct values a season. CB creating now reads 22/14/30/19/15.

### Creating's middle word was praise

Every other group's mid verdict is flat — Involved, Steady, Busy, Held —
but creating's was **"Inventive"**, which is why the row argued with itself.
`Tidy` moved down into mid where it belongs and `Sideways` took low. A test now
asserts every group's mid word comes from a neutral list.

Acheampong's row now reads: *Defending STEADY — "5 tackles, 10 clearances,
blocks and interceptions, 2 conceded against 1.3 expected." / Creating TIDY —
"Little creative output."*

**Nothing had shipped when this was found** — the block lives only on this
unpushed branch — so recalibrating cost nothing. Doing the same after a merge
would change words managers had already read.

## 4d. Persisted bands + the signature — SHIPPED

**Migration 140** adds `player_stats.perf jsonb`, written by
`/api/sync/stats` at scoring time. Both readers prefer it and fall back to
re-scoring when it is null, so nothing changes for rows written before it.

This fixes a real inconsistency rather than saving work: the block was rebuilt
on every read with TODAY'S engine, while the points beside it came from
whichever engine scored the match. Those have already diverged — the rare-feat
rule changed on 2026-08-25 and completed history was deliberately not
backfilled, so a re-scored 2025-26 hat-trick would show the new feat mark next
to points computed under the old one. A stored snapshot always agrees with the
number it explains.

Additive and nullable, so it is safe against the live alpha leagues: it writes
no score and changes no score.

`buildLineupPerformance` uses the snapshot **only when the fielded slot is the
stored primary** — any other slot has different weights and a different group
order, so it rebuilds. Guarded by `perfPersistence.test.ts`.

**The signature** (`PerformanceSignature`) is exported from `PerformanceBlock`
and sits in the matchup breakdown row beside the points, hidden under 560px
where the name needs the room. It is NOT in the card's game log: that table is
seven columns at 11px inside a fixed 360px card, and an eighth column costs
~35px, about a tenth of the card. It belongs there only if the log ever becomes
a list, which §4e says it should not.

## 4e. The game-log rework — declined, with the measurement

The standing suggestion was "game log → responsive list, drop the
`transform: scale(0.92)`". The second half does not follow from the first, and
dropping the scale on its own is a straight regression.

The scale is not on the game log. It is on `.stage`, the whole card, which is a
fixed **360 × 520**. The modal costs 48px of horizontal chrome (overlay
`--s4` ×2, box `--s2` ×2), so the card needs a **408px viewport** to fit
unscaled. Measured against real devices: iPhone SE 375, iPhone 12–15 390,
Pixel 393 — all under it. `scale(0.92)` renders 331px into the 332px available
at 380px, which is exactly what it was tuned for.

So making the log a list does not license dropping the scale. What would is
making the card itself fluid, and that is a redesign of a fixed-aspect 3D card
with absolutely-positioned art — a real piece of work, not a tidy-up, and it
touches the front face as much as the back.

## 4e. The anchor and the band were measured separately — FIXED

Duke put Saka and Palmer side by side. Both **DECISIVE** on Attacking, but
Palmer anchored **TOP 5% FOR AN AM** and Saka **TOP 25% FOR AN RW**. His
question was how the same verdict covers those two, and the answer was that it
did not — the anchor was wrong.

**The two ladders had no common boundary.** Bands cut at p15/p35/p65/p85;
anchors were measured independently at p75/p90/p95/p99. So the `best` band (top
15%) straddled the "top 25%" tier (p75–p90), and any score in between came out
`best` AND "top 25%". Saka's attacking scored **0.8198** as an RW: the band's
best floor is 0.7437, so he was genuinely inside the top 15%, but the old
top-10 cut was 0.835, so the ladder fell back a tier and printed "top 25%".
Technically true, and useless — it understated a top-15% game and made the pair
look indistinguishable.

**The anchor is now defined as a subdivision of the best band**, not an
independent measurement:

- it fires only at or above the band's own `best` cut, read from the new
  `cutsFor` helper — **the same array `perfBand` reads**, so the two floors
  cannot drift apart again;
- its coarsest claim is therefore "top 15%", which is exactly what the best
  band means;
- `ANCHOR_TIERS` holds only the three tiers above that: top 10 / 5 / 1.

Below the best band there is now no anchor at all. That is deliberate: the band
already is the rank statement there, and bolting "top 25%" onto a `good` row
spanning top 15–35% could overstate as easily as understate. `RANK_CUTS` is
gone.

A test asserts the invariant directly — **an anchor exists if and only if the
band is `best`** — swept across every position, group, and score. That is
stronger than checking the numbers, because it fails if either table is
refreshed without the other.

Result:

| | Saka (RW) | Palmer (AM) |
|---|---|---|
| Attacking | Decisive · **Top 15%** | Decisive · **Top 5%** |
| Creating | Incisive · *(no anchor — good band)* | Masterful · Top 15% |
| Involvement | Everywhere · Top 5% | Everywhere · **Top 1%** |

Coverage over 2025-26: ~85% of rows carry no anchor, then roughly 5 / 5 / 4 / 1%
across the four tiers, which sums to the 15% the best band is by definition.

## 4f. Seven bands — the verdict itself now separates the top

§4e fixed the anchor, and Duke's answer was that I had missed his point. The
anchor is a small grey line; **the verdict is the loudest thing on the row**,
and one word covered the entire top 15%. Palmer and Saka both read DECISIVE on
attacking and both EVERYWHERE on involvement, with only the footnote saying one
was top 1% and the other top 5%. If the word cannot separate them, nothing on
the row does.

**The ladder is now seven bands, with the resolution weighted where managers
read.** poor/low/mid/good keep their 15/20/30/20 spans; the old `best` splits:

| band | share | attacking | involvement |
|---|---|---|---|
| best | top 15–5% | Decisive | Everywhere |
| elite | top 5–1% | Devastating | Immense |
| supreme | top 1% | Unplayable | Talismanic |

Full vocabulary is in `VERDICTS`. Every word is ≤11 characters because
`.verdict` is a fixed 96px column with `white-space: nowrap`.

**The anchor is now derived from the band, not measured separately.**
`ANCHOR_TIERS` is deleted. The three top bands *are* p85/p95/p99, so
`BAND_SHARE` is a three-entry map from band to the share it represents, and
§4e's whole class of bug is unrepresentable — there is one table, not two. The
test asserts the invariant (an anchor exists for exactly the three top bands)
rather than any specific number.

**No sixth ramp colour.** `best`, `elite` and `supreme` share the existing
`best` stop; escalation is carried by the word and the bar length. The five
stops are contrast-solved across all 184 palette pairs and the feat tiers are
blue/violet precisely because they leave the scale — adding a stop would break
one or crowd the other. This is the constraint in §7, respected deliberately.

Result — the two rows that prompted it:

| | Saka (RW) | Palmer (AM) |
|---|---|---|
| Attacking | **Decisive** · top 15% | **Devastating** · top 5% |
| Creating | Incisive · — | Masterful · top 15% |
| Involvement | **Immense** · top 5% | **Talismanic** · top 1% |

Measured shares over 2025-26, against targets of 15/20/30/20/10/4/1:

| group | poor | low | mid | good | best | elite | supreme |
|---|---|---|---|---|---|---|---|
| involvement | 15.3% | 20.0% | 29.9% | 20.0% | 10.0% | 4.0% | 0.8% |
| defending | 15.4% | 19.9% | 30.2% | 19.8% | 10.0% | 3.9% | 0.9% |
| creating | 18.3% | 18.1% | 29.0% | 19.9% | 9.8% | 4.0% | 0.7% |
| attacking | 16.9% | 17.8% | 23.1% | 23.3% | 12.1% | 4.8% | 0.6% |

## 5. Known-unresolved

**Attacking's middle — DIAGNOSED AND MOSTLY FIXED (§4b).** The earlier reading
of this ("an irreducible middle, wants banding on goals/assists/xG directly")
was too pessimistic and pointed at the wrong positions. It is not a banding
problem at all for the positions where it was worst: LB, RB and DM weight
threat 0.00 and finishing 0.00, so their attacking group is `goal_involvement`
ALONE — 5 to 7 distinct values across an entire season. The mute rule handles
those. ST/LW/RW/AM were never the problem; they weight `threat` and their
attacking scores carry 582–928 distinct values.

**Goalkeepers are the one place good games still read alike.** Among the top
10% of performances by points, signature collision is under 2.1% at every
position except GK at **7.3%**, with one signature covering 14.7% of them
("good good/25 good" — the clean sheet with a couple of saves, 36 appearances
at 15.6–19.0 points). `shotStopping` is `save_score` alone and saves is a small
integer, so the group has ~53 distinct values all season. This is the same
surface as the open goalkeeper question in
`docs/HANDOFF-2026-08-23-scoring.md` §1 and should be settled there, not by
tuning the block.

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
2. ~~Game log → responsive list, drop the `transform: scale(0.92)`~~ —
   **DECLINED, and the premise was wrong.** See §4e.
3. ~~Persist the banded breakdown~~ — **DONE**, §4d. It was never blocked for
   GK: persisting a SNAPSHOT means a keeper-scoring change simply applies to
   later matches while old rows keep explaining themselves correctly, which is
   the behaviour we want either way.
4. ~~Matchup-detail landing~~ and ~~chip deep-link with gameweek~~ — **DONE**,
   §4c. The signature in list rows is still unbuilt.
5. Card front, season scope — the least-defined of the four surfaces.
6. ~~Attacking's distribution~~ — **DONE**, §4b. What is left there is the
   goalkeeper collision, which belongs to the open keeper question.

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
- Add a sixth colour to the ramp. Seven bands share five stops on purpose —
  see §4f; best/elite/supreme differ by word and bar length, not hue. Its five stops are contrast-solved and all
  184 palette pairs pass with them; the feat tiers are blue/violet precisely
  because they leave the scale rather than extending it.
