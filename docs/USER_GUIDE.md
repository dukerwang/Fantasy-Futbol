# The Gaffa Player's Guide

Gaffa is a dynasty fantasy football league built around one idea: **it should track reality, not reward a meta.**

Most fantasy games invent a points table — 6 for a goal, 4 for a clean sheet — and managers then optimise against that table rather than against football. Gaffa instead rates each performance the way a match-rating site would, against what a player in that role is actually expected to produce, and converts the rating into points. The consequence is deliberate: the way to win Gaffa is to be right about footballers. There is no scoring quirk to farm.

Everything else follows from that. Positions are the twelve real tactical roles, not three buckets. A player is judged by the job you asked him to do, not the label on his profile. Your squad carries over forever, and you build your budget the way a director of football does — through signings, sales, loans and trades.

This guide explains every system and why it works the way it does. It doesn't cover how the app is built.

> **On numbers:** many figures below can be changed by your commissioner, so your league may differ — where that's the case, this guide gives the common default. Money is shown as **€m**.

---

## 1. Positions & Formations

Gaffa uses **12 tactical positions**, not the generic DEF/MID/FWD buckets:

- **Goalkeeper**: GK
- **Defenders**: CB, LB, RB, LWB (left wing-back), RWB (right wing-back)
- **Midfielders**: DM (defensive), CM (central), AM (attacking)
- **Attackers**: LW, RW, ST

**Why this granular?** Because "midfielder" isn't a job. A defensive midfielder and an attacking midfielder are asked for opposite things, and grading them on one scale is how fantasy football ends up rewarding whoever happens to sit in the most generous bucket. Twelve roles means the yardstick matches the job.

### Eligibility is strict

A slot accepts **only its own position**. A CB fills CB slots — not LB, not RWB. Flexibility comes from a player genuinely being listed at more than one position, never from the game inferring that "a defender is a defender."

This matters most on your bench, and it's the single most common squad-building mistake: **a bench CB cannot auto-sub for an injured LB.** Cover means cover at the exact position.

### The ten formations

Your starting XI must fit one of **ten** supported shapes:

| | |
|---|---|
| `4-3-3` | GK, LB, CB, CB, RB, CM, DM, CM, LW, ST, RW |
| `4-2-1-3` | double pivot, central AM, two wingers, ST |
| `4-2-2-2` | modern box midfield — two DM, two AM, two ST |
| `4-3-1-2` | midfield diamond — DM, two CM, AM, two ST |
| `4-3-2-1` | "Christmas tree" — 4-3-3 with the wingers swapped for two AMs |
| `3-4-1-2` | three CBs, two wing-backs, two CM, AM, two ST |
| `3-4-3` | three CBs, two wing-backs, two CM, two wingers, ST |
| `3-4-2-1` | 3-4-3 with the wingers swapped for two AMs |
| `3-5-2` | three CBs, two wing-backs, DM, two CM, two ST |
| `5-3-2` | three CBs, two full-backs, three central mids, two ST |

You pick a shape each gameweek based on who you actually have.

### Bench

You field **exactly 11 starters and exactly 4 bench players**, in four slots:

- **DEF** — CB, LB, RB, LWB, RWB
- **MID** — DM, CM, AM
- **ATT** — ST, LW, RW
- **FLEX** — anyone starter-eligible, *including* an emergency goalkeeper

If a starter is out, Gaffa checks your bench for cover in a fixed order — **DEF, then MID, then ATT, then FLEX** (§5). Note the distinction: the DEF/MID/ATT grouping controls *where a player may sit*; whether he can actually *cover* a specific empty slot is the strict eligibility rule above.

### When things lock

There are **two** locks, and they're different:

- **Your formation** locks as soon as the first match involving *any* of your squad kicks off.
- **An individual player** locks only when *his own club* kicks off.

So the gameweek does **not** shut in one go. Until a player's club kicks off you can still move him, which means you can react to Saturday lunchtime results before the late games. What you can't do is reshape the side after your first player is already out there.

---

## 2. Your Squad

Every club's roster is split by status:

- **Active / Bench** — in play this week.
- **IR (Injured Reserve)** — a parking spot for injured players that doesn't count against your active roster limit, capped at 2 players.
- **Academy** — a prospect stash for U21 players (§12).
- **Loaned out / Loaned in** — players temporarily at another club, or borrowed from one (§10).

Roster size is a league setting, commonly **20**. IR and Academy players don't count toward it.

**IR isn't a free extra slot.** IR is capped at **2 players** (a league setting), and on top of that the game polices it at the point it matters: **you cannot place an auction bid while a healthy player is sitting on IR.** You have to activate him first. Rather than auditing injuries continuously, Gaffa blocks the benefit you'd be stashing him for, in addition to bounding how many you can stash at once.

### Setting up your club

When you join you pick a **club name** (up to 20 characters) and a **2–4 character abbreviation**, then build a **crest**: shield shape, background pattern, primary/secondary/border colours, optional icon and text, with live preview and a randomiser. There's no image upload — every crest is assembled from the same parts, so no badge in the league looks out of place next to another.

---

## 3. The Draft

A league drafts **once**, before its first season. After that your squad carries forward forever and changes through auctions, trades and loans — there are no future drafts.

- The league needs **at least 4 managers**.
- The commissioner sets or randomises the order, and either starts immediately or **schedules** it. Everyone gets an email and an in-app notice, and it auto-starts at that time — or auto-cancels and tells the commissioner if there still aren't 4 managers.
- It's a **snake draft**: order reverses every round, running for as many rounds as your roster size, so everyone finishes with a full squad.
- Any active, undrafted Premier League player is available. There's no separate rookie pool.
- Each pick has a **90-second clock**. Miss it and the system picks for you — from players you've pre-starred if you set a queue, otherwise by whichever position you need most.
- When the last pick lands, the season schedule and all three cup brackets are generated and normal play switches on.

**Why only one draft ever?** Because a dynasty league where talent arrives by lottery every year isn't a dynasty. After the initial draft, every player who enters the league has to be *bought* — which is what makes the Club Balance meaningful and a good squad an achievement rather than a draft slot.

---

## 4. How Scoring Works

Instead of a flat points table, Gaffa judges every player against **realistic expectations for his specific position**. A centre-back and a striker are graded on different scales, because they're asked for different things — so a clean sheet plus real defensive volume can outscore a striker's quiet hour.

Each match a player earns a **rating from roughly 1.0 to 10.0**, calibrated so an average Premier League starter sits near 6.5, built from:

- **Overall match impact** — influence beyond the box score: involvement, pressing, contribution to build-up
- **Creativity and attacking threat** — chances created, shots, dangerous touches
- **Defensive work** — tackles, interceptions, clearances, blocks, recoveries; weighted far more heavily for defenders and defensive midfielders than for wingers
- **Clean sheets** — a bonus for goalkeepers and defenders, smaller for central midfielders, none for attackers. For a keeper it is deliberately modest: the saves that earned the shutout count for more than the shutout itself
- **Goals conceded** — costly for goalkeepers; for outfielders, measured against how many the team's performance suggested they *should* have conceded, not the raw scoreline
- **Goals and assists** — rewarded identically regardless of position, with a bonus for beating your expected-goals numbers
- **Saves** (goalkeepers) — including a larger bonus for penalty saves

**The flex boost.** Whichever of a player's role-relevant components is his best that match receives extra weighting, so a standout game in one part of his role isn't flattened by an average one elsewhere.

### Rating and points are two different scales

Your **fantasy points** come from the same performance, but they are *not* a straightforward conversion of the rating on the card — the two run on separate scales. The practical effect surprises everyone once:

There are no points for turning up. Your score comes from the performance curve alone:

| Displayed rating | Fantasy points |
|---|---|
| 5.5 | **0.00** |
| 5.84 *(the payout threshold)* | **0.00** |
| 6.0 | 0.44 |
| 6.5 *(an average starter)* | 3.54 |
| 7.0 | 8.18 |
| 7.5 | 13.98 |
| 8.0 | 20.71 |
| 9.0 | 36.60 |

Two things follow. **A displayed rating of 5.84 or below scores exactly zero** — a below-par performance is worth nothing, not a small amount, and every game under that line is worth the same whether it rated 4.0 or 5.8. And the curve is steeply front-loaded: 7.0 → 8.0 gains you more than 6.0 → 7.0 did. One genuinely excellent performance outweighs several adequate ones, which is the intended shape. Gaffa rewards players who *decide* matches, not players who merely appear in them. Points never go negative; zero is the floor.

Goalkeepers run on exactly the same table, with no adjustment. A keeper is rated on how he kept, not on whether the defence held: the saves he made, and how the goals he conceded compare with the quality of the chances he faced. A clean sheet helps, but an untroubled one is worth far less than one he earned — and a keeper can rate highly in a defeat, which is how it should be.

### The out-of-position penalty

If a player whose primary position is a midfield or attacking role (DM, CM, AM, LW, RW, ST) is fielded in a **defensive slot** (CB, LB, RB, LWB, RWB), he takes a **20% penalty** to both rating and points. This applies whether or not he's also listed at that defensive position.

**Why:** baseline mismatch. Defensive baselines expect defensive volume, and a midfielder dropped into a back line accumulates touches and recoveries that flatter him against the wrong yardstick. The penalty removes the arbitrage. It doesn't apply in reverse — a defender filling a midfield or attacking slot isn't penalised, because he's being measured against a *harder* standard, not an easier one.

### Common questions

**My player started and played 90 minutes. Why did he score zero?**

Because he was below par, and below par is worth nothing. Anything at or under a 5.84 displayed rating scores 0 — and everything below that line scores the same nothing, so a dreadful game and a merely poor one come to the same. This is the most common surprise in Gaffa and it's deliberate on both counts: appearing in a match isn't an achievement, so there are no participation points, and separating out degrees of poor would mean flattening the whole curve, which would take most of the meaning out of a genuinely big performance.

**Why did my centre-back outscore my striker?**

Because they're graded against different expectations. A centre-back who keeps a clean sheet with real defensive volume has done his job excellently; a striker who didn't score hasn't. That's the whole design — the striker isn't being punished, he's being measured against strikers.

**Does a substitute get punished for only playing 20 minutes?**

No. There's no minutes multiplier anywhere. A short appearance rates low only because it usually accumulates too little to beat the baseline.

A substitute who *does* something is credited for it. A five-minute cameo with a goal in it rates about **7.8 and pays around 18 points**; the same five minutes with nothing in them pays about 1. Across last season, players who scored inside 25 minutes averaged a 7.95 rating and 20 points — comfortably ahead of the 6.82 and 8.6 that a full 90 minutes without a goal or assist returned. Impact counts, not time served.

**What about a double gameweek?**

Both matches count and the points add together. Your player is rated separately for each fixture and you get the sum, so a double gameweek is genuinely twice the opportunity.

**Does a red card cost me points?**

Yes — a sending-off is usually catastrophic for that player's week, often costing the entire return.

There's no separate "−3 for a red card" line item, because there doesn't need to be one. Cards are already reflected in how his match impact is scored, and being sent off stops him accumulating anything else. A midfielder sent off around the 25-minute mark typically lands near a **5.5 rating and scores 0**, where the same player completing an unremarkable 90 minutes would have returned around **12 points**. He falls under the zero threshold and takes nothing.

The one mercy is that it bottoms out. A player's contribution can be reduced to nothing but can't go below it, so a disaster costs you his points — it never subtracts from your team score.

**Can I lose points?**

No. Zero is the floor for any individual performance, so a bad week can leave you with very little but never a negative.

---

## 5. Weekly Matchups

Each week your club plays another head-to-head. Your score is the total fantasy points of your **starting XI**, plus the bench bonus below.

### Auto-subs

If a starter finishes the gameweek on **zero minutes**, Gaffa replaces him — but only once **that starter's own fixture is confirmed finished**, so a late team-sheet surprise isn't acted on prematurely.

It then checks your bench **in a fixed order — DEF, then MID, then ATT, then FLEX** — and takes the first player who:

1. **actually played** (more than zero minutes), and
2. is **eligible for that exact slot** — his primary or secondary position must match it

Each bench player can only be used once. Remember the strict eligibility rule: a bench CB will not cover an LB slot no matter which of the four bench categories he's sitting in.

**The sub is then re-rated at the slot he filled**, not his own position. If your bench full-back comes into a centre-back slot, his contribution to your team score is judged against centre-back expectations — because that's the job he did. His own season stats still record his real position.

### Bench Depth Bonus

Bench players who played but weren't needed each add **25% of the points they scored** to your team total, credited at their normal position.

**Why:** a deep squad should be worth something. Without this, the optimal bench is four players you expect not to play, which is the opposite of squad-building. With it, genuine depth pays a small dividend every week.

### Draws

If the gap between the two scores is **10 points or less**, it's a **draw**. A larger gap gives the win to the higher score.

**Why a draw band at all?** Because a 0.4-point margin isn't a result — it's noise in the ratings themselves. Football has draws; a league that resolves every coin-flip into a win would overstate how much of the table is skill.

Regular-season matchups run alongside the cups, so you're usually playing two fixtures a week — **off the same score and the same XI** (§6).

### Common questions

**What if I forget to set a lineup?**

You won't score zero. Gaffa carries your previous gameweek's lineup forward, and if that isn't usable it builds a valid one from your roster. It's not a substitute for managing your team — a carried-forward XI won't know about this week's injuries — but forgetting once doesn't forfeit the week.

**What if I don't have the right positions for a formation?**

You can't save it. A lineup must fill every slot in the chosen shape with an eligible player, exactly 11 starters and exactly 4 bench. This is why the strict eligibility rule in §1 shapes squad-building: you need real cover at real positions, not four vaguely defensive players.

**Should I start someone I know is injured, so the auto-sub fires?**

It works — an absent starter is replaced from your bench once his fixture finishes — but you lose the Bench Depth Bonus you'd have earned from that bench player, since a player used as a sub doesn't also pay the 25%. Starting the fit player is normally better.

**Both of us scored nothing. What happens?**

In the league it's a draw — a gap of 10 or fewer is a draw, and 0–0 qualifies.

In a cup tie there are no draws, so it has to resolve. The first tie-break is the best individual performer, but at 0–0 nobody has one: every player scored zero, so there's nothing to compare. In that case the club in the **higher bracket position** advances — the better seed in the opening round. So a genuine 0–0 cup tie is settled by where you finished in the league, which is the only thing left to separate the two sides.

---

## 6. Cup Tournaments

Three knockout competitions run **alongside** the league, not instead of it:

- **Champions Cup** — the primary competition
- **League Cup** — the secondary knockout
- **Consolation Cup** — for clubs who miss out on the other two

### Why cups exist

Real clubs don't play for one thing. A season has a league campaign *and* knockout runs, which is why a manager can finish fifth and still have silverware, or win the title and get knocked out by someone mid-table. That's the shape Gaffa is after — **a season with more than one story in it.**

It solves a real problem with league-only fantasy football, too: by March, half the table has nothing to play for. Three parallel knockouts mean a club with no title hope is still in a cup, still has a tie next week, and can still finish the year with something to point at. **The trophy is the point.** A treble is possible. So is a season where you win nothing in the league and go home with the Champions Cup, which is a perfectly good season.

### How ties are decided

**You don't set a separate cup lineup.** Your gameweek score is calculated once from your one XI, and that same score counts for your league match *and* any cup tie you have that week. One team, one performance, multiple competitions — exactly as a real squad plays a midweek cup game with the players it has.

- **Brackets are seeded on league position** in the standard pattern (1 v 16, 8 v 9, 5 v 12 …), and **byes go to the top seeds**. Finishing high in the table is worth something beyond the table.
- Some rounds are **two-legged**, decided on **aggregate** across both gameweeks.
- **There are no draws in a cup.** The league's 10-point draw band doesn't apply — somebody has to advance.
- **Level ties are settled by your best individual performer.** If the scores are equal, the club whose highest-scoring single player outscored the other's goes through.
- **If even that is level** — including a 0–0, where nobody has a best performer — the club in the **higher bracket position** advances. In the opening round that's the better seed.

That tie-break is worth thinking about in a cup week. A side built on one outstanding player and a thin supporting cast can lose a league match on aggregate points and still survive a cup tie on the strength of that one performance.

Everything advances automatically as gameweeks resolve — there's nothing to confirm.

In a small league (4–6 managers) every club enters the Champions Cup and the Consolation Cup holds placeholder slots; there aren't enough teams for three meaningful brackets.

Cup results feed end-of-season prize money (§14) — so a cup run pays as well as flatters.

---

## 7. Standings & Stats

- **Standings** — the league table: win/draw/loss, league points, points for and against, difference, rank, and a five-match form guide.
- **Stats** — a leaderboard covering **every** Premier League player, owned or not, sortable by total points, points per game, average rating, market value, form and minutes, filterable by position.

The Stats page is deliberately league-wide rather than limited to free agents: scouting in a dynasty league means knowing who's good, including players you'd have to prise off somebody.

---

## 8. The Transfer Market

Every player you don't already own — genuine free agents and players listed by other managers alike — sits on **one board**, behind one bid button. You buy them the same way: an **open auction** paid from your **Club Balance**.

Open means open. You can see the current highest bid, which club holds it, and how many clubs have bid. When someone outbids you, you're notified. There is no sealed envelope and no hidden phase.

**Why open rather than sealed?** For the same reason as everything else in Gaffa: it's closer to how football works. Real transfer business isn't conducted in sealed envelopes — it's semi-open. Clubs know who else is in for a player, agents brief journalists, and a price gets driven up in public. An open auction simulates a negotiation; a blind bid simulates a raffle.

It also keeps the skill in the right place. In a sealed format the winner is usually whoever overshot hardest, and what's being tested is bid psychology. Open bidding asks a cleaner question: what is this player worth to your squad, now that someone else has told you what he's worth to theirs?

*Semi-open is the honest description of what's here today.* Genuine transfer negotiation has asymmetric information — some clubs know more than others — and that's a direction this may develop in, with secrecy and ways to pay for intel. For now, everyone sees the same board.

- Every club starts with a league-set Club Balance, commonly **250**.
- **Your Club Balance never resets between seasons** — it's a permanent dynasty asset, and it can be traded like any other.
- **Your bid must beat the current high.** Matching it is rejected, as is lowering your own standing bid. There is therefore no such thing as a tied bid.
- If you're at your roster limit you nominate a player to **drop** as part of your bid. Dropping charges a **severance fee** of 20% of his market value, minimum **€2m**, on top of your winning bid — so churn isn't free.
- If you win but your active roster is full and the player is U21, he can be routed to your **Academy** rather than blocking the transfer.
- Free agent bids must reach at least the league's **minimum bid floor** (default **50% of market value**).
- **A brand-new Premier League arrival can't be bid on until Transfermarkt has priced them** — usually within a day of them appearing in the app. There's no floor to enforce before that, so bidding is blocked outright rather than left open at zero.
- **The league seeds auctions automatically at season kickoff** for any player worth **€50m or more**, *or* who plays for a **newly-promoted club**. Everyone is emailed. Promoted-club players are seeded regardless of price, because at kickoff nobody owns them and a cheap newly-promoted starter is exactly the kind of asset a dynasty league should compete for rather than claim first. To keep managers focused on the same marquee targets, elite-tier auctions (€50m+) are **released in staggered waves** (roughly half the league size per wave, spaced 3 days apart).

### How long an auction runs

There is no fixed duration and no hard ceiling. The clock is driven by bidding activity with a decaying inactivity timeout, protected by your league's **quiet hours** (default 00:00–08:00 local time):

| | |
|---|---|
| Initial window (before first bid) | **72 hours** (for all players) |
| Stays open at least | **24 hours** after the first real bid |
| Inactivity timeout | **12h** (age <48h) → **4h** (48–72h) → **2h** (72–96h) → **1h** (96h+) |
| Quiet hours guard | Expiries landing inside quiet hours automatically move to the window's end (e.g. 08:00) |
| Hard ceiling | **None** — an auction terminates when someone stops paying, preventing snipes |

Every bid extends the clock by the active inactivity timeout. Because there is no hard ceiling, contested auctions can never freeze on a snipeable public deadline, and quiet hours guarantee no auction resolves while managers are asleep.

### Selling your own players

You can **list one of your rostered players**, and the listing is shaped by which of three prices you set — no separate "auction or negotiation" switch to configure:

- **Minimum bid** opens him to a genuine open auction, same as a free agent. Set at all, it must be at least **60% of the player's market value** — without that floor, two managers could move a €90m striker for €1m and call it a sale.
- **Release clause** lets anyone buy him outright at that price, no bidding required.
- **Asking price** is advertising for a negotiated Offer — it names a number without committing to accept it.

Set only the ones that apply. Skip the minimum bid and only set a release clause, and there's no open auction at all — the only way in is paying the clause outright, or negotiating an Offer. Skip all three prices except the asking price (or set none) and the listing is negotiation-only: nobody can bid, only propose. At least one of the three has to be set, or there's nothing here to advertise. Whatever you do set, others bid through the same open auction and you can't bid on your own listing; when he sells the winning bid is paid to *you* as Club Balance income — a genuine transfer fee, not a release.

For the same reason a minimum bid needs a real value to be floored against, a player who hasn't been priced by Transfermarkt yet can't be listed at all until they are.

When you list a player you can also flag whether you want **cash, players, or a loan**. These flags advertise what you're after and set the headline other managers see — they don't restrict how people can approach you. Anyone can still make any kind of offer.

**Before anyone bids, you can also negotiate directly.** Send an Offer — cash, players, or a mix — and it lands as a private proposal in your DMs with the seller, who can accept, counter, or decline it, exactly like any other trade. It's a quieter route than the open auction: nobody else sees it, and unlike a bid it needs the seller's yes rather than just being the highest number on the board. A cash-only offer still has to clear your **minimum bid**, when you have one set — the floor protects the auction itself, not just who's allowed to open it — but an offer that includes players isn't priced against anything, since their value isn't one number. Once real bidding starts, this door closes and the listing becomes auction-only.

### Where a transfer fee goes

When you sign a free agent, the fee doesn't vanish. **20% of every winning bid returns to the league**, split two ways:

- **Half to the Scout** — whoever opened that auction, if they didn't win it. That's **10% of the winning bid, with no cap**: surfacing a €150m signing pays €15m.
- **Half shared equally among the other clubs** who didn't win, as a **solidarity payment**.

The remaining 80% is retired from the league's money supply.

**Why?** Because a fee that simply disappears drains the league every time somebody spends. Your squad is only sellable if the other managers still have money, so a market where every big signing destroys cash eventually has no buyers in it. Football handles this the same way — a slice of every transfer fee is distributed to a player's former clubs, and the Premier League's central pot is largely an equal share. A bidding war between two clubs now funds everyone else.

The same 20% applies to the severance fee when you drop a player and to the loan slot buyback fee. There's no Scout's Fee on either, because no auction was opened.

Amounts are always whole millions, so a split that doesn't divide evenly leaves a remainder, and the remainder is retired.

**Rosters are locked during the offseason** — no bids until the new season begins.

---

## 9. Trades

Direct manager-to-manager deals. No commissioner approval, no trade deadline.

- Offer any combination of your players plus Club Balance against any combination of theirs plus theirs.
- The other manager can **accept**, **reject**, **ignore**, or **counter** (which cancels the original).
- **Retained rights** (§13) are tradeable assets and can be included.
- If any player in an accepted trade has already kicked off in a live gameweek, the trade is marked **deferred** and executes when that gameweek finishes. You can't use a mid-week trade to escape a bad lineup.
- A player with an active sale listing can't be traded until it resolves or is cancelled.
- The Trades page shows a league-wide feed as well as your own pending offers and history.

**Why no approval and no deadline?** Commissioner veto assumes someone can referee whether a trade is "fair," which in a dynasty league means adjudicating other people's long-term plans. Gaffa polices the mechanisms that make collusion *possible* instead — the 60% listing floor, the deferred-trade rule, the buy-back exclusion — and then lets managers deal freely.

---

## 10. Player Loans

Send a rostered player to another club **temporarily** — for **4 to 16 gameweeks**.

- Either side can open the conversation: **propose** a loan out, or **request** one of theirs. Both sides must agree.
- Terms are an **upfront fee** and, optionally, a **performance bonus** paid per fantasy point the player scores while away, subject to a cap. Presets — Fixed Fee Only, Balanced, Performance-Heavy — or hand-adjust.
- A **recall clause** lets the lender pull him back early for a flat penalty. The lender can instead pay a **slot buyback fee** (commonly **25**) to reclaim the roster spot without recalling the player.
- The player counts toward the **borrowing** club's active roster while out.
- **There are hard caps:** by default you may have only **1 player out on loan** and **2 in** at any time.
- At expiry everything settles automatically: bonus paid, player returns to the lender's bench, both managers notified. If the lender's roster is full the return waits until space is made — nothing is auto-dropped on your behalf.

**Why cap loans so tightly?** Without a cap, loans become a way to warehouse a squad you can't field — stash your surplus with a friend, reclaim it when useful. One out and two in keeps a loan what it should be: a specific deal about a specific player, not a second roster.

---

## 11. Finance

Your Finance page is your club's bank statement:

- Current **Club Balance**
- Spending and earnings broken down by category: signings, severance, trades, departure compensation, sale proceeds, loan fees and bonuses, recall penalties, prize payouts, monthly revenue and solidarity payments
- **Money created vs destroyed** — whether your club has taken more out of the league's money supply than it has put back
- A full paginated **transaction history** — date, type and amount of every move your club has made

### Match Revenue

You are paid **during** the season, not only at the end of it. Every four gameweeks your results over that block are settled into your Club Balance:

| Result | Payment |
|---|---|
| Win | **€2.5m** |
| Draw | **€1.5m** |
| Loss | **€0.5m** |
| Bye *(odd-sized leagues)* | €1.5m |

Ten payments a season — after gameweeks 4, 8, 12, 16, 20, 24, 28, 32 and 36, plus a final settlement covering 37–38. A perfect month pays **€10m**; a winless one still pays **€2m**.

**Why during the season?** Because money that only arrives in June can only be spent in June. A club that has to wait until the reset to be paid does its business in one summer splurge and then sits out the year. Paying monthly means you can respond to an injury in October with a signing rather than a shrug.

**Why does a draw pay less than half a win?** Because of the draw band in §5. A margin of ten points or fewer is noise in the ratings rather than a result, so it shouldn't pay like one.

Note that a win and a loss together pay exactly the same as two draws, so the league's total outlay is identical however the results fall. Nobody is paid out of anybody else's pocket.

---

## 12. The Academy

A stash — commonly **3 slots** — for **U21** players that you want to hold long-term without using an active roster spot.

The catch: once an Academy player **turns 21** he no longer qualifies. Gaffa checks automatically and promotes him to your active bench if there's room. If your roster is full he stays parked until you make space — nothing is auto-dropped for you.

**Why an age cutoff rather than a games-played rule?** Because the Academy is meant for prospects you're betting on, not for hiding useful squad players off the books. Age is the one criterion a manager can't manufacture.

---

## 13. Departures & the Retained List

When a rostered player **leaves the Premier League** — transfer abroad, relegation, retirement — you don't simply lose him. You get a **choice**, per departure:

- **RELEASE** — take compensation worth **60% of his market value**. He enters the auction pool. **You are then barred from bidding on his return auction.**
- **RETAIN** — forfeit the compensation and keep his **rights**. He's off your roster and out of the competition, but he's still yours: if he ever returns to the Premier League he reverts to you with no auction.

The rate is deliberately below full value. Paid in full, taking the cash would beat keeping the rights in almost every case, and the Retained List would be decoration. At 60% the trade is real: cash now against a claim on a player who might come back.

**You get one week to choose.** A departure spotted mid-season gives you until the deadline shown on the decision to pick Release or Retain — if you let it pass, he's **released automatically** at the compensation rate above, same as choosing Release yourself. (A departure caught during the offseason has no clock — Kickoff is the deadline instead, since there's no need to force a call before the commissioner's own action ends the grace period anyway.)

Retention itself uses **scarce slots**, commonly **3** — not an expiry clock.

**Why it works this way.** The original design paid you out automatically and deleted the player, which created a genuine exploit: a player paid out at kickoff can sign for a Premier League club before the window shuts weeks later. The ex-owner then held a windfall equal to his value *and* could spend it bidding on him at the return auction — a free option nobody else had. An established player at a relegated club is the single most likely profile for exactly that. Forcing the choice closes it: take the money and you're excluded from the buy-back, or keep the claim and take no money.

The slot limit rather than a timer is deliberate too. No one can know when a player might come back, so any expiry date would be arbitrary; scarcity instead makes holding one claim cost you the ability to hold another. Rights can be **given up for nothing** but **never cashed in** — otherwise "retain everything, cash out whatever doesn't return" would be strictly optimal.

### Retained rights are tradeable

A claim on a player outside the Premier League is a real dynasty asset — one manager rates the player, another just wants the slot — so it can be traded like anything else.

One thing deliberately doesn't move with it: **the buy-back exclusion stays with whoever took the compensation.** Otherwise you could release a player, trade the resulting claim to a friend, and bid on his return with the exclusion laundered off.

---

## 14. The Offseason Reset

Once every gameweek and cup tie is complete, the commissioner triggers the reset. A preflight check confirms nothing is unfinished, then:

1. **Rosters lock immediately** — no bids, trades or loans until the new season opens.
2. **The season is archived** — final standings, every matchup, cup winners, and each player's season stats and ranks are written to the permanent record.
3. **Placement and cup prizes are paid** into Club Balances. Finishing first pays **€40m**, scaling down to **€20m** for last — a flatter curve than it looks, because the bulk of league earnings now arrives monthly during the season (§11). Cup money is on top: **€50m** to the Champions Cup winner (**€20m** runner-up), **€25m** to the League Cup or Consolation Cup winner (**€10m** runner-up each).
4. **Records reset, money doesn't.** Wins, losses, draws and points go to zero. Club Balance carries over untouched.
5. **A new season is generated** — the season counter advances, and a fresh schedule plus all three cup brackets are created.

**Departures are not part of the reset.** Players leaving the Premier League — including everyone at a relegated club — are picked up continuously as it happens, and each one opens a release-or-retain decision for you to answer (§13). So relegation doesn't hit you in one lump at the reset; it arrives as decisions as the summer unfolds.

**Your squad is not touched.** The reset is about records and money — never your players.

---

## 15. History

The permanent record book: final standings and podium for every past season, each cup's winner, and all-time records such as the highest single-gameweek score ever posted in the league.

---

## 16. Chat, Activity & Inbox

- **Chat** — a league-wide **Lobby** plus direct messages. Trade offers appear as system cards inside your DM thread with that manager, so negotiating and talking happen in one place.
- **Activity** — a filterable league-wide feed of every roster move: signings, drops, trades, departure compensation, sale proceeds, draft picks, prize payouts, plus any auction currently live.
- **Inbox** — your notifications: trade offers and outcomes, draft alerts, outbid warnings, auction results, loan proposals and settlements, gameweek summaries. Each deep-links to the relevant page.

---

## Quick Glossary

| Term | Meaning |
|---|---|
| **Club Balance** | Your club's budget, used for signings, trades and loans. Earned monthly through results and at the reset through placement and cups. Never resets between seasons. |
| **Open auction** | How every signing works. Bids are public — you see the current high bid and who holds it, and must beat it to lead. |
| **Scout's Fee** | 10% of the winning bid, uncapped, paid to whoever opened an auction they went on to lose. |
| **Solidarity payment** | An equal share of another 10% of every winning bid, paid to the clubs that didn't win it. |
| **Match Revenue** | Your monthly income, settled every four gameweeks on your results. |
| **Severance fee** | The cost of dropping a rostered player to make room — 20% of his market value, minimum €2m, on top of the winning bid. |
| **Auto-sub** | An automatic bench replacement when a starter records zero minutes and his fixture has finished. |
| **Bench Depth Bonus** | 25% of the points scored by bench players who played but weren't needed as subs. |
| **Flex boost** | Extra weighting given to a player's strongest role-relevant component that match. |
| **OOP penalty** | The 20% rating/points penalty when a player whose primary position is a midfield or attacking role is fielded in a defensive slot. |
| **Academy** | A stash for U21 players that doesn't count against your active roster. |
| **IR** | Injured Reserve. Doesn't count against your roster, capped at 2 — and you can't bid while a healthy player occupies it. |
| **Release / Retain** | The choice when a player leaves the Premier League: take his market value and forfeit the buy-back, or keep his rights and take nothing. |
| **Retained rights** | A tradeable claim on a departed player that matures if he returns to the Premier League. |
