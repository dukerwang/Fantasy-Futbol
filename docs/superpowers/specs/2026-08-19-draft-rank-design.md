# Draft Rank — a synthetic pre-draft ranking column

## Problem

Gaffa's first live draft ("Matchday Militia", 2026-08-05) showed managers
picking without a reliable sense of who was actually good — even with raw
season stats (GP/Pts/PPG/Avg rating) visible in the Players tab, several
managers lacked the "ball knowledge" to translate those numbers into a
pick order, especially across positions and for players with little or no
prior-season sample.

There's no real ADP (average draft position) to show, since this was the
league's first-ever draft — no historical picks exist to average. But the
ingredients for a synthetic stand-in already exist and are unused:
`player_rankings.overall_rank`, and a weighted quality composite
(`autoPickEngine.ts` / `auto_pick_expired_drafts()`) that already decides
who autopick drafts for an absent manager.

Separately, that quality composite is implemented **twice**, independently:
once in TypeScript (`src/lib/draft/autoPickEngine.ts`, used by the mock
draft bot) and once in SQL (`auto_pick_expired_drafts()`, used by the real
draft's timeout autopilot). They're documented as intentionally mirrored
("Keep the two in sync if either changes") but nothing enforces that, and a
displayed rank column would become a third independent implementation if
built naively.

## Non-goals

- Not a real ADP — no historical draft data exists to average. This is
  explicitly a synthetic stand-in, computed once from market value +
  season stats, not from other managers' behavior.
- Not touching `needScore` / `pickBestCandidate`'s positional-need blending
  in `autoPickEngine.ts` — the need-vs-quality weighting that makes early
  picks BPA and late picks fill roster holes is unrelated to this and stays
  as-is.
- Not attempting to algorithmically grade injury *severity* from
  `fpl_news` free text (e.g. distinguishing "out a week" from
  "out for the season"). The data doesn't support that reliably — see
  Design below.
- Not reactive to the Players tab's existing minutes-filter toggle
  (15min "all" vs 45min "gt45") — Rank is a fixed pre-draft signal computed
  once server-side, not a live recompute of a display filter. Toggling the
  minutes filter changes the visible GP/Pts/PPG/Avg columns as it does
  today; it does not change a player's Rank.

## Design

### Formula

For each player in the draftable pool, using the same prior-completed-season
archive data `loadDraftPool.ts` already resolves via
`resolveDraftStatsSeason()`:

- **Value percentile** — `market_value` percentile rank across the entire
  pool.
- **Performance percentile** — blend of `total_points` and `ppg` percentile
  rank, also across the entire pool. (Originally proposed as partitioned by
  position to counter an assumed cross-position bias; checked against real
  2025-26 archive data and confirmed there's no such bias to correct —
  Gabriel Magalhães (CB) ranks 11th overall by total_points, David Raya
  (GK) 12th, ahead of most strikers. Gaffa's position-baseline scoring
  already produces a fair global ordering, so both percentiles stay
  unpartitioned. Do not reintroduce position-partitioning here without new
  evidence it's needed.)
- **Confidence weighting** — performance weight scales with games played
  (meaningful minutes, matching the app-wide `MEANINGFUL_MINUTES = 15`
  threshold) last season: 0 games → 0% weight on performance (100%
  value-driven); `GAMES_FLOOR = 10`+ meaningful-minute games → full weight
  (45%, matching the existing split). Linear ramp between. This directly
  handles the ~24% of the active pool with zero prior-PL games
  (`isNewToPrem`), who rank on reputation alone instead of a meaningless or
  absent stat line.
- **Injury/suspension multiplier** — a flat, modest score multiplier once
  the rest of the composite is computed: `fpl_status` in `('i', 's')` gets
  a stronger multiplier, `'d'` (doubtful) a lighter one, `'a'` (available)
  none. This is deliberately not an attempt to grade severity — see
  Non-goals. Exact constants (e.g. 0.85 / 0.95) are tunable at
  implementation time.

```
valuePct = percentile_rank(market_value, over ALL candidates)
perfPct  = percentile_rank(avg(total_points_pct, ppg_pct), over ALL candidates)
confidence = min(1, gp / GAMES_FLOOR)          -- GAMES_FLOOR = 10
performanceWeight = 0.45 * confidence
valueWeight = 1 - performanceWeight
base = valueWeight * (valuePct * 100) + performanceWeight * (perfPct * 100)
statusMultiplier = status in ('i','s') ? INJURY_MULT
                  : status = 'd'      ? DOUBTFUL_MULT
                  : 1.0
qualityScore = base * statusMultiplier
```

Rank = 1-indexed position when the pool is sorted by `qualityScore`
descending.

### Unification

`autoPickEngine.ts`'s existing split is already the right shape for this:
`scoreDraftPool()` computes `qualityScore` (the piece this spec changes);
`needScore()` / `pickBestCandidate()` (positional need blending, unchanged)
consume it. Concretely:

1. `scoreDraftPool()` in `autoPickEngine.ts` is updated to the formula
   above (dropping the old flat 55/45 global-value/global-stats split in
   favor of the confidence-weighted, status-adjusted version).
2. `loadDraftPool.ts` calls `scoreDraftPool()` once per pool load and
   attaches the resulting `qualityScore` (and derived integer `rank`) to
   each player object it returns — the same object already consumed by
   both `DraftRoom.tsx` (real draft, for the column) and
   `MockDraftRoom.tsx` (practice bot, for its pick decisions). Neither
   consumer recomputes scoring independently after this change.
3. `auto_pick_expired_drafts()` (SQL) gets its inline quality-score block
   replaced with the SQL equivalent of the same formula (window functions
   for the two percentiles, the same confidence ramp, the same status
   multiplier), so the real draft's autopilot, the mock bot, and the
   displayed Rank column are all driven by one formula, expressed twice
   (TS + SQL, as the codebase already does for this exact function) rather
   than three times independently.

### UI

- New column, header **"Rank"**, in the Players tab table
  (`draft.module.css` / `DraftRoom.tsx`'s `PlayerRow`), sized to match the
  existing 60px stat-column pattern.
- Shown for every player, including `isNewToPrem` players who currently
  render a single "NEW" cell instead of GP/Pts/PPG/Avg — Rank still
  displays for them (this is exactly the case the confidence weighting is
  for).
- Default sort on entering the Players tab changes from `total_points` to
  Rank, so a manager who hasn't touched anything sees the recommended
  order first.
- When `fpl_status` isn't `'a'`, the real `fpl_news` text (e.g. "Achilles
  injury - Unknown return date") renders as small red subtext under the
  player's name in the sticky column — already-synced data, no new sync
  work — so the specific severity is visible to read, not summarized into
  the number.

## Open implementation questions

- Exact constants (`GAMES_FLOOR`, `INJURY_MULT`, `DOUBTFUL_MULT`) — propose
  sensible defaults in the implementation plan; not load-bearing enough to
  block design approval.
- Whether `qualityScore`/`rank` gets persisted (e.g. a column refreshed
  alongside `player_rankings`) or computed on each `loadDraftPool` call —
  `loadDraftPool` already wraps its heavy scan in `unstable_cache`
  (60s revalidate), so computing it inline there is likely sufficient
  without a new persisted column; confirm during planning.
