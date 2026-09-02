# Transfer Deadline Update — changelog source

**Drafted:** 2026-09-01
**Covers:** everything since the last published update,
`trophy-cabinets-match-breakdowns` (2026-08-27 08:07 UTC).
**Assembled from:** 31 unannounced commits on `main` (2026-08-27 11:48 →
2026-08-29 23:53), 24 commits on `feat/futbolpedia-outlooks`, and the
uncommitted working tree.

Written to the house format in `docs/superpowers/specs/2026-08-26-changelog-updates-design.md`:
lead feature first, quieter fixes below, no internals named, dated not numbered.

Part 1 is the post, ready for `product_updates`. Part 2 is the inventory it was
drawn from. Part 3 is the launch order.

---

# Part 1 — The post

```
slug:       scouting-reports-player-profiles-deadline-day
title:      Scouting Reports, Player Profiles, and Deadline Day
summary:    Scouting reports and a page for every player, rosters up to 22, €30m for every club, and auction length now set by market value.
is_major:   true
highlights: [
  "A written scouting report on every player",
  "A page per player, and three ways to browse the pool",
  "Auction length now set by market value, and none settle overnight",
  "Roster size 20 to 22, and €30m for every club"
]
```

`highlights` is new — migration 150, nullable, applied. The announcement modal
rendered only title and summary, so a release with four distinct things in it
arrived as one sentence and whichever part did not fit went unmentioned until
someone opened `/updates`. An entry with no highlights renders exactly as it
does today.

> Coverage is complete — 426 of 426 regulars carry a 0.3.4 outlook, so "every
> player" is literally true. The partial-coverage alternate in §3.4 is no longer
> needed; keep it only if the pool grows before you publish.

---

## Scouting reports

Every player now carries a written outlook from Futbolpedia: how he's used, how
secure his place is, what to expect week to week, and where he is in his career.
It's written from match data, minutes, set-piece duty, and transfer news. It
doesn't read your league's points and it doesn't give bid advice.

Each player also carries tags you can filter on — quality, how nailed-on he is,
dynasty value, and risks to watch.

## Player pages

Every player has his own page. The left side is football: the scouting report,
minutes and starts, goals against xG, assists against xA, set-piece order, and
his xGI/90 percentile among players in his position. The right side is your
league: points, PPG, rating, owner, and this week's fixture.

Switch seasons and both sides move together.

## Players, three views

The **Players** tab replaces Stats and opens three views of the same pool.

- **Cards**, the default. Each card leads with the first line of that player's
  scouting report. Filter by quality, minutes role, and **Watch for** — the
  first way to ask who's leaving the Premier League.
- **Table**, the old stats table, now with a gameweek filter.
- **Explorer**, a scatter plot on any two of eight stats. Opens on market value
  against PPG. Tap a dot for the player.

## Roster and budget

Roster size increased from 20 to 22. Every club gets €30m.

There's a blockbuster hitting the auction board at midday to spend it on.

## Auction timing

Auction length now depends on the player's market value:

| Market value | Minimum length |
|---|---|
| Under €25m | 12 hours |
| €25m–€50m | 24 hours |
| €50m–€80m | 48 hours |
| €80m+ | 72 hours |

After the last bid, a lot ends on inactivity, and that window shortens as the
auction ages: 6 hours on day one, 4 after two days, 2 after three, 1 after four.
Any bid resets it, so you can't be sniped.

Nothing settles between 11pm and 8am — those lots move to midday. Exception:
an uncontested weekend lot under €20m settles at 6:45am, before the early
kickoff. Auctions over €50m now open at midday instead of whenever the overnight
sync runs.

## Also new

- The Club Balance pill opens a dropdown with every club's balance.
- First-season cup brackets seed at gameweek 7 instead of straight after the
  draft. Leagues with a previous season still seed from real standings.
- League Home's market board is a table, and shows how many of your opponent's
  players are still to play.
- The fixture strip is day tabs with club badges, on the correct gameweek.
- Message an opponent from their card on League Home.
- The chat widget opens from the top bar on every page.
- Search ignores accents: "munoz" finds Muñoz, "odegaard" finds Ødegaard.
- Players show the name you'd actually call them.
- Gameweek switching on Matchups is instant.
- Stats, Players, and My Club remember your view, sort, and filters.
- New signings show N/A until their position and value sync, instead of a
  placeholder.

## Notifications

- Outbid notices say whether you were outbid directly or passed in the order,
  and everyone who bid before you is told.
- Auctions closing soon count down.
- The inbox folds repeated tags.
- Push notifications name the player or deal.
- Auction emails rewritten.

## Fixed

- New listings said 3 days to bid instead of 14.
- The auction modal quoted a 24-hour reset that no longer applied.
- The dashboard skipped to next week's deadline mid-gameweek.
- Matches under post-match review now count as finished on the fixture strip.
- Countering a trade offer hid the cash row.
- Unread notifications looked read on hover.
- Podium dividers, trophy cabinet margins, squad panel spacing, and column
  alignment on the market and auction boards.
- Mobile: pitch clipping, name truncation on auction cards, and full-height
  screens running off the bottom on notched iPhones.
- Closed a league data scoping hole.

---

# Part 2 — Inventory

Everything here is unannounced. All of it is now committed and merged to `main`
(merge `908528d6`); the working tree is clean and the build is green.

## 2.1 Flagship — Futbolpedia scouting, the hub, the index

Branch `feat/futbolpedia-outlooks`, 24 commits.

**New surfaces**

| Thing | Where |
|---|---|
| Player hub | `/league/[leagueId]/players/[playerId]` |
| Players index — cards / table / explorer | `/league/[leagueId]/players` |
| `Players` nav entry | `TopBar.tsx:233` |
| "Full profile →" from the player modal | `PlayerDetailsModal` |

**Hub.** Two-layer split carried in the data shape, not just on screen:
`football` is real-world only and portable back to Futbolpedia, `league` is Gaffa
scoring and never feeds the outlook. Availability read live from `fpl_status`,
never from the outlook (which can be 30 days old). Scouting panel with facet
chips, confidence, evidence gaps, and a dated Futbolpedia pin. Premier League
form: minutes, starts, start rate, goals vs xG, assists vs xA, xGI/90 with a
position-relative percentile bar. The bar renders for attacking positions only —
goalkeepers and defenders get an explicit line instead, because elite
centre-backs rank near the bottom of xGI and a bar would read as a verdict.
Set-piece duty from FPL. Season switcher driving both stat layers together; the
scouting report deliberately does *not* follow it and says so.

**Index.** Cards default, table preserved behind a toggle. Card carries the hub
in miniature. Filter rails on quality, minutes role, and "watch for". A player
with no outlook degrades to identity + tags + figures with a "not yet scouted"
marker and **no quality chip** — quality is a judgment, and inferring it from
output is what called an elite centre-back "limited". Gameweek filter applied at
the query, so every figure downstream describes that week.

**Explorer.** Eight metrics on either axis, market value on a log scale
(€0.20m–€220m), median crosshairs, quadrant labels generated from the axis names,
dots coloured by all twelve granular positions, click-through to the hub. The
minute floor scales with how far the season has run — a flat 450 emptied the plot
two gameweeks in.

**Engine.**
- Closed facet vocabulary. Was 158 free-text tags across 75 players, 110 of them
  appearing once; now seven closed enums.
- Facts computed, judgments judged. Set pieces, starts, appearances, minutes,
  availability, age and xG are computed from FPL and passed into synthesis as a
  locked playing record, so the judgment is made with them in hand.
- Style archetypes scoped to position — Ben White came back tagged "ball-playing
  cb". The permitted list is injected into the prompt *and* filtered on the way
  out, and both read paths filter too, so it stopped showing before any regen.
- Voice: banned fitness openers, fronted participials, "enters" as main verb, and
  the club as grammatical subject. Deterministic per-player opening angle.
  Temperature jitter finally passed a value.
- Grounded requests halved (1,728 → ~884): availability and transfer news merged
  into one query, and the head-coach query is about the *club*, so it's cached per
  club instead of repeating for every player at it.
- Real spend ledger, per UTC month, atomic, surviving crashes (migration 148).
- FPL bootstrap capture — set-piece orders, chance of playing, starts, minutes,
  xG block, ownership (migration 147).
- Priority regen slice: rostered and high-value first, grouped by club.
- `POST /api/admin/outlooks/regenerate`, `x-cron-secret` gated.

**Bugs only real data exposed.**
- xGI percentile read **50th for everyone** — the position-group rank was computed
  against the requested players, not the pool. Saka 50th → 90th.
- `player_season_clubs` holds 2025-26 only, so every current-season minutes sample
  was null. Current season falls back to `players.pl_team`.
- `population.ts` paginated — PostgREST truncates at 1,000 rows and `player_stats`
  crossed it at gameweek 2, so the pool was losing most of its appearance signal.
- `dynasty_value` re-tested age after `career_phase` had ruled — Tarkowski read
  nailed + plateau + declining_asset, two facets contradicting each other.
- `minutes_role` divided starts by all 38 club matches, conflating role with
  fitness. Palmer started 21 of 26 appearances and still read "likely starter".
- `career_phase` used flat age bands; now per position.

**UI fixes on the branch.** Card lede leaked a fourth line (clamp and padding on
one box; `overflow:hidden` clips at the padding edge). Portrait 44×44 → 66×78.
Quality chip misaligned from `g-namerow` misuse on a row with no name. Explorer
dots lost clicks to a 34px *square* target on a 300-point scatter — round now,
paint order smallest-last. Explorer names were bare surnames. Hub breadcrumb
404'd. "Full profile" unreachable under a tall card.

**Cross-app work that came out of it.**
- Accent-insensitive search across all eight search surfaces. 91 of 575 active
  players carry non-ASCII characters — 16% of the pool. NFD alone misses Ødegaard,
  Nørgaard, Groß, Đorđe and Kadıoğlu's dotless ı, so there's an explicit map
  pinned by tests. The free-agents filter moved out of Postgres.
- Display names: nine files called the helper on rows fetched without the fields
  it needs. Nineteen selects widened; thirteen players render differently.
- Anti-slop/mobile regressions, all four: `--shadow-glow` deleted from light theme
  only while dark still defined it and a component still consumed it, invalidating
  the whole `box-shadow`; `button:active:not(:disabled)` at specificity (0,2,1)
  outranking every component rule; that rule defeating an explicit reduced-motion
  opt-out; unread inbox rows reading as read on hover.
- Mobile: thirteen surfaces on `100vh` → `dvh`; two screens subtracting a
  hardcoded 56px instead of `--nav-height`, running ~43px off a notched iPhone;
  SquadPeek home-indicator clearance; 44px targets under `pointer: coarse`.

## 2.2 Main, unannounced — 31 commits

**Features.** Club Balances dropdown with a new teams route (`15d17059`).
**Cup seeding delayed to GW7** for first-season leagues (`a7820a84`) — ⚠️ rules
change, `docs/USER_GUIDE.md` needs it. Notifications overhaul: tiered transfer
copy, outbid prior-bidder fanout, closing countdowns, tag folding (`74675a2e`),
plus direct-outbid vs trailing-raise (`868f44fd`). Auction emails rewritten
(`411587ee`). Chat mounted at the dashboard shell (`c2eac022`). In The Market
board → 6-column table (`518d644b`) and a broader table/mobile overhaul
(`d0c964b0`). Opponent players still to play (`bdef6fd9`). DM from OpponentCard
plus taxi/IR swaps (`0716f475`). Fixture strip as day tabs with real badges
(`0e90372c`). Platform Admin folded into Settings (`b1dfad53`).

**Security — `946bbcbe`.** Five RLS policies compared `lm.league_id =
lm.league_id`, always true, letting any authenticated league member read every
league's draft picks, transactions, waiver claims and tournaments, and insert
chat into leagues they don't belong to. `pending_drops` separately had a
redundant policy exposing every team's pending drops. Both already applied live;
the commit records them as migrations 145/146.

**Fixes.** Listing countdown off the wrong window — "3d to bid" instead of 14
(`53b90926`). Stale 24h reset footnote (`c90c4a41`). Closing-now edge cases
(`1975bd09`). Push titles (`ed40a523`). Dashboard pinned to the finished gameweek
(`85ae93c1`). `finished_provisional` as full-time (`faf5299b`). Mobile pitch
clipping (`6b018d7a`). Cash row on counters (`7dba7e71`). Market auction query and
floor (`384bb9e5`, `3729f68e`). Five table-alignment commits (`567662d0`,
`f2a97d2f`, `dee7ad13`, `c255f74a`, `c0bd5e66`). Podium dividers (`74662440`).
Cabinet margins (`9c8b9258`). Squad peek chips (`c3eec26a`). Home hover colours
(`3bd38baf`). App icon green (`027cb9de`). Mobile refinements (`44b7721a`,
`e42981f4`, `0b9a3339`). SoFIFA alias collisions (`a71bc0b1`).

> `bdb602e5` (Help in its own dropdown) was already covered by the 2026-08-27
> post. **Don't announce it twice.**

## 2.3 Auction timer rework — `e3e3bc95`

Duke's commit, `src/lib/auction/timer.ts`. `expires_at = quietHoursGuard(max(first
+ tierFloor(marketValue), last + timeout(age)))`.

- **Market-value tiers** replace the flat initial floor: `<€25m` 12h, `€25–50m`
  24h, `€50–80m` 48h, `≥€80m` 72h.
- **Inactivity timeout decays with auction age**: 6h base, 4h past 48h, 2h past
  72h, 1h past 96h. Never zero — a zero timeout reintroduces a timeable instant.
- **Overnight protection**: a lot expiring in the deadzone is pushed to noon
  local; an uncontested weekend streamer (`<€20m`, one bid, Sat/Sun) goes to
  06:45 instead, ahead of the 07:30 ET kickoff.
- Both bid routes, `seedHighValueAuctions`, `seasonKickoff` and `executeDrop`
  updated; `timer.test.ts` substantially rewritten.

Two notes on it, neither a change I made:

1. The deadzone's start is **hardcoded at 23:00** (`minutes >= 23 * 60`) and
   OR-ed with the league's configured quiet window. Both alpha leagues run
   00:00–08:00 America/New_York, so their effective deadzone is 23:00–08:00 and
   the copy above says 11pm. But a league that configured, say, 02:00–06:00 would
   still get the 23:00 floor, which may or may not be what you intend.
2. The file's header comment says the deadzone is "11:00 PM – 8:00 AM" while
   `DEFAULT_QUIET_HOURS` reads `00:00`–`08:00` Europe/London. They only agree
   because of the hardcoded 23:00; worth a comment fix so the next reader isn't
   misled.

⚠️ **`docs/USER_GUIDE.md` documents the old 72h/24h timing** and needs this.

## 2.4 Formerly uncommitted — now on main

**Unsynced player handling.** `primary_position` nullable — migration
`148_nullable_player_primary_position.sql`, untracked on disk but already applied
live. `resolvePosition()` no longer guesses a default from `element_type`; a new
arrival with no curated override returns `null` and shows N/A until SoFIFA syncs.
Eleven files updated for a nullable position and market value. New
`playerMapping.ts` + tests.

**Admin visibility.** Non-admins see only fully synced players on Stats and
Players; site admins get a Sync status filter on both.

**View memory.** My Club (view/sort/filter), players index (cards/table/explorer),
stats table (minutes filter, position mode, sort) — `gaffa:`-prefixed keys, legacy
keys still written.

**Matchups.** `page.tsx` 391 lines → thin server shell, new `MatchupsClient.tsx`
holds state, `GameweekSelector` takes an optional `onSelectGw`. Gameweek switching
no longer round-trips. **User-facing speed win — it's in the post.**

**Effect.** `effect` ^3.22.1, `src/lib/effect/` (runtime, typed errors, service
layers), `docs/EFFECT.md`, `api/admin/effect-demo/`, `api-football/client.ts`
rewritten on it, CLAUDE.md updated to point at it. Yours — noted here only so the
commit boundary is complete.

**Worth a look before committing:** `Team.crest_config?: any` puts an `any` in the
type spine, and `autoPickEngine`'s percentile helper swapped a binary search for
`findIndex`, making it O(n²) on a draft-time path.

## 2.5 League operations

| Change | Value |
|---|---|
| Roster size | 20 → **22** (11 + 11; with 3 academy and 2 IR, 27 max squad) |
| Board grant | **+€30m** flat per club |
| Barcola | 48h blind auction, €65m clears the €50m threshold |

Both alpha leagues: Matchday Militia (`772588fc…`), Dynasty Dragoon (`1fcea2ba…`).
Flat grant preserves every spread — Pizzaking €277m → €307m against ChelsZ €141m
→ €171m, the €136m gap intact.

⚠️ The plan doc writes balances in `£`. Gaffa is `€` everywhere user-facing.

## 2.6 Changed in this session

- **Two voice defects and an encoding bug, closed over two sampling rounds.**
  See §2.6.
- **The forced competition clause.** Card blurbs aren't separate from the
  outlooks — the card lede is the outlook's first sentence. Two prompt lines
  caused it: the role-security opening angle read "who he is holding off", which
  presupposes a rival and is drawn by a sixth of the pool, and the coverage brief
  listed competition as a required part of Role. With no rival to name, the model
  negated the premise instead — "without any genuine squad competition pushing
  him", "leaving zero room for positional competition", "fending off squad
  competition". Angle now makes the rival optional, the brief asks only where one
  exists, and the ban list names all three constructions.
- `PIPELINE_VERSION` → **0.3.2**, with the package version realigned to it. Marks
  the 72 current rows stale so they regenerate against the fixed prompt.
- Verified after: engine 87 tests, app 388, build green.

## 2.7 Sample findings — 0.3.2 → 0.3.4

A 20-player sample, weighted toward the role-security opening angle (12 of 20,
including the six players whose 0.3.1 text carried the negated-competition
clause), read as a flat list rather than one at a time.

**Round one confirmed the competition fix and exposed a bigger template.** All
five negating openings were gone, and competition still appeared where it was
real — Kostoulas "competing alongside senior options", Wan-Bissaka "in direct
competition with Matty Cash". But **10 of the 12 role-angle players opened
"[Name] commands…"**, with "undisputed" / "unquestioned" / "untouchable" /
"absolute" behind it. 0.3.1 had used "holds an iron grip" for the same job, so
the verb was not new — removing the competition clause simply left it exposed.

The root cause was the angle asking for a *verdict* on security, which has one
obvious verb. Three changes: the angle now asks what he has **started, won or
displaced** rather than how firmly he holds his place; the gate rejects the whole
security-verb family (sparing a goalkeeper who literally commands his area); and
the prompt names the move, because a gate that only rejects sends the retry in
blind — three of twelve failed closed until the prompt was told.

**Round two: 12 of 12 passed, zero "commands", nine distinct opening verbs** —
started, claimed, built, established, secured, stepped, took over, arrived,
has started. Every lede now leads with evidence: "Kelleher started 37 Premier
League fixtures in his debut season", "Maatsen took over primary left-back duties
after Lucas Digne's departure", "Donnarumma claimed Manchester City's number one
jersey following Ederson's departure".

**Encoding bug found in the same pass.** One stored outlook read "Hugo
Ekitik&eacute;" — grounded search returns page text, and HTML entities were being
copied through into prose. 1 of 143 rows, so roughly three players at full pool
scale. Entities are now decoded in the engine before storage rather than at
render time, since the gate, the card lede, the hub and Futbolpedia all read that
string and only one of them is HTML. The test caught a real bug in the first
version of the decoder: entity names are case-sensitive, and `&Oslash;` (Ø) was
resolving to `ø`.

Pipeline **0.3.4**. Engine 94 tests, app 388, typecheck clean.

---

# Part 3 — Launch order

## 3.1 Before deploy — DONE

1. ✅ Working tree committed in six logical commits.
2. ✅ Duplicate migration 148 resolved — the nullable-position migration is now
   `149_nullable_player_primary_position.sql`.
3. ✅ Merged to `main` (`908528d6`). 386 tests pass, `next build` green.

Still outstanding: `main` has no remote push yet.

## 3.2 The regen — DONE

**426 of 426 regulars are at pipeline 0.3.4.** 0 failures, 0 low-confidence
rows, 0 HTML entities, average 95 words.

Opening verbs across the full pool, the measure that started this:

| Verb | Share |
|---|---|
| has | 8.5% |
| generates | 6.8% |
| started | 4.5% |
| reaches | 3.8% |
| completed | 3.5% |

A long tail under the ~20% ceiling, against 50% "commands" in the first sample.
The only three ledes containing "command" are goalkeepers described as having
"aerial command" — the noun, which the gate deliberately spares.

**Cost, measured:** the run cost **$10.36** — 932 grounded requests and ~5M
tokens for the first 401 players, plus ~75 requests for the last 25. Budget
roughly **$11 for a full-pool regen**, and note it is billed against a *monthly*
Google AI Studio project spend cap that resets on the 1st (PST).

**Two caps, not one — worth knowing before the next run.** Our
`OUTLOOK_MONTHLY_GROUNDED_CAP` counts grounded requests and never tripped
(finished at ~1,007 of 1,400). Google's project spend cap counts dollars, is set
in AI Studio rather than in this repo, and is what actually stopped the run at
401. The code has no visibility into the second one, so a batch can stop for a
reason the ledger cannot explain. If a future run halts with the ledger showing
headroom, check https://ai.studio/spend before debugging anything here.

The pipeline failed closed when it hit that wall: zero synthesis calls after the
first search error, so no player got an outlook built on empty search results.
That guard had never been exercised against a real outage until now.

## 3.3 Deploy and open the window

4. ✅ **Deployed.** `main` pushed through `20ca3a63`.
5. ✅ **League updates applied.** `roster_size = 22` on both leagues; +€30m on all
   12 clubs. Spreads preserved — Pizzaking's €277m → €307m against ChelsZ's
   €141m → €171m, the €136m gap intact. The three clubs that were at 25/25 can
   now transact without dropping first.
6. ✅ **Barcola's position.** LW, secondary RW — taken from
   `sofifa_position_reference`, which had him from a Ligue 1 scrape on
   2026-08-01. **No SoFIFA scrape was needed.** The cache could not reach him
   until the sync fix in this release: it was consulted only for brand-new rows,
   and his existing row held NULL, which the merge preferred every night.
7. ✅ **Barcola priced at €90m**, not the €65m the plan estimated. 325 values
   written in that run. Note the target filter includes every inactive player,
   so `--all` walks a few hundred rows at ~3s each and writes only at the end.
8. ✅ **Auction live in both leagues.** €90m clears €80m, so it is a **Tier 4,
   72-hour** lot, not the 48 the plan assumed: **opens 12:00 ET 2 Sep, closes
   12:00 ET 5 Sep.** Six test/demo leagues were also seeded, which is correct
   behaviour for `status = 'active'` and harmless; their times read 07:00 ET
   because they have no `auction_timezone` and fall back to London.
9. ⏳ **Publish the update** — insert the `product_updates` row (slug, title,
   summary, body, highlights, `is_major: true`), then fan out one notification
   per user with `kind: 'product'`. Per the changelog spec nothing publishes
   without your sign-off on the copy.

## 3.4 If you publish before the regen finishes

Replace the opening line of the first section with:

> Scouting reports are rolling out across the league now. Every rostered player
> and most of the market already carries one, and the rest are arriving over the
> coming days — a player who hasn't been scouted yet shows his record and tags
> without the write-up.

## 3.5 Also worth doing

- `docs/USER_GUIDE.md`: GW7 cup seeding, the 22-man roster, and the new auction
  timing (it still documents the flat 72h initial / 24h minimum).
- `docs/DECISIONS.md`: no entry for the +€30m grant or the roster expansion.

## 3.6 Open, not blocking

- `/stats` and `/players` both sit in the nav. Your decision was that the stats
  page becomes the hub rework; nothing retires or merges the old table.
- `output_profile` is in the hub spec's league rail and in no source file.
- The facets spec still reads `DRAFT — awaiting Duke's review`.
- Nothing refreshes outlooks on a schedule; they carry a 30-day TTL with no cron
  behind it.
