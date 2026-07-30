# Gaffa Economy Rebalance — Design

**Date:** 2026-07-29
**Status:** Design approved, not implemented
**Scope:** Club Balance economics — income timing, income size, money recirculation, and three audit fixes found while auditing.

---

## 1. The problem

Gaffa's Club Balance is not behaving like a currency. Three findings from a full trace of every money movement in the codebase:

**Nothing is earned during the season.** Of the 13 `transaction_type` values, only three create new money: `prize_payout`, `transfer_out`/`transfer_compensation`, and `rebate`. Prizes pay at the offseason reset. Departure compensation lands in the summer window. Everything else — sale proceeds, loan fees, loan bonuses, recall penalties, trade cash — moves money between managers without creating any. So across 38 gameweeks of live play, the **only** new money entering a league is the initiator rebate, capped at €5m per auction (`062_severance_rate_update.sql`: `LEAST(FLOOR(v_winner_bid * 0.2), 5)`).

**Spending permanently destroys liquidity.** A winning free-agent bid is deducted from the winner and credited to nobody. Severance fees and the loan slot buyback are the same — migration `060_player_loans.sql:540` comments the buyback as *"Deduct and burn fee."* So a €90m signing doesn't just cost the buyer; it removes €90m from the league forever. That is why a big signing feels unrecoverable: your squad is only sellable if someone else still holds cash, and every large transfer makes that less true.

**The market is oversupplied, so money is rarely *needed*.** A 6-team league rosters 120 of the ~565 Premier League players in `scripts/players.json`, leaving 445 free agents. The bid floor is 20% of market value, so passable cover costs €2–5m. You can field a legal, competitive XI indefinitely without spending. Money only matters at the very top of the market.

### What was ruled out, and why

- **A recurring wage bill / contracts.** Maximum realism and the only structural cure for inflation, but rejected: it complicates the game and punishes owning players.
- **Transfer windows.** Rejected for a correct reason — free-agent auctions *are* Gaffa's waiver mechanism, so gating them would break routine roster management in order to manufacture scarcity.
- **Anti-snowball slot bonuses** (scaling academy or loan-in caps by finishing position) and **promoted-player exclusivity enforcement.** Out of scope; the existing promoted-player exclusivity will be removed separately by the owner.
- **Emergency short-term loans.** Deferred, not rejected. The pain it solves is already largely covered (IR parks injured players free, and free agents are abundant and cheap), while the build is large: a new occupancy rule, FPL fitness-change detection, an expiry sweep, and interactions with auto-subs, the bench depth bonus and taxi promotion.
- **Public/unsolicited bids for rostered players.** Dropped. A cash-for-player offer is already a legal trade — `trades/route.ts:174` states *"Cash counts as substance"* — and §7's league-wide Stats page deliberately removes the information asymmetry that would justify rewarding whoever "surfaced" an owned player.

---

## 2. Data the design is calibrated against

From `scripts/players.json` (Transfermarkt scrape): 565 players, €12,717m total market value, median €16m, p95 €70m, max €220m, 71 players ≥ €50m.

> **Data caveat.** That file contains only 19 clubs and includes Coventry and Hull, so it is a partial or stale scrape. Every figure below is directional, ±10%.

**Squad market value per club** — modelled by simulating drafts as market-value rank plus noise, since managers draft on fantasy value rather than price:

| Draft model | Squad MV per club (6-team) |
|---|---|
| Strict top-120 by MV | €1,172m (upper bound) |
| MV rank + 25% noise | €1,047m |
| MV rank + 40% noise | €942m |
| Purely random 120 | €450m (lower bound, unrealistic) |

**Current income** is €88m/team/season for a 6-team league (€528m total: €398m regular season + €130m cups), and stays remarkably flat across sizes — €93m at 8 teams, €88m at 10 — because `computeSeasonPrize()` is league-size-agnostic.

**The calibration test.** A big Premier League club carries ~€1,000m of squad value and nets ~€100–150m a year in transfers, i.e. **10–15% of squad value.** Since Gaffa has no wage bill, net transfer spend is the correct comparison rather than revenue. Gaffa currently pays **7.5–9.4%** of squad value — the bottom edge of realistic. **Conclusion: the income level is roughly right and must not be cut.** The problems are timing and recirculation, not size.

---

## 3. Design

### 3.1 Monthly merit income

Move the regular-season prize pool out of the offseason reset and pay it during the season on match results.

**Rates:** **Win €2.5m / Draw €1.5m / Loss €0.5m.**

Two properties make these the right numbers:

- `win + loss = 2 × draw`, so **every match pays out exactly €3.0m regardless of result.** The season's total outlay is therefore deterministic and needs no budgeting slack.
- A draw pays *less than half* a win. §5 of the user guide argues the 10-point draw band exists because a narrow margin is noise in the rating engine rather than a result — so a coin flip should not pay like a win. The number carries the rule.

**Cadence: monthly, not weekly.** This is the fix for the objection that "€2.5m for a whole week feels like nothing." Cadence is independent of totals — batching identical money into ten statements a season turns a rounding error into an event. Real clubs receive broadcast and merit money in instalments, not per match.

| Month's results (4 matches) | Payment |
|---|---|
| 4W | €10.0m |
| 3W 1D | €9.0m |
| 2W 1D 1L | €7.0m |
| 1W 1D 2L | €5.0m |
| 4L | €2.0m |

**Payment schedule:** pay after every 4th completed gameweek — GW4, 8, 12, 16, 20, 24, 28, 32, 36 — plus a final settlement covering GW37–38. Ten payments per season. Periods are counted in gameweeks rather than calendar months, so the schedule needs no fixture dates (see §7.1).

**Trigger:** hook the payment into gameweek resolution. When `matchupProcessor` completes gameweek *n* and `n % 4 === 0 || n === 38`, pay that block. Do not add a separate cron — `vercel.json` does not schedule every `/api/cron/*` route, and a payment that silently never fires is worse than one tied to the resolution it depends on.

**Byes.** `schedule/generator.ts:9` inserts a virtual BYE team for odd league sizes, so a club can have no fixture in a gameweek. **A bye pays the draw rate (€1.5m).** Detect it as the absence of a matchup row for that team in that gameweek, not as a loss.

**Idempotency — must be strict.** `prizeDistribution.ts:216` documents itself as *"idempotent in spirit but NOT strictly protected from double-pays."* Do not repeat that. Create a `merit_payments` table with a `UNIQUE (league_id, season, period_index)` constraint and insert the row in the same transaction as the balance credits, so a re-run is rejected by the database rather than by a caller's discipline.

**Per-team season earnings** (38 matches, 6-team league):

| | Champion (24-8-6) | Mid (15-9-14) | Bottom (7-8-23) |
|---|---|---|---|
| Monthly merit | €75m | €58m | €41m |

### 3.2 End-of-season placement money

The regular-season curve stays, but shrinks and flattens: the merit component is now paid monthly, so what remains at the reset is mostly central revenue with a modest tilt.

**Curve: €40m for 1st → €20m for last, a 2:1 ratio** (today it is €85m → €50m, 1.7:1 — but that pool was carrying the whole merit load).

Implementation is a two-constant change to the existing `computeSeasonPrize(rank, totalTeams)` in `prizeDistribution.ts:43`. The exponential shape is retained; only the endpoints move from 85/50 to 40/20:

```
40 × (20/40)^((rank−1)/(N−1))
```

| N | Curve | Pool |
|---|---|---|
| 6 | 40 / 35 / 30 / 26 / 23 / 20 | €174m |
| 8 | 40 / 36 / 33 / 30 / 27 / 24 / 22 / 20 | €232m |
| 10 | 40 / 37 / 34 / 32 / 29 / 27 / 25 / 23 / 22 / 20 | €289m |

**Why 2:1 and not steeper.** A 5:1 placement curve produces a **€74m gap in total annual earnings** between champion and bottom club — €370m of divergence over five seasons, in a league where money never resets. At 2:1 the gap is €54m. Note it is still wider than today's €35m and cannot be made narrower without going regressive: paying on weekly results is inherently more variable than paying on final rank, and monthly merit alone accounts for €34m of it.

The supporting argument is the real one: the Premier League's central distribution is mostly an **equal share**, with merit a minority slice. In this design the merit slice is the monthly money — a champion already out-earns a bottom club €75m to €41m on results alone. Prestige differentiation is carried by the cups, which are lumpy, earned, and uncorrelated with league position.

### 3.3 Cup prize rebalance

`DEFAULT_PRIZE_CONFIG` currently pays `consolation_cup_winner: 60` — identical to the Champions Cup. In an 8-team league that hands the 7th-placed club €60m for winning a single game against 8th, out-earning most of the table. Replace with a config that preserves a hierarchy:

| Key | Current | New |
|---|---|---|
| `champions_cup_winner` | 60 | **40** |
| `champions_cup_runner_up` | 20 | **15** |
| `league_cup_winner` | 40 | **20** |
| `league_cup_runner_up` | 10 | **8** |
| `consolation_cup_winner` | 60 | **20** |
| `consolation_cup_runner_up` | 25 | **8** |

Consolation is set level with the League Cup rather than above it. Note that in leagues of 4–6 teams the Consolation Cup is seeded with placeholder slots (`createTournaments.ts:115`) and never resolves, so it pays nothing there.

### 3.4 Recirculation — the core change

**Free-agent bids, severance fees and the loan slot buyback stop being fully burned. A share returns to the league.**

Football does this twice over: FIFA's solidarity mechanism distributes a slice of every transfer fee to a player's former clubs, and the Premier League's central pot is largely an equal share. Gaffa's version is the equal-share model funded by its own transfer activity.

**σ (`solidarity_share`) = 20% of the winning bid.**

Split **50/50**:

- **10% of the bid to the auction initiator** (the first *manager* to bid on that player) — uncapped. This is the Scout's Fee.
- **10% of the bid split equally among all other non-winning clubs.**
- **The remaining 80% burns**, preserving a genuine drain.

**Worked example** — 6-team league, winning bid €90m: pool €18m. Scout takes €9m. The other four clubs take €2.25m each. €72m burns. The winner still pays €90m; their cost is unchanged.

| Winning bid | Scout's fee | Today's rebate | Each other club (6-team) |
|---|---|---|---|
| €20m | €2.0m | €4.0m | €0.50m |
| €40m | €4.0m | €5.0m | €1.00m |
| €60m | €6.0m | €5.0m | €1.50m |
| €90m | €9.0m | €5.0m | €2.25m |
| €150m | €15.0m | €5.0m | €3.75m |

**This replaces the initiator rebate entirely.** Today's rebate is `LEAST(FLOOR(bid × 0.2), 5)` — capped at €5m, which makes it worthless precisely on the deals where scouting mattered most: surfacing a €150m signing pays the same as surfacing a €25m one. The new fee is worse below €50m and better above it, which is the right shape — the reward should scale with the price you helped drive.

**Why σ = 20% and not higher.** After this change, free-agent bids are the *only* remaining sink, so σ directly controls whether money grows without limit. σ sets the league-wide signing spend required to break even:

| σ | Break-even signing spend per team per season |
|---|---|
| 0% (today's full burn) | €119m |
| **20%** | **€149m** |
| 25% | €158m |
| 33% | €178m |
| 50% | €238m |

*(All figures at the new 0.6 departure-compensation rate from §3.5, 6-team league. At today's 0.8 rate they are roughly €7m/team higher.)*

A *busy* season is 5–8 signings per manager — roughly €120–160m at €20m average, far less if people buy cheap depth. At σ = 1/3 the league would need €178m per team every year forever to stay balanced, which will not happen, so money would compound indefinitely. 20% is close to the ceiling.

**Scope.** Applies to:
- Free-agent auction winning bids (no seller exists, so the money currently vanishes)
- Severance fees on drops — both the auction-win path in `resolve_single_player_auction_rpc` (062) and the standalone path in `executeDrop.ts:52`
- The loan slot buyback fee (`060_player_loans.sql:540`)

**Does not apply to** listing sales, trade cash, loan fees, loan bonuses or recall penalties. That money already goes to another manager, so it is circulating; taxing it would suppress exactly the liquidity this change exists to protect.

**Edge cases:**
- Initiator wins the auction → no Scout's Fee; the full 20% splits equally among all other clubs. Mirrors the existing condition at `062`: `v_initiator_team_id <> v_winner_team_id`.
- No manager initiator (system-seeded auction whose only bidder wins) → same as above.
- **Rounding.** `teams.faab_budget` is `INT`. Compute `pool = FLOOR(bid × σ)`, `scout = FLOOR(pool / 2)`, `each_other = FLOOR((pool − scout) / (N − 2))`. Any remainder burns. Never distribute fractional millions; `compensation.ts:24` documents why rounding on this column must be explicit rather than incidental.
- Bids small enough that the pool floors to 0 → no payments, no transaction rows.

**Self-policing note.** Spamming minimum first-bids across many auctions to farm Scout's Fees risks *winning* players you did not want at full price, and `auctions/bid/route.ts:263` already forces every pending bid to nominate a different drop player, bounding how many a full roster can hold. The behaviour it does encourage — opening auctions on players you are unsure about — is market activity, which is the goal.

**New transaction type:** `solidarity_payment`. Surfaces as its own Finance category and an Activity feed line.

### 3.5 Departure compensation: 0.8 → 0.6

`departure_compensation_rate` (migration 069) drops from 0.8 to 0.6, and the `COMPENSATION_RATE` fallback in `compensation.ts:34` follows.

Two reasons.

**It funds the recirculation.** Departure compensation is the second-largest faucet in the system — roughly €152m a season for a 6-team league at 0.8, comparable to the entire placement pool. Crucially, it is money *invented*, whereas recirculation moves money that already exists. Trading printed money for recycled money is strictly better: the league's liquidity then comes from its own transfer activity rather than from nothing.

**It repairs a mechanic that is currently one-sided.** `compensation.ts:24` documents that retaining a departed player is rational only when P(returns to PL) exceeds `rate ÷ auction premium`, and notes that at a rate of 1.0 *"retention is never the right call."* At 0.8 it is nearly as lopsided — the cash is good enough that releasing is almost always correct, which leaves the Retained List (§13) close to dead weight. At 0.6, holding rights becomes a genuine decision.

### 3.6 Starting balance: hold at €250m

Two independent anchors support €250m, and it should **not** scale with league size, since per-team income is flat across sizes:

- **Share of drafted squad value:** 21% (6 teams), 24% (8), 27% (10). Real clubs spend roughly 15–25% of squad value per window-year.
- **Years of income:** €88–93m/team/season, so €250m is 2.5–3 seasons of income.

**The governing principle for future tuning:**

> **The starting balance is safe to change. The income rate is not.** Raising the start is a one-time bump that never compounds. Raising the monthly rate adds money *every season forever*, and compounds in a league that never resets.

So under uncertainty, be generous with the stock and conservative with the flow. If a season runs and everyone is broke, raise the starting balance or make a one-off central-revenue payment, with no long-term consequence. Mild inflation is the correctable failure mode; an over-tight economy requires a rate change that compounds.

---

## 4. Resulting ledger

With σ = 20% and departure compensation at 0.6:

| N | Monthly | Placement | Cups | Total | Per team | In-season share |
|---|---|---|---|---|---|---|
| 6 | €342m | €174m | €83m | €599m | €100m | 57% |
| 8 | €456m | €232m | €111m | €799m | €100m | 57% |
| 10 | €570m | €289m | €111m | €970m | €97m | 59% |

Plus departure compensation of roughly €114m a season for a 6-team league at the new rate.

**Break-even league-wide signing spend: ~€149m per team per season.** That balances at the top of a busy season and drifts upward mildly below it. This is accepted rather than optimised further, per the stock-versus-flow principle above.

**Every rate is a league setting** — `merit_win`, `merit_draw`, `merit_loss`, `solidarity_share`, `scout_share`, `prize_config`, `departure_compensation_rate` — so year two is tuned on real data rather than on the estimates in this document. The Finance page gains a **net money created vs destroyed** readout per season, which is the measurement that makes that tuning possible.

---

## 5. Audit fixes included

**5.1 `018_update_faab_default.sql` sets the column default to 500.** `leagues/create/route.ts:30` passes `faabBudget ?? 250`, so any `teams` row inserted without an explicit value starts at double the intended balance. Migrate the default to 250.

**5.2 Bid commitments are not tracked in aggregate.** `auctions/bid/route.ts:67` validates each bid against the team's *current* balance with no awareness of other outstanding bids, so a manager with €250m can hold €250m top bids on three simultaneous auctions. The resolver then re-checks affordability per auction (`062`) and walks down to the next bidder, so nothing overdraws — but the manager silently loses auctions they believed they had won.

*Recommended fix is disclosure, not a hard block.* Bidding on several players while expecting to win one is legitimate behaviour, so blocking it would be worse than the current state. Surface committed-versus-available on the bid UI (*"€180m committed across 3 open bids, €250m balance"*) and warn when total commitments exceed the balance. Flagged here as a deliberate choice rather than an oversight.

**5.3 Dead points penalty at `matchRating.ts:454`.** `if (rating < 3.0) finalPoints -= 2.0;` is unreachable — by the time the scoring rating is below 3.0 the curve already yields 0, and the trailing `Math.max(0, …)` clamps the subtraction away. Delete it. This is item 3 of `docs/drafts/OPEN_RULES_QUESTIONS.md`.

---

## 6. Files affected

| Area | Files |
|---|---|
| Merit income | new `merit_payments` migration; `src/lib/scoring/matchupProcessor.ts`; new `src/lib/economy/meritPayments.ts` |
| Placement curve | `src/lib/offseason/prizeDistribution.ts` (`computeSeasonPrize` endpoints, `DEFAULT_PRIZE_CONFIG`) |
| Recirculation | migration superseding `062_severance_rate_update.sql` (`resolve_single_player_auction_rpc`); `src/lib/roster/executeDrop.ts`; `060`'s `execute_loan_slot_buyback_rpc`; new `solidarity_payment` enum value |
| Departure rate | migration for `leagues.departure_compensation_rate` default; `src/lib/transfers/compensation.ts` |
| Settings & ledger | `leagues` columns for merit/solidarity rates; `src/app/(dashboard)/league/[leagueId]/finance/page.tsx` |
| Audit fixes | migration for `teams.faab_budget` default; `src/app/(dashboard)/league/[leagueId]/players/TransferMarketClient.tsx`; `src/lib/scoring/matchRating.ts` |
| Docs | `docs/USER_GUIDE.md` §8, §11, §13, §14 and the Quick Glossary |

Migrations are applied by hand in the Supabase SQL editor, so none of this is live until they are run. `npm run build` must pass before the work is considered done — it is the only correctness gate in this repo.

---

## 7. Resolved decisions

**7.1 Monthly period boundaries — 4 gameweeks.** Periods are counted in gameweeks, not calendar months: payments at GW4, 8, 12, 16, 20, 24, 28, 32, 36, plus a final settlement covering GW37–38. Ten periods, deterministic, no dependency on fixture dates. `period_index` in `merit_payments` is 1–10.

**7.2 Buy Now with no prior bidder — the full 20% splits equally among all other clubs.** A Buy Now resolves inline (`auctions/bid/route.ts:340`) and may have no earlier manager bid, so there is no scout to pay. This is the same rule as the no-initiator edge case in §3.4; no special handling is needed beyond ensuring the resolver treats "no manager initiator" and "initiator is the winner" identically.

**7.3 No migration path is needed.** Gaffa has not yet run a league with human managers, so there is no in-progress season to protect and no historical balance to reconcile. The new rates apply unconditionally from the first gameweek they are live.

Explicitly **not** building: backfill of merit payments for already-resolved gameweeks, and any `legacy_prize_curve` flag to preserve the old €85m → €50m curve for a season in progress. Should a real league ever be mid-season during a future rate change, the rule to adopt is "payments start at the next 4-gameweek boundary, no backfill, and the season in progress keeps the curve it started under" — recorded here so it needn't be re-derived, but not implemented now.
