# The Gaffa Player's Guide

Gaffa is a dynasty fantasy football league built around one idea: it should feel like actually managing a football club, not filling in a spreadsheet. Positions are tactical (not just "defender/midfielder/forward"), players are scored against realistic baselines for their role, your roster carries over forever, and you build your club's budget the same way a real director of football would — through smart signings, sales, loans, and trades.

This guide explains every system in the game and how it affects you as a manager. It doesn't cover how the app is built — just how to play it.

---

## 1. Positions & Formations

Gaffa uses 12 real tactical positions instead of the generic "DEF/MID/FWD" buckets most fantasy games use:

- **Goalkeeper**: GK
- **Defenders**: CB (Center-Back), LB (Left Back), RB (Right Back), LWB (Left Wingback), RWB (Right Wingback)
- **Midfielders**: DM (Defensive Mid), CM (Central Mid), AM (Attacking Mid)
- **Attackers**: LW (Left Winger), RW (Right Winger), ST (Striker)

There's no LM/RM — those are automatically treated as LW/RW. Every player has a primary position and sometimes a secondary position (e.g. a player who plays both RB and RWB), and they're eligible for lineup slots matching either.

Your starting XI must fit one of **7 supported formations**: `4-3-3`, `4-2-1-3`, `4-2-2-2`, `3-4-1-2`, `3-5-2`, `5-3-2`, or `3-4-3`. You pick which formation to run each gameweek based on your available squad.

**Bench slots** are grouped as DEF, MID, ATT, or FLEX. A DEF/MID/ATT bench slot can only hold a player from that group, but the FLEX slot accepts literally any starter-eligible player — including an emergency backup goalkeeper if you're desperate.

Lineups **lock at kickoff of the gameweek** — once the first match of your gameweek starts, you can't make further changes.

---

## 2. Your Squad: Roster Structure

Every club has a roster split into four groups:

- **Active** — on your bench or in your starting XI, fully in play.
- **Bench** — rostered but not started this week (still eligible for auto-subs and Bench Depth Bonus, see below).
- **IR (Injured Reserve)** — a stash spot for long-term injured players that doesn't count against your active roster limits.
- **Taxi Squad** — a small "prospect stash" for young players you want to hold long-term without them occupying an active roster spot (see [Taxi Squad](#9-the-taxi-squad--academy) below).

Your total roster size is set by your league (commonly 20 spots).

### Setting up your club
When you first join a league, you'll go through a short setup flow: pick a **club name** (up to 20 characters) and a short **abbreviation** (2–4 letters/numbers), then build your **crest** using Gaffa's built-in crest maker — choose a shield shape, background pattern, primary/secondary/border colors, an optional icon, and optional text, with a live preview and a "randomize" button to get ideas. There's no image upload; every crest is built from these preset pieces so every badge in the league looks consistent and sharp.

---

## 3. The Draft

A league only drafts once — at the very start, before its first season. This is how every club gets its initial 20-something players; after that, your roster carries over forever and grows/changes through trades, waivers, and loans, not future drafts.

- The league needs **at least 4 managers** to start.
- The commissioner sets the draft order (or randomizes it) and either starts the draft immediately or **schedules** it for a future date/time — everyone gets an email and in-app notification, and the draft auto-starts at that moment (or auto-cancels and notifies the commissioner if the league still doesn't have 4 managers by then).
- It's a **snake draft**: the order reverses every round, and it runs for as many rounds as your league's roster size (so everyone ends up with a full squad).
- Any active, undrafted Premier League player is fair game — there's no separate "rookie pool."
- Each pick has a **90-second clock**. If you don't act in time, the system auto-drafts for you — either from a queue of players you've pre-starred, or a sensible fallback if you haven't set one.
- Once the last pick is made, the league goes live: the season schedule and cup brackets are generated, and normal-season features (trades, waivers, lineups) switch on.

---

## 4. How Scoring Works

Instead of flat points for goals/assists/tackles like most fantasy games, Gaffa judges every player against **realistic expectations for their specific position**. A center-back and a striker are graded on completely different scales — a striker is expected to score goals, a center-back isn't, so a clean sheet and a few key defensive actions can outscore a striker's quiet 60 minutes.

Each match, a player earns a **rating from roughly 1.0 to 10.0** (calibrated so an average Premier League starter sits around 6.5, just like you'd see on a match-rating site), built from a blend of:

- **Overall match impact** — how much influence a player had on the game beyond just the box score: pressing, positioning, involvement in build-up play, and general contribution
- **Creativity and attacking threat** — chances created, shots, dangerous touches, and attacking intent
- **Defensive work** — tackles, interceptions, clearances, blocks, and recoveries; this matters a lot more for defenders and defensive midfielders than for wingers
- **Clean sheets** — a big bonus for goalkeepers and defenders who play 60+ minutes and keep a clean sheet, a smaller bonus for central midfielders, and none for attacking players
- **Goals conceded** — costly for goalkeepers; for outfield players, the penalty is calibrated against how many goals the team's performance suggested they should have allowed, not just the final scoreline
- **Goals and assists** — rewarded the same regardless of position, with a bonus for outperforming your expected-goals numbers
- **Saves** (goalkeepers only) — including a bigger bonus for penalty saves

A player's best-fitting standout stat for their position also gets a small extra boost, so a defender who has an outstanding attacking game, or a winger who has an outstanding defensive game, gets rewarded for the "flex" contribution rather than being capped by their normal role.

That match rating is then converted into your **fantasy points** for the gameweek. The conversion is deliberately front-loaded toward good performances: a merely average game earns modest points, but a genuinely good game (well above the position's average) is worth disproportionately more — so one standout performance can matter more than several mediocre ones. A truly poor match rating (well below average) can actually cost you a small points penalty rather than just scoring zero.

**One quirk worth knowing:** some players are listed at both an attacking or midfield position *and* a defensive position — for example, a player registered as both AM and RB. If you field such a player in their defensive slot, they take a **20% penalty** to both their match rating and fantasy points that week. This doesn't apply in reverse — defenders who are also listed in a midfield or attacking role don't get penalized for filling those slots.

---

## 5. Weekly Matchups

Every week, your club is matched head-to-head against another club in your league. Your team score is simply the total fantasy points scored by your **starting XI** that gameweek.

### Auto-subs
If one of your starters records **zero minutes** (injury, suspension, not in the squad, etc.), the system automatically looks down your bench — in the order you set it — and subs in the first eligible bench player whose match has already finished. You don't have to do anything; this happens automatically once the gameweek resolves.

### Bench Depth Bonus
Even bench players who *did* play (but weren't needed as an auto-sub) aren't wasted: each one contributes a small bonus to your team score equal to **20% of the fantasy points they scored** in their primary position that week. Deep, versatile benches are rewarded, not just insurance.

### Role-aware scoring for subs
If a bench fullback gets subbed into a center-back slot, their contribution to your *team* score for that match is judged against center-back expectations (not their normal fullback baseline) — the player's overall season stats still reflect their real position, but the matchup score reflects the job they were actually asked to do.

### Draws
Matchups aren't decided by a single point — if the gap between your score and your opponent's is **10 points or less**, the match is recorded as a **draw**. A bigger gap gives the win to the higher-scoring side.

Regular-season matchups run alongside three cup tournaments (see below) at the same time, so you're always playing at least one — often two — head-to-head fixtures per week.

---

## 6. Cup Tournaments

Three knockout competitions run in parallel with the regular season:

- **Champions Cup** — the top competition.
- **League Cup** — a secondary knockout for the rest of the field.
- **Consolation Cup** — so there's still something to play for if you miss out on the other two.

Brackets, legs, and progressions update automatically as gameweeks resolve — you don't need to manually advance anything. Cup results also factor into end-of-season prizes (see [Offseason Reset](#13-the-offseason-reset)).

---

## 7. Standings & Stats

- **Standings** is your league table: every team's win/draw/loss record, league points, points for/against, goal difference, current rank, and a quick form guide (last 5 results).
- **Stats** is a separate, broader leaderboard covering **every** Premier League player — owned or not — sortable by total fantasy points, points-per-game, average rating, market value, current form, and minutes played, and filterable by position. Use this to scout who's hot before you spend your Club Balance or propose a trade.

---

## 8. Free Agency, Waivers & Auctions

Signing players who aren't already on a roster runs through your **Club Balance** — a blind-bidding economy, not first-come-first-served waivers.

- Every club starts with a league-set Club Balance (commonly 250) when it joins.
- **Your Club Balance never resets between seasons** — it's a permanent dynasty asset. It carries over year to year and can be traded away like any other asset.
- To sign an available player, you submit a **blind bid** from your Club Balance. Bidding windows run for **48 hours**; you won't see what others have bid until it closes.
- If you're already at your roster limit, you nominate a player to **drop** as part of your bid. Dropping a rostered player to make room charges you a **severance fee** — currently 20% of that dropped player's market value (minimum £2m) — on top of your winning bid, so roster churn isn't free.
- **Big-name arrivals trigger an automatic auction:** any player who newly enters the pool (e.g. a fresh transfer into the Premier League) with a market value of **£50m or more** kicks off a system-run auction automatically, and every manager in the league gets notified by email so nobody misses out.

### Selling your own players
You're not limited to trading or dropping a player outright — you can also **list one of your rostered players for sale**. Set a minimum bid and, optionally, an instant "buy now" price. Other managers bid on it through the same blind-auction mechanism as free agency (you can't bid on your own listing). When it sells, the winning bid is paid to *you* as Club Balance income rather than disappearing — it's a genuine transfer fee, not a release. A player can't be traded away while they have an active sale listing running.

---

## 9. Trades

Trades are direct, manager-to-manager deals — there's no commissioner approval step and no trade deadline.

- Build an offer: any combination of your players plus an amount from your Club Balance, against any combination of the other team's players plus theirs.
- The other manager can **accept**, **reject**, **ignore**, or send back a **counter-offer** (which automatically cancels the original proposal).
- If any player involved in an accepted trade has a match that's already kicked off in a live gameweek, the trade is marked **deferred** and executes automatically the moment that gameweek finishes — so you can't use a mid-week trade to dodge a bad lineup situation.
- A player currently listed for sale (see above) can't be included in a trade until that listing is resolved or cancelled.
- The Trades page shows both a full league-wide trade feed (so you can see what everyone else is doing) and your own pending offers and history.

---

## 10. Player Loans

Loans let you send a rostered player to another manager's squad **temporarily** — a genuine loan spell, not a permanent transfer — for **4 to 16 gameweeks**.

- Either side can start the conversation: **propose a loan** (offer one of your players out) or **request a loan** (ask another manager for one of theirs). The other manager has to agree before it activates.
- Deal terms include an **upfront fee** and, optionally, a **performance bonus** — a rate paid per fantasy point the player scores while out on loan (capped so it can't run away). There are three quick presets — Fixed Fee Only, Balanced, and Performance-Heavy — or you can hand-adjust the price up or down by 20%.
- A loan can include a **recall clause**, letting the lending club pull their player back early for a flat Club Balance penalty, and lenders can pay a one-off **slot buyback fee** if they just want their roster spot back without recalling the player.
- The player still counts toward the *borrowing* club's active roster while out on loan.
- When the loan window ends, everything settles automatically: any performance bonus is paid out, the player returns to the lender's bench, and both managers are notified. If the lender's roster is already full at that point, the return is held until they free up a spot — the loan doesn't force a drop on your behalf.

---

## 11. Finance

Your club's Finance page is a running ledger — think of it as your club's bank statement:

- **Current Club Balance**
- A breakdown of spending and earnings by category: signings, drops (severance), trades, transfer-out compensation, sale proceeds, prize payouts, and more
- A full, paginated **transaction history** with the date, type, and amount of every single move your club has made

---

## 12. The Taxi Squad & Academy

The Taxi Squad is a small stash (commonly 3 slots) for promising **young players (under a league-set age limit, commonly 21)** that you want to hold onto for the long term without them eating an active roster spot. Think of it as your academy pipeline.

The catch: once a taxi-squad player **ages past the limit**, they no longer qualify for the stash. The league automatically checks for this and promotes any player who's aged out onto that club's active bench — as long as there's room. If your roster is already full when that happens, the player stays parked in the taxi slot until you free up space yourself; nothing gets auto-dropped on your behalf.

---

## 13. Transfer-Out & Relegation Compensation

Dynasty rosters mean players sometimes leave the picture entirely — and Gaffa compensates you rather than just deleting the asset:

- If a rostered player **permanently leaves the Premier League** (transfers to a non-PL club, retires, etc.), they're deactivated and dropped from your roster, and you're paid **100% of their market value into your Club Balance**.
- The same full-market-value compensation applies automatically during the **Offseason Reset** for any rostered player whose Premier League club gets **relegated** (see below).

---

## 14. The Offseason Reset

At the end of the season, once every gameweek and cup fixture is complete, the commissioner triggers the offseason reset — the process that keeps a dynasty league feeling fresh year over year without wiping anyone's roster:

1. **Preflight check** — confirms every matchup and cup tie has actually finished before anything else runs.
2. **Archive the season** — final standings, total points, and team ranks are locked into the league's permanent History page.
3. **Prizes paid out** — Club Balance is credited to teams based on league and cup finishes, per your league's configured prize structure.
4. **Relegation compensation** — any rostered player on a club relegated from the Premier League is automatically dropped, with the owner paid 100% of market value into their Club Balance (same mechanic as transfer-out compensation above).
5. **Records reset, budgets don't** — wins/losses/draws/points reset to zero for the new season, but every club's Club Balance carries over untouched.
6. **New season, new schedule** — the league's season counter advances, and a fresh head-to-head schedule plus empty cup brackets are generated automatically, ready to go.

Your roster itself is untouched by all this — the reset is about records and money, not your squad.

---

## 15. History

The History page is your league's permanent record book: for every past season, you'll find the final standings and podium, the winner of each cup competition, and all-time records like the single highest gameweek score ever posted in the league.

---

## 16. Chat, Activity & Inbox

- **Chat** — a shared **Lobby** visible to the whole league, plus private direct messages between any two managers. Trade offers also show up as system-generated cards right inside your DM thread with that manager, so negotiating a deal and chatting about it happen in the same place.
- **Activity** — a filterable league-wide feed of every roster move: signings, drops, trades, transfer-out and relegation compensation, sale proceeds, draft picks, and prize payouts — plus a live view of any auction currently in progress.
- **Inbox** — your personal notifications: trade offers and outcomes, draft start/schedule alerts, "you've been outbid" warnings, waiver and auction results, loan proposals and loan settlements, and gameweek result summaries. Mark items read individually or all at once, and each one deep-links straight to the relevant page.

---

## Quick Glossary

| Term | Meaning |
|---|---|
| **Club Balance** | Your club's virtual currency/budget, used for signings, trades, and loans. Never resets between seasons. |
| **Blind bid** | A bid from your Club Balance on a free agent that stays hidden from other managers until the bidding window closes. |
| **Severance fee** | The cost charged when you drop a rostered player to make room for a new signing. |
| **Auto-sub** | An automatic bench replacement when a starter records zero minutes. |
| **Bench Depth Bonus** | Extra team points from bench players who played but weren't needed as auto-subs. |
| **OOP penalty** | The 20% rating/points penalty applied when a dual-position player (listed at both an attacking/midfield and a defensive position) is fielded in their defensive slot. |
| **Taxi Squad** | A stash for young prospects that doesn't count against your active roster. |
| **IR** | Injured Reserve — a stash for long-term injuries. |
| **Transfer-out compensation** | Club Balance paid to you when a rostered player permanently leaves the Premier League. |
