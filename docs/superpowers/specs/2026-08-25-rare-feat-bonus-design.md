# The rare-feat bonus — separate the rarest games, and stop paying centre-backs for crosses

**Date:** 2026-08-25
**Status:** IMPLEMENTED 2026-08-25. Constants confirmed by Duke at
`k = 3.0` and `creativity ≥ 90`. Backfill and reference-stat recompute
deliberately NOT run — see §10. One recommendation in §8 was wrong and the
golden suite caught it; §8 records the correction.
**Scope:** `applyRareFeatBump`, `RARE_FEAT_HEADROOM_FRACTION`,
`RARE_FEAT_GI_SATURATION_RAW`, `RARE_FEAT_CREATIVITY_Z_THRESHOLD` and their two
call sites in `src/lib/scoring/matchRating.ts`. Nothing else in the engine moves.

---

## 1. The problem, in one line each

The rare-feat bonus landed 2026-08-24 to stop a hat-trick grading the same as a
two-goal game. Measured against the live engine and the full 2025-26 season, it
has two independent defects:

- **It cannot separate the rarest games**, because it spends headroom toward a
  composite of 1.0 and composite 1.0 maps to a hard 44.69-point ceiling. Every
  feat above a hat-trick is crushed into the last two points of the scale.
- **Its creativity trigger fires on the wrong players.** 54 of 96 firings in
  2025-26 were goalkeepers and centre-backs. All four playmaking positions
  combined got 13.

Both are fixed by the same change of shape: make the bonus **additive after the
points curve**, and make the creativity trigger **absolute rather than
positional**.

---

## 2. Defect A — the ceiling

`applyRareFeatBump(composite, excess) = 1 − (1 − composite) × 0.4^excess`
asymptotically approaches 1.0. Points are `curve(1 + 9 × composite)`, so
composite 1.0 is 44.69 points and nothing can exceed it.

Real hat-trick games arrive at the bump already at composite ≈ 0.94, because —
as the existing code comment correctly notes — by the time a player has two
goals almost every component is near its ceiling. From there:

| Feat | G/A | Points | Gain over previous |
|---|---|---|---|
| 2G+1A | 3 | 41.69 | — |
| hat-trick | 3 | 42.47 | +0.78 |
| 3G+1A | 4 | 43.48 | +1.01 |
| 3G+2A | 5 | 44.03 | +0.55 |
| 4G+1A | 5 | 44.20 | +0.17 |
| 5G+2A | 7 | 44.58 | +0.38 |
| *(ceiling)* | | *44.69* | |

**A five-goal-two-assist game is worth 2.89 points more than a hat-trick.** The
bump reproduces, one tier up, exactly the compression it was built to remove.

### The second-order bug

Because the bump spends *remaining headroom*, it pays a **larger bonus to a
worse game**. The same 2G+1A is worth:

| Base composite | Bonus |
|---|---|
| 0.84 | **+7.24** |
| 0.94 | **+2.90** |

A hat-trick should be worth a hat-trick regardless of how the other eighty
minutes went. This is backwards and it shares a root cause with the ceiling.

### The comment is also wrong

`matchRating.ts` describes the bonus as "about +3.5 points" for a hat-trick and
"+4.75" for four goals. Those hold at composite 0.94 (+3.68 and +5.41) and
nowhere else — at 0.84 the same feats pay +9.25 and +12.72. The bonus is not a
fixed size and the comment reads as though it were. Fix the comment whatever
else is decided.

---

## 3. Defect B — the creativity trigger fires on defenders

`RARE_FEAT_CREATIVITY_Z_THRESHOLD = 3.9` fired **96 times in 11,355 appearances**
(0.85%, **2.53 per gameweek**) — marginally *more often* than the goal trigger's
2.42. Nothing about it is rare.

| Position | Fires | `creativity` weight | Paid? |
|---|---|---|---|
| **GK** | 29 | 0.00 | no — blocked by the weight gate |
| **CB** | 23 | 0.05 | **yes** |
| DM | 10 | 0.05 | yes |
| ST | 7 | 0.10 | yes |
| RB / LB / RW / LW | 14 | 0.05–0.10 | yes |
| **AM / CM / LWB / RWB** | **13** | 0.15–0.25 | yes |

### Why

A z-score asks "unusual **for this position**". For a position that never
creates, unusual is one decent ball. From `rating_reference_stats`, 2025-26:

| Position | creativity median | stddev | Raw value that clears z 3.9 |
|---|---|---|---|
| GK | 0.0 | 2.11 | **8.2** |
| CB | 1.3 | 6.37 | **26.1** |
| AM | 17.1 | 19.73 | **94.1** |

An attacking midfielder needs a 94 to trigger. A centre-back needs 26. The
trigger is measuring positional baseline, not creative excellence — and the
season's "rare creative feat" leaderboard is Mukiele (5), Senesi (3), Van Hecke
(3), Saliba (2), Guéhi (2).

Goalkeepers are saved only by an accident: the call site gates on
`posWeights.creativity > 0`, and GK is the one position weighted at zero. That
gate was written for a different reason and it is the only thing standing
between the current design and paying keepers for goal kicks.

---

## 4. The design

### 4a. Additive after the curve

Delete `applyRareFeatBump` and the composite bump entirely. Apply the bonus to
points, after the curve:

```
points = calculateFantasyPoints(scoringRating, minutes) + featBonus(excess)
```

Nothing fights composite's cap, so the scale is unbounded and every increment is
worth the same wherever it lands:

| Feat | G/A | Current | Additive, k=3 |
|---|---|---|---|
| 2G+1A | 3 | 41.69 | 41.04 |
| hat-trick | 3 | 42.47 | 42.04 |
| 3G+1A | 4 | 43.48 | 44.04 |
| 3G+2A | 5 | 44.03 | 46.04 |
| 4G+1A | 5 | 44.20 | 47.04 |
| 5G+2A | 7 | 44.58 | 52.04 |

Feat range spreads from **2.89 points to 11.00**. A hat-trick pays **+3.25**,
inside the "usually 3 to 5 extra points" `docs/USER_GUIDE.md` already publishes —
so the common case needs no guide change.

**The display rating no longer receives the bump.** Cost: a hat-trick reads 9.14
instead of 9.37. That is a realistic match rating for a hat-trick and the
simplification is worth 0.21.

### 4b. Creativity goes absolute

Replace the z-threshold with a raw creativity bar, matching the shape goal
involvement already uses (`goals×6 + assists×4 > 11.5` is a global raw constant,
not a z-score). Raw creativity self-selects for playmakers with **no position
gating at all**:

| Bar | Fires/season | Per GW | Distribution | GK/CB |
|---|---|---|---|---|
| ≥ 70 | 40 | 1.05 | AM 17, RW 6, CM 5, DM 3, LW 3, RB 3, LWB 2, LB 1 | **0** |
| ≥ 80 | 24 | 0.63 | AM 11, RW 3, CM 3, RB 3, DM 2, LW 1 | **0** |
| **≥ 90** | **11** | **0.29** | Bruno ×3, Longstaff, Foden, Enzo, Groß, Anderson, Cherki, Pedro Porro, Szoboszlai | **0** |

**Recommended: ≥ 90.** Eleven games in a season is genuinely best-of-the-best,
and the position problem disappears without a single explicit position rule —
no centre-back came close to 90 all year.

On the obvious objection: Bruno Fernandes takes 3 of the 11. He also recorded
the highest creativity figure in the dataset (106.8) and was the league's best
creator. Three of eleven is the model working. His whole-season gain from the
creativity bonus is roughly **8 points**.

---

## 5. The constants

```ts
/** Points per unit of excess, both triggers. */
const FEAT_POINTS_PER_UNIT = 3.0;

/** goals×6 + assists×4 above which a feat has fired. Unchanged. */
const FEAT_GI_SATURATION_RAW = 11.5;
/** One unit of GI excess = one goal. Unchanged in spirit. */
const FEAT_GI_UNIT = 6;

/** Raw FPL creativity above which a creative feat has fired. Was a z of 3.9. */
const FEAT_CREATIVITY_RAW = 90;
/** One unit of creative excess. */
const FEAT_CREATIVITY_UNIT = 15;
```

Calibration check: Bruno's 106.8 gives `(106.8 − 90) / 15 = 1.12` units →
**+3.36 points**, against a hat-trick's +3.25. **The season's single best
creative performance is worth about what a hat-trick is worth.** That parity is
the entire argument for `FEAT_CREATIVITY_UNIT = 15`; if the parity is rejected,
that is the number to move.

---

## 6. Two decisions this spec does not make

1. **`FEAT_POINTS_PER_UNIT = 3.0`** is chosen so a hat-trick stays inside the
   guide's published 3–5 range. Any other value needs the guide updated.
2. **`FEAT_CREATIVITY_RAW = 90`** is chosen for rarity (11/season). 80 gives 24
   and is defensible if the bonus should fire about as often as a big goal
   return does.

---

## 7. Migration impact, 2025-26

| | Now | After |
|---|---|---|
| Appearances receiving any feat bonus | 159 | 103 |
| — from goal involvement | 92 | 92 (unchanged) |
| — from creativity | 67 | 11 |
| Distinct players receiving a creativity bonus | 50 | 9 |
| Appearances **losing** a creativity bonus | — | 56 |

No appearance in the season triggered both feats, so the two are additive in
principle and never stack in practice.

The 56 losses are the centre-backs, full-backs and defensive midfielders who
were being paid for a positional artefact. That is the point of the change, not
a regression.

---

## 8. Implementation notes

- **Order of operations.** Add the bonus *before* the OOP 20% penalty, so an
  out-of-position player's whole output is discounted consistently. Add it
  *after* `GK_CURVE_SCALE` — moot in practice, since a keeper can trigger
  neither feat, but state it so a later reader does not have to re-derive it.
- ~~**Delete the `posWeights.creativity > 0` gate** at the call site.~~
  **Wrong — do not do this.** Deleting it turned the golden suite red on
  *"never triggers the creativity rare-feat kicker for a goalkeeper"*, and the
  test was right. The empirical argument for deleting it (highest GK creativity
  in all of 2025-26 was ~20, against a bar of 90) is strictly weaker than the
  structural one the test encodes: **a component weighted 0.00 for a position
  must never move that position's score.** Resting that on "the data says it
  cannot happen" rather than "the code says it cannot" is the kind of implicit
  invariant that breaks silently three seasons later. The gate also costs
  nothing — every outfield position weights creativity above zero, so GK is the
  only thing it excludes, and the centre-back over-firing this change exists to
  fix was caused by the z-score threshold, never by the gate. Both gates stay.
- **The points floor stays.** `Math.max(0, …)` is unaffected; a feat bonus can
  only ever add.
- **`scripts/recompute_reference_stats.mjs` duplicates the matchRating
  constants** and has silently drifted before (see `CLAUDE.md`). Check whether
  it needs the same edit before declaring done.
- **Golden baseline.** `src/lib/scoring/__tests__/matchRating.golden.test.ts`
  regenerates for every fixture containing a feat. Regenerate deliberately and
  eyeball the diff — that file exists to catch exactly this kind of change.
- **New tests worth having:** a hat-trick pays the same bonus off a 0.84
  composite as off a 0.94 one (the §2 second-order bug, locked shut); a CB with
  creativity 30 receives nothing; points remain monotonic in excess.

---

## 9. What this does not change

- Ratings and points for the ~98.6% of appearances with no feat.
- The points curve itself (pivot 4.0, scale 8.6, exponent 1.5, zero-line at
  display 5.5). Untouched.
- Position weights, flex config, reference stats, the OOP penalty, the GK curve
  scale.
- The goal-involvement threshold of 11.5 raw.

## 10. Backfill

Out of scope here, and a separate decision. Per
`project_scoring_curve_backfill_hold` the 2026-08-24 points-curve retune is
already awaiting a backfill window; this change should join that queue rather
than open a second one. Landing the code without backfilling leaves completed
history scored on the old bonus — acceptable, and the same position the curve
retune is already in.
