# Handoff — scoring engine work, 2026-08-23

**Read this before touching `src/lib/scoring/matchRating.ts` or re-running any
backfill.** Everything below shipped to `main` today and is live.

**Unresolved:** Duke is not satisfied with where goalkeeper ratings landed. See
§1. Nothing else is open.

---

## 1. The open question: goalkeeper ratings

### Where it stands

Three states, all measured over 2025-26's 767 keeper appearances:

| | Original | First fix (`ce6657c`) | Now (`b4c2af4`) |
|---|---|---|---|
| Season rating spread across keepers | **0.271** | 0.181 | 0.192 |
| Mean season rating | 6.72 | 6.48 | **6.63** (outfield 6.66) |
| Per-match spread within clean sheets | **0.21** | 0.49 | 0.34 |
| Mean points per appearance | 10.12 | 7.27 | 7.14 (outfield 7.27) |
| Raya | 7.14 | 6.58 | 6.92 |
| Donnarumma | 7.21 | 6.76 | 6.98 |

`ce6657c` optimised per-match dispersion and flattened the season leaderboard —
Duke's words were that the stats "got completely destroyed". `b4c2af4` re-fitted
against season-level targets and recovered most of it, but keepers still sit
closer together over a season than they used to (0.192 vs 0.271).

### The trade-off, which is real and may not be resolvable by tuning

The clean sheet is what separated keepers across a season — keepers at good
defensive sides kept more. It was also what made the per-match rating a switch:
193 clean sheets producing ratings with a standard deviation of 0.21, one
routine save and eight outstanding ones both landing on ~8.65.

Those are the same lever. Reduce the clean sheet and per-match discrimination
improves while season-level separation shrinks. Every parameter set swept lands
on that frontier; nothing found both.

### Three ways forward

1. **Accept where it is.** Season spread 0.192, mean restored, per-match
   discrimination improved from 0.21 to 0.34.
2. **Revert to the reference-stat fix only.** Keep the genuine bug fix (§3),
   restore every keeper knob to its original value. Gives mean 6.70 and season
   spread near the original 0.271, but leaves the clean-sheet switch intact
   (per-match spread stays ~0.19). This is the smallest defensible position.
3. **Separate the two scales.** The season leaderboard could rank on something
   other than the mean of per-match ratings — the per-match number could measure
   the keeper's own match while a season figure still reflects clean sheets kept.
   Not investigated. It is the only route that gets both, and it is a bigger
   change than anything attempted today.

Duke has not chosen. **Do not tune further without asking which of these he
wants** — two rounds of fitting have already been spent chasing the wrong
objective.

### Current keeper constants

`src/lib/scoring/matchRating.ts`:

```
GK_CLEAN_SHEET = 20          (original 20; ce6657c tried 5)
GK_CLEAN_SHEET_SAVE_CAP = 10 (original 4)
GK_GOAL_CONCEDED = 3.4       (original 4.2)
GK_XGC_DIFF = 2.5            (original 2.5)
GK_CURVE_SCALE = 0.84        (original 0.72; ce6657c deleted it)
POSITION_WEIGHTS.GK          defensive 0.38 / save_score 0.22 (original 0.42 / 0.18)
```

The `Math.max(scoreVal, 0.86)` clean-sheet floor in `save_score` is **removed**
and should stay removed under any option — it overrode the only component that
measures saves.

**Weights are constrained:** `match_impact` 0.14 + `influence` 0.06 +
`defensive` + `save_score` + the 0.20 flex must total exactly 1.00, so the two
middle terms have to sum to 0.60. `weights.test.ts` enforces this. A sweep that
ignores it produces invalid candidates — that happened today.

---

## 2. What else shipped today

In order. All on `main`.

| Commit | What |
|---|---|
| `76e0e4b` | FPL 2026/27 lockdown: ICT imputation, `gameweek_sync_state` gate, provisional labelling |
| `9727f3c` | Merge superseding the remote's `finished_provisional` grace window |
| `7c328c7` | Pitch chips read the real `match_rating`; player card stops claiming 2025/26 |
| `0e003df` | First 2025-26 re-score + snapshot rebuild |
| `f560156` | `/share/stats?season=YYYY-YY` |
| `bbf792c` | Appearance credit made flat (superseded) |
| `a78b95b` | Appearance credit removed entirely instead |
| `ce6657c` | Goalkeeper rating rework (over-corrected) |
| `b4c2af4` | Goalkeeper re-tune |

Specs: `docs/superpowers/specs/2026-08-23-goalkeeper-rating-design.md` (§9 records
what actually shipped and where it diverged).

### Scoring rules as they now stand

- **No appearance credit for anyone.** Keepers used to have a 2.5 credit nobody
  else did, which inverted rating against points: a keeper who did nothing
  banked 2.5 while a better-rated outfielder banked 0. Removed rather than
  extended — extending it closes the same gap by the same amount (0.38 either
  way, since a constant changes no relative standing) but inflates every total
  and reverses the guide's stated no-participation-points rule.
- **18% of appearances score exactly zero.** Deliberate, and documented. Below
  ~5.84 display rating the curve pays nothing.
- The curve's dead zone is load-bearing. Recutting it to grade poor games
  compresses team margins enough to take the modelled draw rate from 18% to as
  high as 46%. Do not remove it without re-checking that number.

---

## 3. Traps found today

**`recompute_reference_stats.mjs` duplicates the engine's formulas and had
silently drifted.** It was computing GK `defensive` as
`recoveries*0.5 + cbi*0.5 + 16 - gc*4.0` while the engine computed something
else, and `sv*2 + psav*5` against the engine's `sv*2.5 + psav*6`. The stored
stddev was 10.72 where the engine's own output has 17.18, so the sigmoid ran
~60% too steep for keepers. Both now mirror the engine, but they are still
copies — **change one, change the other.**

**`/share/stats` for a completed season does not read the database.** It serves
`PRECOMPUTED_STATS_2025_26` from `src/lib/season/archived_stats_2025_26.ts`, a
1.3 MB checked-in constant. Regenerate with
`scratch/build_2025_26_json.mjs`. Regenerating also pulls in unrelated drift from
the `players` table (`updated_at`, `fpl_status`, market values), so a snapshot
diff is never a clean read of a scoring change without filtering those out.

**The snapshot mixes scales if regenerated at the wrong time.**
`positionAggregates.ts` keeps stored `player_stats.fantasy_points` for a player's
primary position and re-scores his secondaries live. Regenerating before
backfilling writes primaries on the old scale and secondaries on the new one —
725 of 919 position-rank entries moved for no real reason when this happened.

**`finished_provisional` does not exist on FPL event objects**, only on fixtures.
Two separate sessions have now written `e.finished_provisional === true`, which
is always `undefined === true`, silently disabling the fix each time.

---

## 4. Runbook: re-scoring a season

Order matters. Each step feeds the next.

```bash
# 1. deploy the engine change first
# 2. update rating_reference_stats (or run scripts/recompute_reference_stats.mjs)
# 3. re-score stored rows — dry run first, it reports before it writes
node --experimental-strip-types --no-warnings --import ./scratch/register-ts.mjs \
  scripts/backfill_rescore_season.ts --season 2025-26
#    then --apply, then re-run bare to confirm "rows to write: 0"
# 4. select archive_player_season_stats('2025-26');
# 5. recomputePositionRanks(admin, '2025-26')
# 6. node ... scratch/build_2025_26_json.mjs
```

Notes:

- The reference stats were updated **before** deploying today, leaving a window
  where the live engine scored against medians from a formula it did not have.
  Harmless because 2026-27 re-syncs every two minutes, but do it in the order
  above.
- `scripts/backfill_rescore_season.ts` writes both `match_rating` and
  `fantasy_points`, recomputes desired state rather than applying a delta, and is
  idempotent — a crashed run is repaired by re-running. Concurrency 25 with
  retries; 500 in flight reliably tripped `fetch failed`.
- `--check-only` reports whether stored ratings still reproduce from stored
  stats. Useful as a drift alarm.
- `/api/admin/backfill-scoring-v2` **cannot** do this. It refetches
  `event/{gw}/live` from FPL and writes `_v2` shadow columns; FPL stops serving a
  season after rollover.
- 2026-27 needs no backfill while a gameweek is live — the two-minute sync
  rewrites it against whatever is deployed.

---

## 5. Housekeeping

- **`slotAppearance.test.ts` has two TypeScript errors** (`bySlot` does not exist
  on that type), from `aa0c23f`, another session's commit. Tests and `next build`
  both pass, so it is not blocking, but `tsc --noEmit` is red on `main`.
- **Two migrations are both numbered 129** —
  `129_live_score_sync_longer_timeout.sql` (committed, applied) and
  `129_lower_listing_min_bid_floor.sql` (untracked, and cited by name in
  CLAUDE.md). Renumbering the untracked one to 136 is the obvious fix.
- The working tree has substantial uncommitted work from other sessions
  (`DESIGN.md`, `docs/DECISIONS.md`, palette and roster changes). Today's commits
  were all made through temporary `git worktree` checkouts to avoid sweeping it
  in. **Check `git status` and the current branch before committing** — the
  branch changed under this session twice.
- Scratch analysis scripts were deleted after use. The two kept are
  `scripts/backfill_rescore_season.ts` and `scripts/fit_ict_imputation.ts`.

---

## 6. Refit reminder

`src/lib/scoring/ictImputation.json` was fitted on 2025-26. FPL changed the BPS
formula for 2026/27 and bps is the strongest feature in that model, so the
coefficients are a cold start. **Refit once 2026/27 has ~5 gameweeks:**

```bash
node --experimental-strip-types scripts/fit_ict_imputation.ts --season 2026-27 --holdout 4
```
