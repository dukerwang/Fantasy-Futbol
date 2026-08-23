# Goalkeeper rating — measure the goalkeeping, not the scoreline

**Date:** 2026-08-23
**Status:** Scoped, not implemented. Blocked on a `/share/stats` review gate (§7).
**Scope:** The GK branch of `src/lib/scoring/matchRating.ts` — the `defensive` and
`save_score` components, their position weights, and the `GK_CURVE_SCALE` patch
that currently absorbs the fallout at the points layer.

---

## 1. The problem

A goalkeeper's Gaffa rating is very nearly a restatement of whether his team
conceded. It barely registers how he kept.

Three mechanisms stack, and all three point the same way:

- **`defensive`, weight 0.42** — the largest single component weight of any
  position in the whole table. For a keeper it is `recoveries × 0.4 + gkCsVal −
  gc × 4.2 + xgcDiff × 2.5 − zeroSavePenalty`, where `gkCsVal` is `20 + min(4,
  saves)` on a clean sheet and **0 otherwise**. Saves in a match where anything
  went in contribute nothing at all here.
- **`save_score`, weight 0.18** — genuinely computed from save volume and save
  percentage, and then overridden: `if (clean_sheet) scoreVal = Math.max(scoreVal,
  0.86)`. The component that exists to measure saves is floored by the clean
  sheet.
- **`FLEX_CONFIG.GK`, 0.20** — boosts whichever of `save_score` / `defensive` is
  higher, which after the two above is usually the same clean-sheet signal a
  third time.

Everything else is 0.20 of the rating: `match_impact` 0.14, `influence` 0.06,
and zeros across creativity, threat, goal involvement and finishing.

### What it produces

2025-26, appearances of 60+ minutes:

| Cohort | n | Avg rating | **SD** | Avg points |
|---|---|---|---|---|
| GK, clean sheet | 193 | **8.65** | **0.21** | 24.70 |
| GK, conceded | 564 | **6.01** | 1.06 | 5.27 |

The standard deviation is the finding. Across 193 clean sheets keeper ratings
move by 0.21 — one routine save or eight outstanding ones both land on about
8.65. The rating is reporting the defence's result, not the keeper's match.

### The knock-on into points

Keepers and outfielders averaged an almost identical rating last season (6.67 vs
6.66), but keeper composite is far more dispersed — **SD 0.245 against 0.157**.
The points curve rises as `^1.5`, and a convex curve fed higher variance returns
more on average even when the mean input is identical. Keepers averaged **10.12
points to an outfielder's 7.27**.

`GK_CURVE_SCALE = 0.72` exists to absorb exactly this. It is a points-layer patch
for a rating-layer defect, which is why deleting it makes keepers *more*
dominant rather than less (their mean rises to 10.62).

### Why this is worth fixing

As a **points** rule, paying keepers for clean sheets is defensible — FPL does
the same, and since the appearance credit landed the totals are roughly level.

As a **rating** it is wrong, and it is the number on the card. The display scale
is explicitly calibrated to Fotmob/SofaScore. Fotmob rates a keeper who made
eight saves in a 2-1 defeat around 8.0. Gaffa gives him 6.0, and gives the keeper
who watched a comfortable 0-0 an 8.65. That ordering is backwards and visible.

---

## 2. The change

Three edits, all inside the GK branch.

**2.1 — Delete the clean-sheet floor in `save_score`.** Remove
`if (stats.clean_sheet && canGetCS) scoreVal = Math.max(scoreVal, 0.86);`. This
is the single highest-value line in the change: it is what currently stops the
save component from measuring saves.

**2.2 — Rebalance `defensive` for GK.** Move the component from "did they keep a
clean sheet" toward "did they concede fewer than the chances warranted":

| Knob | Now | Proposed | Why |
|---|---|---|---|
| clean-sheet base (`gkCsVal`) | 20 | ~9 | Stops one binary dominating the component |
| goals-conceded weight | ×4.2 | ~×2.6 | A keeper does not choose how many arrive |
| xGC differential weight | ×2.5 | ~×4.5 | Rewards beating the chance quality faced |
| saves cap inside clean sheet | 4 | ~10 | Separates an earned shutout from a quiet one |

Leave `zeroSavePenalty` as it is. Conceding without making a save is genuinely
poor and it already only fires in that case.

**2.3 — Reweight.** `defensive` 0.42 → ~0.28, `save_score` 0.18 → ~0.32. Leave
`match_impact`, `influence` and the 0.20 flex alone.

### Modelled effect

A parameterised copy of the GK branch, verified to reproduce the live engine
exactly on all eight archetypes below before any knob was moved:

| Keeper match | Now | Proposed |
|---|---|---|
| Clean sheet, 0 saves (untroubled) | 8.15 | **7.12** |
| Clean sheet, 3 saves | 8.45 | 7.92 |
| Clean sheet, 7 saves (heroic) | 8.74 | 8.66 |
| Conceded 1, 8 saves (outstanding) | 7.45 | **8.01** |
| Conceded 1, 2 saves | 6.03 | 6.18 |
| Conceded 2, 5 saves (beaten well) | 6.47 | 6.92 |
| Conceded 2, 0 saves | 4.63 | 4.70 |
| Conceded 4, 2 saves (thrashed) | 4.92 | 5.09 |

The ordering inverts the right way: an outstanding keeper in defeat moves from
below an untroubled shutout (7.45 vs 8.15) to above it (8.01 vs 7.12). An earned
shutout is barely touched. A genuinely poor match stays poor. Spread across the
archetypes narrows, SD 1.48 → 1.32.

**These numbers are illustrative, not fitted.** They were hand-tuned against
eight cases. See §3.

---

## 3. Calibration targets

Fit the four knobs and two weights against all **1,184** 2025-26 keeper
appearances, not against archetypes. Targets, in priority order:

1. **Composite SD falls from 0.245 toward the outfield 0.157.** This is the
   actual objective; everything else follows from it.
2. **Mean GK rating stays near 6.67**, so keepers do not become globally cheaper
   or dearer to own.
3. **A keeper's rating correlates with save percentage and xGC outperformance
   more strongly than with the raw clean-sheet flag.** Worth asserting as a
   number, not an impression.
4. **`GK_CURVE_SCALE` can return to 1.0** with the GK/outfield points gap staying
   under ~0.5. This is the real proof the fix worked — the patch becomes
   unnecessary rather than merely smaller. If the scale is still needed
   afterwards, the rating change did not go far enough.

---

## 4. Required follow-on, not optional

`sigmoidNormalize` scores `defensiveRaw` against a median and stddev held in
`rating_reference_stats`, and those were computed from the **current** formula's
output distribution. Changing the formula invalidates them immediately.

**`scripts/recompute_reference_stats.mjs` runs as part of this change, not
after.** Same for `save_score` once its distribution shifts. Shipping the formula
without the recompute produces silently wrong ratings for every keeper, which is
worse than the defect being fixed.

---

## 5. Blast radius

| Thing | Count | Effect |
|---|---|---|
| GK rows re-rated | 1,251 | 1,184 in 2025-26, 67 in 2026-27 |
| Season archive rows | 646 | Stale unless backfilled |
| Completed matchups | 151 | Stored scores stale unless backfilled |
| Golden test keeper cases | 2 | Will go red — that is the point |
| Position ranks | all | `scripts/recompute-position-ranks.mjs` |

Existing machinery covers the rewrite: `/api/admin/backfill-scoring-v2` plus
`scripts/backfill-scoring-v2.mjs`, and migrations 038–040 are the shadow/promote
precedent for rolling a scoring change out behind a comparison before adopting it.

Nothing contractual is exposed. There are **zero active loans and no loan has
ever carried a performance bonus**, so the per-fantasy-point payout term is
theoretical. Prize distribution is placement-based.

---

## 6. Rollout

1. Fit the knobs offline against the 1,184 keeper appearances (§3).
2. Land the formula change plus `recompute_reference_stats.mjs` together.
3. Regenerate the golden baseline, checking each keeper case by hand rather than
   accepting the new output wholesale.
4. Backfill `player_stats` for 2025-26 behind the shadow-column pattern;
   compare; promote. This has to precede the snapshot, not follow it — see §7.
5. Regenerate the `/share/stats` snapshot, run the gate in §7, get sign-off.
6. Recompute position ranks.

**Timing: after a gameweek locks, never mid-scoring.**

---

## 7. Gate — `/share/stats` must be reviewed before any of this ships

Owner's condition, and it takes precedence over everything above.

### How that page actually works

`/share/stats` does **not** read the database for 2025-26. `src/app/share/stats/page.tsx`
serves a checked-in constant, `PRECOMPUTED_STATS_2025_26` from
`src/lib/season/archived_stats_2025_26.ts` — 1.3 MB, 646 players, plus
`shadowMaps` keyed `played` / `all` / `gt45` carrying per-position `gp`,
`total_points`, `avg_rating`, `total_minutes`, `goals`, `assists`.

Two consequences:

- **The page cannot be broken by a scoring change on its own.** It is frozen. A
  keeper rework, or any engine change, leaves it untouched until someone
  regenerates the file.
- **The regeneration is the review.** `scratch/build_2025_26_json.mjs` rebuilds
  the snapshot by importing the real engine (`matchRating.ts`) and the shared
  `positionAggregates.ts`, so running it after the change produces exactly the
  page as it would ship.

### The gate

Regenerate to a scratch copy — never over the checked-in file — and diff before
adopting. What to put in front of the owner:

- Every keeper's `overall_rank` and `avg_rating`, before and after.
- Movement in the **top 50 overall**, since keepers rising or falling reorders
  outfielders around them.
- `position_ranks` for GK, before and after.
- Each `shadowMaps` variant separately: `played`, `all`, `gt45` are three
  different pools and a keeper can move differently in each.

Adopt the regenerated snapshot only on explicit sign-off. If the balance of that
page is worse, the calibration in §3 is wrong and gets refit — the page is the
acceptance test, not a downstream consequence.

### Measured: what regenerating today actually does

The checked-in snapshot was generated **2026-08-19**, before `APPEARANCE_CREDIT`
was extended to every position (`ed27bf3`, 2026-08-23). The gate was run against
that divergence on 2026-08-23 — regenerated to a scratch copy, diffed, and the
checked-in file restored and md5-verified. Results:

**The headline table does not move at all.** `total_points`, `ppg`,
`overall_rank` and `form_rating` are identical for all 646 players. Zero rank
changes. Those values are read from `season_player_stats_archive`, not recomputed
through the engine, so a scoring change cannot reach them. The leaderboard is
structurally insulated.

**No rating moves anywhere.** `avg_rating` delta is 0.000 across all three shadow
pools, confirming the credit is points-only as designed.

**But the snapshot comes out internally inconsistent**, and this is the finding
that matters:

| Shadow entries (`played` pool) | n | Changed |
|---|---|---|
| Player's PRIMARY position | 516 | **0** |
| Player's SECONDARY positions | 453 | **453** |

The split is total and clean. `positionAggregates.ts` keeps the stored
`player_stats.fantasy_points` for a player's primary position and re-scores his
secondary positions through the live engine — the same primary/secondary
asymmetry `attachPositionScores` uses in `cardData.ts`. Since `player_stats` has
not been backfilled, regenerating today writes **every primary position on the
old scale and every secondary position on the new one**.

The visible damage is to the position comparison, which is what the shadow maps
exist to support: 725 of 919 position-rank entries move (78.9%), 203 of them by
five or more places. Secondary-position points rise ~23.9 on average while
primary stays flat, so a player's secondary rank improves against his primary for
no footballing reason. Ødegaard drops 49 → 67 at CM; Sadiki climbs 51 → 28 at DM.
None of that movement is real.

**Consequence for ordering: `player_stats.fantasy_points` must be backfilled for
2025-26 BEFORE the snapshot is regenerated**, never after and never without. This
applies to the keeper work in this spec exactly as it does to the appearance
credit.

**Also note regeneration is not scoring-only.** It re-reads current `players`
rows, so it picks up whatever has drifted since the last build — in this run
`updated_at` on all 646, plus `fpl_status` (27), `fpl_news` (32),
`market_value_updated_at` (179), `is_active` (8) and a few `web_name` / `fpl_id` /
`date_of_birth` corrections. Harmless, but it means a snapshot diff is never a
clean read of a scoring change unless those fields are filtered out first.

---

## 8. Open decisions

- **Backfill 2025-26, or leave it?** Recommend backfilling: keeper ratings are
  currently wrong rather than merely different, so leaving them makes keeper
  history incomparable in a way that is hard to explain later.
- **Shadow-column rollout, or direct?** Recommend shadow (038–040 pattern). It
  only touches one position, but it makes the `/share/stats` gate reviewable
  against real stored numbers instead of a model.
- **Review the appearance-credit divergence in the same pass?** Recommend yes.
