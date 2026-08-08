# League Home redesign — handoff

**Status as of 2026-08-08: APPROVED AND IMPLEMENTED.** The prototype below is live in
`src/`. Read the "As implemented" section at the bottom before changing anything — a few
decisions were taken after approval that the prototype does not reflect.

Paste or `@`-reference this file in a fresh session to pick the work up.

---

## Where it stands

There have been two prototypes. **The second one is the live proposal.**

| | v1 (superseded) | v2 (current) |
|---|---|---|
| Where | project `a963f194-5dd5-46ff-b9e8-d6748cde6e21`, `League Home.dc.html` | project `f4858479-5b36-4ba3-9a4f-04da9725c7db`, `League Home.dc.html` |
| Design system | Gaffa 1.0 tokens copied from `globals.css` | **Gaffa 2.0**, sharing `gaffa.css` with the other 2.0 surfaces |
| States | 4 | **5** (adds the midweek market phase) |
| AA | fails in both themes | **passes, all 10 state × theme combinations** |

v1 is kept for comparison. Do not build from it.

**v2 link:** https://claude.ai/design/p/f4858479-5b36-4ba3-9a4f-04da9725c7db?file=League+Home.dc.html

---

## Why v1 was replaced

Duke's read was that v1 "kind of just implemented what we had previously, albeit in a more tasteful manner." A critique run (`.impeccable/critique/2026-08-08T04-06-12Z__design-2-0-league-home-handoff-md.md`, **25/40**) confirmed it structurally:

**Eight of the old page's nine widgets survived into v1.** One was cut (Academy); three things were new (attention strip, other fixtures, draw meter). The skeleton — KPI row, alert bar, hero scorebug, four competition tiles, other fixtures, standings, top-5 performers, activity rail — is the generic fantasy-league-home skeleton with Gaffa vocabulary applied on top.

The sharpest framing: PRODUCT.md names three claims a mainstream platform could not make. On v1, **twelve tactical positions** were five 7px squares, **contextual sigmoid scoring** was the number `18.94`, and **true dynasty** was one figure, `€218m`. The three things the product is built on were the three things the page rendered most weakly.

### Two structural diagnoses that drove v2

1. **v1 was organised around the league's week; home should be organised around your club's week.** Seven of nine regions answered "what is happening in the league" — which `/standings`, `/activity`, `/stats` and `/matchups` already do in more depth. Two answered "what is happening to me".
2. **The week has five phases, not four.** A gameweek is ~3 days of football and ~4 days of transfers. In v1 "Full time" persisted through all four of those market days showing a match report you read on Sunday night. `market` is that fifth state.

---

## What v2 does

### Structure

```
nav             (real TopBar shape: Home / Squad / League / Fixtures / Transfers / Activity)
masthead        YOUR CLUB is the h1 — not the league name
                4 figures, each carrying a stake rather than a label
attention       chores AND exposures, deadline-ordered, real empty state
hero            state-aware: build-up / live / full time / midweek / close of season
in the market   NEW — the biggest addition
on all fronts   four competitions as fixtures, not nouns
elsewhere       live and full time only
the table       real <table>, ten rows, with a prize column
your gameweek   NEW — replaces the league-wide top five
rail            the opponent (a person) · The Wire (5) · the club (dynasty)
```

### Widget-by-widget, against v1

**Kept:** attention strip (rebuilt as a list, empty state added, exposures added), live hero, full-time hero, close-of-season stage rail, the full ten-row table, The Wire (cut 10 → 5).

**Changed:**
- **Masthead** is now the club, not the league. "Points for" is gone — a raw cumulative nobody acts on, duplicated in the table 400px below. Figures now read `2nd · €34m if it holds`, `€7.5m · GW9–12 so far, €2.5m riding on Sunday`.
- **Build-up hero** drops form pips / avg-for / H2H (none actionable) for an **XI readiness strip** built out of the position spine — every slot in your shape, with doubtful, blank-fixture and no-cover players named.
- **On all fronts** states opponent, leg and stakes instead of "Quarter-final" / "Out".
- **The table** gains a `Pays` column from `computeSeasonPrize` — a pure function, zero queries — which is what makes it mean something in March.

**Cut:** the desk summary (a junk drawer: `Squad 23 of 25` is a My Club stat, `Unread messages 3` is a nav badge); "Elsewhere" in build-up (eight club names and eight em-dashes carrying nothing); close-of-season's final table and season's best (both belong to `/history`, and that space now carries departure decisions).

**Added:**
- **In the market** — `auction_state` is one indexed query and is already on the Realtime publication. Fills the four dead days and the dead rail at once.
- **Your gameweek** — replaces a league-wide top five (three of whom you did not own, none actionable, duplicating `/stats`) with your own best and worst rendered through 2.0's **baseline rule**: his ink against the median for his *own* position. This is the only place the scoring model becomes legible.
- **Full-time debrief** — `2 auto-subs fired, worth +11.30 · 1 starter blanked · +4.10 bench depth bonus · 0 OOP penalties`. Invisible mechanics that only ever existed in the box score.
- **The opponent as a person** — crest, manager, all-time head-to-head, one-tap DM. PRODUCT.md principle 3.
- **The club** — season number, trophies, finishes, retained slots. The dynasty layer, previously represented only by Club Balance.

### The margin meter

Rebuilt rather than cut. v1's could not express a defeat at all: `margin` was always a positive magnitude, so the marker leaned left whatever the result, and no prototype state exercised a loss. v2 passes a **signed** margin, makes the band and zero visible, labels the axis, and makes the verdict tense-aware — in play it names the distance to the *next* outcome (`Drawn · 6.57 more and you win`), which is the one thing the scores cannot say; once settled it states the result. **Live only** — at full time the result is settled and the meter has no job.

---

## Verification performed on v2

- **Contrast:** 35–53 selectors measured per state, **all 10 state × theme combinations pass WCAG AA.** (One apparent Dark/Build-up failure was a `.btn` colour-transition artifact; re-measured settled at 12:1.)
- **Mobile:** 375px renders at `scale: 1` with `scrollWidth == clientWidth`, no horizontal scroll. v1 forced a 566px minimum content width and browser zoom-out to 66%.
- **Detector:** `detect.mjs` → 1 finding, `monotonous-spacing` (~4px in 71% of literals). Judged a false positive for a dense Operate surface: the cluster is hairlines, chip gaps and tick widths, while section rhythm runs s2/s3/s4/s5/s8/s12.

### Three real bugs found and fixed along the way

1. **`gaffa.css`: `.g2 a` (0,1,1) beats `.btn-primary` (0,1,0)** — any anchor styled as a primary button renders accent-on-accent, i.e. invisible. Measured `rgb(20,107,64)` on `rgb(20,107,64)`. Patched locally in the prototype; **the fix belongs in `gaffa.css`.**
2. **Dark form pips**: white on dark's accent/danger fills measures 3.25 and 2.85. Fixed with dark ink, the same move `gaffa.css` makes for `.btn-primary` and every position `-on` token in dark.
3. **`.you` tag** violated gaffa.css rule 4 (a tinted ground takes primary ink only) and measured 3.85 in dark. Now primary ink.

---

## Decision taken this round

**v2 is built on Gaffa 2.0 (`gaffa.css`), not on 1.0 tokens.** Duke chose this explicitly. The consequence: implementing Home means landing 2.0's tokens in `src/app/globals.css`, which touches every other page. The alternative (spot-fixing 1.0's contrast) would have meant inventing a third palette that converged on 2.0 anyway, without its 110-pair verification.

---

## Implementation plan (agreed in principle, not started)

Unchanged from v1 in shape — follow the `buildTransfersModel` precedent:

1. **`src/lib/home/buildHomeModel.ts`** — one server-side read replacing the current 716-line page's inline fetch sprawl. Model on `src/lib/transfers/buildTransfersModel.ts`.
2. **Thin `page.tsx`**, but three things in the current file are load-bearing and must be preserved:
   - the **pre-draft early return** to `PreDraftLobby` for `status === 'setup' | 'drafting'`,
   - the **`ensureSeasonScaffold` safety net** (fires on zero matchups *or* zero tournaments — the cup check is deliberately independent; gating it behind "zero matchups" is what left two production leagues permanently cupless),
   - the **server-side score sync** calling `processMatchupsForGameweek` when the current matchup reads 0.0–0.0.
3. **Components** — `Masthead`, `Attention`, `Fixture`, `Market`, `Fronts`, `Matchweek`, `Table`, `YourGameweek`, `Opponent`, `Wire`, `Club`, plus `home.module.css`.
4. **Live updates** — `matchups` and `auction_state` are both on the `supabase_realtime` publication (migrations 104, 078). See `matchups/LiveMatchupCard.tsx` and `useLiveTransfers`.
5. **Retire** `TransferGazette.tsx` and `TopPerformers.tsx` once nothing imports them. Check `league.module.css` before deleting — `DraftOrderManager` still uses it.
6. **`npm run build` must pass** before declaring done.

### Data sources (verified against the live schema)

Free / already fetched:
- `league_standings` view (migration 031) — rank is `ROW_NUMBER()`, draw band baked in. Note `goal_difference` is actually points-for minus points-against; label it accordingly.
- `computeSeasonPrize(rank, N)` and the merit-payment helpers (`periodIndexForGameweek`, `computeMeritPayment`) are **pure functions, zero queries**.
- Lineup-incomplete is derivable from the matchup row already loaded (`isStoredLineupComplete` logic in `api/cron/fill-matchup-lineups/route.ts`).

One indexed query each:
- **`auction_state`** (`league_id, status='live'`) → `idx_auction_state_league_status`, `idx_auction_state_expires`. Gives current high, holder, bid count, `expires_at`. **The highest-value cheap add on the page.**
- `departure_decisions` (`team_id`, status in pending/return_pending) → has `decide_by`, the only true countdown in the schema.
- `trade_proposals` (`team_b_id = me`, pending) — note there is **no `expires_at`**; an offer sits pending forever.
- Cup tie: 3 chained queries (`tournaments → tournament_rounds` by GW window `→ tournament_matchups`). Pattern already in `matchups/page.tsx:209-227`.

Squad availability: `players.fpl_status` (`a|i|d|s|u`) + `pl_fixtures` (`season, gameweek`, clubs as slugs) via `src/lib/fixtures/lockout.ts`.

Dynasty: `season_standings_archive`, `season_cup_winners_archive`, `season_matchups_archive`, `player_season_clubs`. Trophy counts and all-time head-to-head are derivable **with no migration** at current row counts.

Needs work / migration:
- **Rank movement does not exist.** `team_stats` is an empty table. Derivable by replaying standings from the completed-matchups set, but that is real work — v1's handoff wrongly assumed it was free.
- **Market value history does not exist** — no table records prior values.
- Worth adding: `(season, gameweek, fantasy_points DESC)` on `player_stats`, `(league_id, processed_at DESC)` on `transactions`, `(season, gameweek)` on `pl_fixtures`.

### Bugs in the CURRENT page, to fix or delete on the way

1. `page.tsx:698` reads `tournaments.current_round` — **not a column.** Every active cup renders "Round 1".
2. `TransferGazette.tsx:22-30` switches on `waiver_win`, `faab_signing`, `bid`, `ir` — **none are `transaction_type` enum values.** The coloured kickers are dead code.
3. `generators.ts:258` says transfer-out compensation is "80% of his original market value"; the real rate is **60%** (`COMPENSATION_RATE`).
4. `generators.ts:246` says a dropped player gives others "48 hours to claim on waivers" — no such rule exists in the auction timer.
5. Home's "SPENT THIS SEASON" counts only `waiver_claim` + `drop`, ignoring 14 of the 16 transaction types. `finance/page.tsx:69-86` has the correct direction map.

---

## Domain rules the design depends on

All verified against code:
- Draw band is **±10** (`DRAW_THRESHOLD`, `matchupProcessor.ts`).
- Cups **never draw**; level ties go to the best individual performer, then bracket seed.
- **Two independent lockouts** — formation locks at any squad player's kickoff; a player locks at his own club's kickoff. The build-up XI strip renders both.
- IR gates **bidding**, not roster space.
- Placement prizes 40 → 20; Champions Cup 50/20; League and Consolation 25/10.
- Bench Depth Bonus 25%; a rating of 5.84 or less scores exactly zero.

---

## Related memory

- `feedback_prototype_then_implement_faithfully.md` — prototype first, then port 1:1.
- `project_gaffa_design_system_2_0.md` — the 2.0 system, now the basis for this page.
- `project_gaffa_dark_theme_accent.md` — the running app is the source of truth, not design artifacts.


---

## As implemented (2026-08-08)

Shipped on branch `redesign/league-home`. `npm run build` and `tsc --noEmit` both clean.

### Files

- `src/lib/home/buildHomeModel.ts` — the whole page in one server-side read.
- `src/app/(dashboard)/league/[leagueId]/_home/` — `home.module.css`, `Masthead`,
  `Attention` (client, for dismissal), `Fixture` + `SeasonClosed`, `Sections`
  (Market / Fronts / Matchweek / StandingsTable / YourGameweek), `Rail`, `Countdown`.
  The `_` prefix is Next's private-folder convention: it keeps the directory out of the
  route tree, which the build output confirms.
- `page.tsx` — 716 lines to ~170. All three load-bearing behaviours preserved: the
  pre-draft early return, the `ensureSeasonScaffold` net with its cup check still
  independent of the matchup check, and the 0.0–0.0 score sync.
- `TransferGazette.tsx` / `TopPerformers.tsx` retired. `league.module.css` STAYS —
  `fixtures/page.tsx` still imports it.

### Changes made after the prototype was approved

1. **The spine is one fill per position across both themes, with white ink throughout.**
   Duke's call. Dark previously lightened all twelve fills and used dark ink, which made a
   position a different colour per theme. White needs the fill at luminance <= 0.183, so
   the fill cannot lighten for dark; the KEYLINE carries the edge instead, derived to 4.0:1
   against whichever of the dark page and card is harder.
2. **Wingers reverted to 1.0's deep sage `#2F7A4E`**, not 2.0's terracotta. Duke's call.
   The cost, recorded not argued: sage sits near the accent, which under the colour law
   means "Gaffa, and yours", so a winger badge reads adjacent to ownership on surfaces that
   tint your own row green.
3. **Goalkeeper is `#9E6D00`.** At `#D4A017` it sat at luminance 0.42 against a spine
   otherwise at 0.10–0.17 — the one pale badge, and the only one that needed dark ink
   (white on it was 2.23:1).
4. **Attention items are dismissible**, keyed on `id + text` rather than `id`, so
   dismissing "Outbid at €46m" hides that fact but a raise to €52m brings it back.
   localStorage per league, with a restore affordance.
5. **The bench-cover warning only fires where the starter is also at risk.** Four bench
   slots cannot cover twelve positions, so flagging every uncovered slot meant five or six
   warnings a week. It now reports the intersection — this man may not play and nobody can
   replace him — shows the bench, and states the rule. Computed from `POSITION_FLEX_MAP`,
   the engine's own map, so it cannot drift from the auto-sub that really runs.
6. **The Wire renders through `renderBoldedText`.** Printing the raw string leaked the
   generators' `**…**` markers and the `p:{id}:{Name}` player token.

### Design-system changes that reach beyond this page

- `globals.css` gained the 2.0 tokens ADDITIVELY: new roles (`bg-inset`, `border-strong`,
  `accent-ink`, `live`, `warning-text`, the tints), the full position spine with
  `-on`/`-line`, and the `--t-*` / `--s*` / `--r-*` scales. `--color-text-muted` was
  corrected in both themes (it was 2.73–2.94:1).
- `--color-warning` was deliberately NOT repurposed: eight stylesheets use it as a FILL
  with dark ink on top. Warning-as-text is the new `--color-warning-text`.
- `PositionBadge` now reads the three per-position tokens instead of hardcoding
  `color:#fff` on all twelve. That hardcode was the reason GK's fill could never move.
- `calculateTeamScore` gained an OPTIONAL detail out-param so the full-time debrief comes
  from the same call that produces the score. Every existing caller is untouched.

### Two bugs fixed on the way

- `page.tsx` read `tournaments.current_round`, which is **not a column** — every active cup
  rendered "Round 1" forever.
- The first implementation would have labelled an unplayed fixture "settled". Matchday
  Militia has zero completed matchups, so it hit this immediately. Preview-vs-report is now
  decided by the fixture, not the phase.

### Known divergence

`gaffa.css` in the design project still carries 2.0's terracotta wingers and dark-ink
badges, so **the prototype no longer matches the app** on the spine. The app and
`verify-palette.mjs` are the source of truth; sync the prototype when convenient.

### ⚠ `verify-palette.mjs` was destroyed and rebuilt

During implementation a scripted whole-file edit corrupted it, and it was untracked, so
there was nothing to restore. The palette itself was never at risk — it lives in
`globals.css` and `gaffa.css`. The rebuild keeps the same contract (report by default,
`--emit` prints the token block) and re-derives the pairs from README.md's rules; it now
checks **160 pairs, all passing**. If the original checked something this one does not, it
is worth re-adding. The rebuild also caught a real bug the original had: keylines were
derived against the page only, but badges mostly sit on cards, which in dark is lighter.
