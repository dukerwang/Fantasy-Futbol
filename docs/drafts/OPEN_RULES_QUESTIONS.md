# Open Rules Questions

Behaviour that is undefined, self-contradictory, or looks unintended. Found while
documenting; **no code changed**. Each needs a ruling from you before it can be
written into the guide as a rule.

---

## 1. The hard ceiling reopens sniping on contested auctions

**Where:** `src/lib/auction/timer.ts:33` `calculateExpiresAt()`.

```
expires_at = min(first + MAX, max(first + 24h, last + 12h))
```

The `min()` against a fixed wall means the anti-snipe property is conditional.
While `last + 12h` is below the ceiling, every bid pushes the close out and
sniping is defeated. But once `last + 12h` exceeds `first + MAX`, `expires_at`
**freezes at the ceiling** and no further bid can move it. The auction becomes a
hard, publicly-visible deadline.

The exposed window is the final **12 hours before the ceiling** — hours 60–72 on
a standard auction, 84–96 on a €40m+ one.

**Why it matters:** the auctions that reach the ceiling are the contested ones,
so the protection fails exactly where it's needed. The UI also assists it:
`expires_at` is sent to the client and there is a facet labelled *"Closing inside
the hour"* that filters and sorts by imminent close, handing a sniper the target
list.

**Root cause:** the formula tries to satisfy "bounded duration" and "no snipeable
instant" with a hard `min()`, and those cannot both hold that way.

**Plausible ruling:** make the ceiling soft. Let the inactivity timeout decay as
the ceiling approaches (12h → 1h → 15min) and let any bid inside the final window
extend by that window. A contested auction then converges quickly instead of
being guillotined, duration stays bounded in practice, no instant is timeable,
and "Closing inside the hour" goes back to being a useful filter.

*(Raised by Duke, 2026-07-29.)*

---

## 1b. RETRACTED — "equal top bids have no tie-break"

An earlier version of this document claimed the resolver's bare
`ORDER BY wc.faab_bid DESC` left tied bids undefined. **That was wrong.**
`079_unified_bid_rpc.sql:183` rejects any bid that does not strictly exceed the
current high (`p_bid_amount <= v_highest_bid`), and line 188 blocks tying or
lowering your own standing bid. Buy Now is exempt but by construction already
clears any bid the auction could legally hold, and resolves under the same anchor
lock. Ties cannot exist in the data, so the missing sort key is harmless.

Kept here as a record of the correction, not as an open item.

---

## 2. Two different initial expiry values for a seeded auction

**Where:** `src/lib/auctions/seedHighValueAuctions.ts:26` sets
`AUCTION_WINDOW_HOURS = 48`. `src/lib/auction/timer.ts:53` `initialAuctionExpiry()`
sets the same field to the max duration — 72h, or 96h for a €40m+ player.

Both stamp `expires_at` on an auction that has no bids yet, with different
numbers. Whichever path seeded the auction decides how long it sits before the
first bid arrives.

**Why it matters:** it's also the origin of the current guide's incorrect
"bidding windows run for 48 hours" — a reader of the code could reasonably reach
either figure. Worth collapsing to one.

---

## 3. RESOLVED — a dead points penalty for very poor ratings

**Where:** `src/lib/scoring/matchRating.ts:454` `calculateFantasyPoints()`.

```js
if (rating < 3.0) finalPoints -= 2.0;
return Math.max(0, ...);
```

The `-2.0` can never be observed. By the time the scoring rating is below 3.0 the
curve already yields 0, so the subtraction is always clamped back to 0 by the
`Math.max`. Fantasy points cannot go negative under any input.

**Why it matters:** the current guide documents this as a live feature ("a truly
poor match rating can actually cost you a small points penalty"). Either the
penalty was meant to work and doesn't, or it's vestigial and should be deleted.
Only you can say which.

---


**Resolved 2026-07-29.** The line was vestigial and has been deleted (see Task 11
of the economy rebalance plan). Tests in `matchRating.golden.test.ts` now pin the
zero floor, so the removal is provably observation-free. Note the line was at
`:463`, not `:454` as recorded above.

## 4. Displayed rating and scoring rating diverge, with nothing telling the player

**Where:** `curveFinalRating()` = `3.5 + 6.0 × composite`;
`computeScoringRating()` = `1.0 + 9.0 × composite`. Points come from the second.

Consequence: **a displayed match rating of 5.84 or below earns exactly zero
points**, and the 6.5 "average starter" rating earns about 3.5. Nothing in the UI
or the guide signals that the number on the card isn't the number that scored.

**Why it matters:** not a bug — the decoupling is deliberate and commented as
such — but it's the single most confusing thing in Gaffa for a new manager, and
it's currently undocumented. Needs a decision on whether the guide explains the
two scales outright or the UI surfaces the scoring rating too.

---

## 5. The out-of-position penalty is broader than the guide describes

**Where:** `src/lib/scoring/matchRating.ts:578`.

The check is: primary position ∈ {DM, CM, AM, LW, RW, ST} **and** slot ∈ {CB, LB,
RB, LWB, RWB} → ×0.80. It does not test whether the player is *listed* at the
defensive position at all.

The guide frames it as a rule about dual-position players ("registered as both AM
and RB"). In fact any midfielder or attacker fielded in a defensive slot takes
the hit, dual-listed or not.

**Why it matters:** the guide's version is reassuring and wrong. Confirm the code
is doing what you intended before I document the real behaviour.

---

## 6. §13 misdescribes the Retained List as a simple drop

**Where:** guide §13 vs `supabase/migrations/072_departure_decisions.sql`,
`075_tradeable_retained_rights.sql`, `src/lib/departures/`.

The guide says a player leaving the Premier League is "deactivated and dropped
from your roster" and you're paid market value. Migration 072 is titled *the
Retained List* and 075 makes retained rights **tradeable** — so there's a
whole asset class here, not a deletion.

**Why it matters:** this is a core dynasty mechanic described as a cleanup step.
It needs its own section, and I need to read the three modules properly before
writing it.

---

## 7. README and CLAUDE.md both say seven formations; there are ten

**Where:** `src/types/index.ts:29` `Formation` lists ten. `README.md`, `CLAUDE.md`
and the old guide all said seven, and none mentioned `3-4-2-1`, `4-3-1-2` or
`4-3-2-1`.

The guide is now corrected. **`README.md` and `CLAUDE.md` still say seven** —
worth fixing, since CLAUDE.md is what agents read first.

---

## 8. Two implementations of "which clubs are locked"

**Where:** `src/lib/auction/lockedClubs.ts` (`getLockedPlTeamIds()`, no args,
fetches FPL directly, fails open) and `src/lib/fixtures/lockout.ts`
(`getLockedPlTeamIds(admin, gameweek)`, used by the lineup route).

Same name, same concept, different signatures and different data sources. Not
known to be wrong, but two answers to one question is how they eventually
disagree.

---

## 9. IR has no slot cap

**Where:** no cap constant exists; `roster_status` allows `ir` freely.

Enforcement is indirect — `auctions/bid/route.ts:79` blocks bidding while a
healthy player sits on IR. That covers the main abuse, but it doesn't stop an
unbounded IR list, and it doesn't gate trades or loans the same way. Confirm the
bid block is the whole intended defence.

---

## 10. RESOLVED — a stale comment in `seasonReset.ts`

**Where:** old guide §14 step 4 described automatic relegation payouts at 100%
of market value; migration 072 turned departures into release-or-retain
decisions.

**Resolved by reading the code, not left open.** `seasonReset.ts`'s header
comment lists *"4. Process relegation compensation"* and an idempotency note
*"Relegation compensation gated on pl_status != 'relegated'"* — but **there is no
such call anywhere in the function body.** Those two comment lines are the only
occurrences in the file. The step was superseded by the departure-decisions
system (072) and the header was never updated.

Departures are actually raised by `src/lib/departures/detect.ts`, which runs off
`syncPlayersFromFpl` marking players `is_active = false`. So they arrive
continuously through the summer, not as an offseason step. §14 now says this.

**The only action here is a stale comment:** `seasonReset.ts:8` and `:19` describe
a step that no longer exists, which is exactly the kind of thing that misleads the
next reader — human or agent. Worth deleting.

*(Superseded text below, kept for the record: if `seasonReset.ts` still paid some
departures automatically, §14 and §13 would both be
slightly wrong and I'd rather you tell me than guess.

---

## 11. A second stale docstring: the "minutes cap" that isn't there

**Where:** `src/lib/scoring/matchRating.ts:12` — the pipeline comment says
*"Step 3  Linear map composite → 1.0–10.0 rating (with minutes cap)"*.

`curveFinalRating(composite, minutesPlayed)` takes `minutesPlayed` but only uses
it for the `=== 0` early return; the rating is `3.5 + 6.0 × composite` with no
minutes term. `calculateFantasyPoints` is the same. **There is no minutes cap
anywhere in the scoring path.**

Short appearances rate low only because they accumulate too little to clear the
positional baseline — not because minutes scale the output. Measured on the live
engine, a 5-minute substitute who scores rates **7.83 / 18.31 pts**, while the
same 5 minutes with no output rates **6.12 / 0.99 pts**.

**Why it matters:** two things. The comment misleads anyone reading the engine
(this is the second stale comment found — see item 10), and it's worth confirming
that *no* minutes weighting is intended. A super-sub scoring 18 points off five
minutes is defensible under "impact, not time served," but it should be a decision
rather than an accident.

---

## 12. Four discipline fields on `RawStats` are never read

**Where:** `RawStats` carries `yellow_cards`, `red_cards`, `own_goals` and
`penalties_missed`. `computeComponentScores` reads **none of them**.

**Scope note — an earlier version of this item was misleading.** It claimed two
identical 90-minute performances, one with a red card, score the same. That test
held `bps` fixed and flipped only the `red_cards` field, which proves the field is
unread but describes a performance that cannot occur: a sending-off changes the
inputs. Duke pushed back on it and was right.

Measured properly, discipline is expensive. `bps` drives `match_impact` — the
largest component for most positions — and FPL deducts 9 BPS for a red card on top
of the player ceasing to accumulate. BPS sensitivity on a 90-minute CM, all else
equal: bps 30 → 18.06 pts, 21 → 12.50, 12 → 7.51, 0 → 3.79. A realistic sending-off
at 25 minutes lands at **5.51 / 0 pts** against **7.37 / 12.36** for the same
player completing the match — it drops him under the zero threshold.

**So there is no scoring gap here**, and the guide now says a red card is usually
catastrophic. The remaining question is narrower: **four fields exist on the input
type solely to be ignored.** Either they're vestigial and should come off
`RawStats`, or a direct discipline term was intended and never wired up. Worth
deciding, if only so the next reader doesn't assume they do something.

**Related, and possibly worth a look:**
`adjustedBps = Math.max(0, rawBps - goalAssistBps)` floors match_impact's input at
zero, so however negative a player's BPS goes the component bottoms out rather
than going negative. The punishment caps at "contributed nothing" rather than
"actively cost us." That looks deliberate and pairs with points never going
negative — just confirming it is.

---

## 13. The cup final tie-break is bracket position, not seed

**Where:** `src/lib/tournaments/advanceTournament.ts:251-252`.

```js
winnerId = resolveTiebreaker(allAPlayers, allBPlayers, matchup.team_a_id, matchup.team_b_id);
// Fallback: higher seed (team_a) wins
if (!winnerId) winnerId = matchup.team_a_id;
```

`resolveTiebreaker` compares each side's highest-scoring individual player and
returns `null` when those are equal — which includes any **0–0**, since every
player scored zero and there is no best performer to compare. The fallback then
awards the tie to `team_a`.

**The comment says "higher seed," but the code means "whoever holds `team_a`."**
`team_a` is the even bracket slot (`createTournaments.ts:335`:
`currentBracketPos % 2 === 0 ? 'team_a_id' : 'team_b_id'`). Under standard
seeding that *is* the better seed in the opening round. In later rounds `team_a`
is simply whoever advanced into the even slot, which need not be the
better-seeded of the two survivors.

**Why it matters:** low-stakes in practice — a true all-zero cup tie is
vanishingly rare — but the deciding rule for a knockout tie should be the one you
intend. Two options: leave it as bracket position and correct the comment, or make
the fallback compare actual seeds so "higher seed advances" is true in every round.

The guide now describes it as "the club in the higher bracket position — the better
seed in the opening round," which is accurate for both cases.

*(Raised by Duke, 2026-07-29 — spotted that a 0–0 makes the best-performer
tie-break undecidable.)*
