# Fantasy Futbol — Planning Context (Antigravity / Gemini)

Plans produced here are handed off to Claude Code for execution. Write implementation plans with enough specificity that an AI agent with no additional context can execute them — include file paths, function names, DB tables, and edge cases explicitly. Do not execute code yourself.

Your default mode in this file is planning only. Never write, create, or modify files unless explicitly told to implement. If the user asks a question or requests changes to a plan, update the plan document only. Wait for explicit instruction like "implement this" or "execute" before touching any code.

## What This App Is
Vision: Fantasy Futbol is built to be a more realistic, tactically deep alternative to mainstream dynasty apps like Sleeper. Where those apps abstract away football into arbitrary point systems, Fantasy Futbol mirrors how real football actually works — managers negotiate for players through public auctions (like real transfer windows), players are scored based on how they actually performed in their real-world position, and the best real-world players are the most valuable fantasy assets. Every mechanic should reinforce this philosophy: if a feature would feel at home in Sleeper but wouldn't make sense in the context of real football management, it probably needs rethinking.

Fantasy Futbol is a multi-tenant dynasty fantasy soccer platform. Leagues support 4–10 managers and are invite-based. Anyone can create or join a league. It is NOT a clone of FPL or ESPN Fantasy. It has deeply custom mechanics around scoring, transfers, and economy that must be preserved in every plan.

When planning features, always ask: *does this plan respect the custom rules below?* Generic fantasy sports patterns will often be wrong here.

## 4-Phase Roadmap (Priority Order)

1. ~~**Phase 1: Automation (Precision Finish)**~~ ✅ **COMPLETE** — Matchweeks now resolve immediately when FPL marks a GW as `finished` (`events[gw].finished = true`, set after bonus points are applied). Resolution check is embedded in the live stats sync (`/api/sync/stats?mode=fpl_live`); additional daily cron windows at 18:00 and 19:00 UTC cover Saturday/Sunday GW completions. Worst-case gap reduced from 48 hours to ~1 hour.
2. ~~**Phase 2: Tactical Depth (Taxi Squad)**~~ ✅ **COMPLETE** — `'taxi'` added to `roster_status` enum; `taxi_size` (default 3) and `taxi_age_limit` (default 21) added to `leagues` (migration 035). New `POST /api/teams/[teamId]/taxi` route handles `move_to_taxi` (U21 enforcement: birth year ≥ season_start_year − taxi_age_limit, slot limit check) and `activate` (promote to bench, roster space check). Lineup route excludes taxi from valid picks; IR activate route excludes taxi from roster count. Taxi squad starts empty after draft — managers fill post-draft via standard FAAB auctions for U21 players. **My Team taxi/academy UI is shipped** (with IR, reserves, kickoff locks); optional UX polish is tracked in `CURSOR.md` (“My Team & roster — polish backlog”).
3. **Phase 3: Visual Completion & Dark Mode** — **My Team + roster management** are largely done in Cream Editorial; deferrable polish (logos, borders, bench copy, fonts, icons vs emoji, roster page pass) lives in `CURSOR.md`. Remaining Phase 3: Draft, Stats, Dashboard, Dark Mode toggle, shared token/header sweep.
4. **Phase 4: Market Expansion (Loans & Selling)** - Implementing temporary trades (Loans) and Intra-League Auctions (Selling players).

## Architectural Philosophy

### The Sigmoid Engine
The scoring system is built around the principle that **the best real-world players should naturally rise to the top**, regardless of position. Points come from custom Match Ratings — not default FPL points.

- All players are normalized against their position's 3-season baseline (23–26) using a sigmoid curve: `1 / (1 + exp(-z))`
- The Match Rating uses a 1–10 scale (median ~5.5, like SofaScore/L'Equipe). The fantasy points curve uses 4.0 as its floor — an average 5.5 performance yields ~7.2 points, elite performances (8.5+) yield 20+. Poor performances below 3.0 lose points.
- Scoring weights per position group live in `src/lib/scoring/matchRating.ts`
- Attacker ratings are highly sensitive to Finishing (`stddev: 0.15`) — clinicality (goals vs xG) drives elite scores
- A world-class defensive midfielder should outscore a mediocre striker

### Granular Positioning
The positional system is strict and intentional. 12 positions: GK, CB, LB, RB, DM, CM, LM, RM, AM, LW, RW, ST. Players can only be slotted into their primary or secondary position. The slot they occupy changes how their stats are weighted. Do not plan features that flatten or generalize positions. Position slot determines how FPL metrics are weighted in the rating calculation — e.g. a striker's goal involvement carries far more weight than a centreback's. Granular positions are sourced from SoFIFA scrapes (primary + secondary).

### Dynasty Format
Rosters persist year-over-year. Economic decisions (market values, FAAB) have long-term consequences. Plans should account for multi-season implications where relevant.

## Data Model

```
leagues (rules, FAAB config, scoring weights)
  └── teams (manager rosters)
        └── roster_entries (player ↔ team link)
              └── players (master list: stats, market value, form, PPG)
                    └── player_stats (per-match granular FPL stats, cached ratings)

matchups (weekly head-to-head — bragging rights only)
league_standings (view — season-long points, determines winner)
player_rankings (view — overall and positional ranks)

tournaments (cup competitions running concurrently with season)
  └── tournament_rounds → tournament_matchups

waiver_claims (48hr competitive bidding window after a player is dropped)
transactions (full audit log)
trade_proposals (manager-to-manager trades)
rating_reference_stats (sigmoid normalization baselines)
```

### ID System
Three different player IDs exist — plans must specify which one is being used:
- `id` — internal UUID (use for all internal relations)
- `fpl_id` — FPL API identifier (live match data only)
- `api_football_id` — Transfermarkt / market value data only

## Transfer & Economy Rules (Every Plan Touching Transfers Must Follow These)
- **Public FAAB bidding** — all managers see the current highest bid. Never plan a blind bidding UI.
- Dropping a player triggers a **48-hour waiver window** — player is NOT an instant free agent. During this window, any manager can place a competing bid on that player. At the end of 48 hours, the highest bidder wins the player and pays their bid from their FAAB. If nobody bids, the player becomes a free agent and enters the open auction pool.
- During that window, managers bid competitively. Highest bid wins.
- Drop cost: **10% FAAB severance** based on current Transfermarkt market value
- **Scout's Rebate**: the nominating team gets 20% FAAB back if another team wins the auction
- Minimum bid on any player = **20% of Transfermarkt market value**
- Real-world transfer in: When a player transfers into the Premier League, they enter a public FAAB auction following standard rules (48-hour window, minimum bid 20% of market value)
- Real-world transfer out: When a player transfers out of the Premier League, their fantasy owner automatically receives 80% of that player's current Transfermarkt market value as FAAB (e.g. a £100m player = 80 FAAB returned)

## League Format
- 10-team dynasty, traditional standings over 38 games — no playoffs
- Season winner = most accumulated points, not head-to-head results
- Weekly matchups exist for bragging rights and cup competitions only
- Draw rule: `ABS(score_a - score_b) <= 10` → both teams get 1 point

## Tournament Structure

Three tournaments run simultaneously alongside the 38-game regular season.
Matchweek scores count for the regular season and any active tournament round simultaneously.

### League Cup
- Everyone competes regardless of league size
- Single elimination throughout
- Two-legged semifinals
- Schedule: R16 (MW9), QF (MW16), SF (MW21 & MW24), Final (MW31)

### Champions Cup & Consolation Cup

**7-10 teams — standings-based split:**
| League Size | Champions Cup | Consolation Cup |
|---|---|---|
| 10 teams | Top 8 | Bottom 2 |
| 9 teams | Top 7 | Bottom 2 |
| 8 teams | Top 6 | Bottom 2 |
| 7 teams | Top 5 | Bottom 2 |

- Champions Cup: standard bracket, top seeds get byes where needed
- Consolation Cup: bottom 2 teams play a single final match, runs parallel to Champions Cup
- Upper and lower bracket teams never mix

**4-6 teams — everyone enters Champions, Consolation Cup fed by eliminations:**
| League Size | Champions Cup | Consolation Cup |
|---|---|---|
| 6 teams | All 6 | 2 SF losers play final |
| 5 teams | All 5 | QF loser + 2 SF losers (3 teams, MW36-38) |
| 4 teams | All 4 | 2 SF losers play final |

- For 5 teams: QF loser gets bye in Consolation SF, final runs MW38 alongside Champions Final
- For 6 teams: SF losers play straight Consolation Final at MW36-37
- For 4 teams: SF losers play straight Consolation Final at MW36-37

### Champions Cup Schedule (MW32-38)
- Quarterfinals (if applicable): MW32-33
- Semifinals: MW34-35
- Final: MW38

### FAAB Prize Structure
All prizes are FAAB payouts feeding back into the dynasty economy.

**League standings:**
- 1st place: large payout
- 2nd place: modest payout
- Last place: no payout

**Champions Cup:**
- Winner: significant payout
- Runner up: small payout

**Consolation Cup:**
- Winner: modest payout
- Runner up: no payout

## Design System
- **CSS Modules** with CSS variable-based theme — no Tailwind, no inline styles
- **Dual Theme Support**: 
  - **Cream Editorial (Primary)**: `#F7F3ED` background, high-contrast serif typography, premium magazine aesthetic.
  - **Premium Dark (Toggle)**: `var(--color-bg-primary)` (#0a0c10), `var(--color-text-primary)` (#e8eaf0).
- Positional accent colors: `var(--color-pos-gk)`, `var(--color-pos-st)`, etc.
- All components are functional React (TypeScript)
- Mobile-responsive but primarily a desktop experience

The Cream Editorial UI overhaul is actively in progress (Phase 3). Many pages are already converted. Do not introduce new dark-theme patterns or hardcoded hex values — use the CSS variable tokens defined in `globals.css`. See CURSOR.md for the full list of what has and hasn't been converted yet.

## Stitch Prototype Protocol

The Cream Editorial UI has a living Stitch prototype. **Any UI work must consult the prototype HTML before writing CSS.** Guessing at values by eye is unacceptable — spacing, font sizes, colors, and layout structure must come from the actual prototype source.

### MANDATORY: How to Fetch Prototype HTML

Use this exact sequence — **never open the browser for this**:

**Step 1 — Find the right screen** using the Stitch MCP:
```
mcp_StitchMCP_list_screens(projectId: "9034509438526576481")
```
Match the screen title to the page you are working on (e.g. "Trades - Fantasy Futbol Dynasty Redesign").

**Step 2 — Get the HTML download URL** using:
```
mcp_StitchMCP_get_screen(projectId: "9034509438526576481", screenId: "<id>")
```
This returns a `htmlCode.downloadUrl`.

**Step 3 — Fetch the raw HTML** using `curl` in a terminal command (NOT the browser, NOT read_url_content — both strip the CSS):
```bash
curl -sL "<downloadUrl>" | head -400
```
Pipe through `grep` to extract specific sections:
```bash
curl -sL "<downloadUrl>" | grep -A5 "card\|badge\|button\|font-noto"
```

### Stitch Project Reference

- **Project**: "Fantasy Futbol — Cream Editorial UI"
- **Project ID**: `9034509438526576481`
- **Key screen titles → use cases**:
  | Screen Title | Use for |
  |---|---|
  | Trades - Fantasy Futbol Dynasty Redesign | Trade cards, trade block, league feed |
  | Trades - My Trades View | My trades tab layout |
  | League Home - FC Meridian | League home page |
  | The Digital Broadsheet — League Dashboard | Dashboard/home variants |
  | Player Market - Free Agency | FAAB/auction UI |
  | Active Auctions - Player Market | Active auction cards |
  | Matchup Detail — Head-to-Head View | Matchup detail page |
  | Matchup Detail — Side-by-Side View | Matchup alternate layout |
  | League Standings - Dynasty Fantasy Futbol | Standings page |
  | The Transfer Gazette - Activity Log | Activity/transaction log |
  | Cups - League Cup Bracket | Cup bracket UI |

### Prototype CSS Conventions (reference, always verify against actual HTML)

The prototype uses Tailwind classes. Map them to our CSS Modules as follows:
- `font-noto-serif` → `font-family: 'Noto Serif', Georgia, serif` — used for page titles, section headers, TB card player names, FAAB values
- `font-label` → `font-family: 'Inter', sans-serif` — used for ALL labels, kickers, metadata, button text, club names
- `text-primary` → `var(--color-accent-green)` (our dark theme equivalent of the prototype's `#70542c` brown primary)
- `bg-surface-container-lowest` → `var(--color-bg-card)`
- `border-outline-variant/20` → `var(--color-border-subtle)` (low opacity border)
- `text-stone-400` → `var(--color-text-muted)`
- `tracking-widest` → `letter-spacing: 0.2em` approximately
- `tracking-[0.2em]` → `letter-spacing: 0.2em` exactly

**Position badge colors** (from prototype `.badge-*` classes — use these exact hex values, not CSS variables):
- GK: `#D4A017` (amber)
- DEF (CB/LB/RB): `#1E3A5F` (navy)
- MID (DM/CM/LM/RM/AM): `#5C3D8F` (purple)
- ATT (ST): `#8B1A1A` (crimson)
- Wide (LW/RW): `#3A6B4A` (forest green)

- **Design system rules from prototype** (Uses token-based border radius 4px/8px; right-justified action buttons not full-width; generous padding `p-8` = 32px on cards):
- Cards: `border-radius: var(--radius-sm)` (or `var(--radius-md)`) — avoid 0px unless explicitly required for bleed elements.
- Action button rows: `justify-content: flex-end; gap: 8px` — never stretch buttons full-width in trade cards
- Card content padding: `padding: 32px` — not the default 16px

**Player photo rules — apply to every card that shows a player image:**
- Always set `object-fit: cover` AND `object-position: top center` on `<img>` — without `top center`, the crop defaults to the middle, cutting off the face and showing the torso
- Always set `flex-shrink: 0` on the image so it doesn't compress in flex layouts
- **Never put `overflow: hidden` on a card that contains a player photo** — it will clip the image. Put `overflow: hidden` only on a wrapper that does NOT contain the photo, or omit it entirely
- Use `width: 64px; height: 64px` (matches prototype `w-16 h-16`), `border-radius: var(--radius-sm)` for the editorial look. Apply a 1px border.

## Tech Stack
| Layer | Technology |
|---|---|
| Frontend | Next.js App Router, TypeScript, CSS Modules |
| Backend | Supabase (PostgreSQL, RPC, Edge Functions) |
| Hosting | Vercel — **only deploys on `git push`** |
| External Data | FPL API, Transfermarkt, API-Football, SoFIFA |

## Current Working Features
- Draft room (snake draft with auto-pick)
- Trades (proposal, counter-offer, accept/reject)
- FAAB auctions (public bidding, waiver claims)
- Lineup management (positional slot validation)
- Standings (season-long points table)
- Weekly matchups display
- Real-world fixtures
- Cup tournaments (concurrent with season)
- League-wide stats page
- Activity/transaction log
- Player sync (FPL + Transfermarkt ingestion)
- Custom scoring (sigmoid Match Rating engine)
- Cron jobs (auction processing, bot lineup setting)

## Planning Principles

### Thoroughness Standard
Every plan must include tasks for:
- [ ] Happy path — the feature working as intended
- [ ] Edge cases — null stats, missing players, invalid bids, mid-game transfers
- [ ] Empty states — UI when no data exists yet
- [ ] Error states — UI feedback for failed API calls
- [ ] Loading states — skeletons/spinners during data fetch
- [ ] Mobile responsiveness check

If a plan skips any of these, it is incomplete.
Do not make architectural assumptions about unimplemented features. Plan only what is explicitly requested in the current task.

### Deployment Awareness
- Vercel deploys on `git push` only — localhost is invisible to users
- Every implementation plan must end with: `npm run build` → commit → push → verify on live URL

### Vercel Hobby Tier Constraints (Hard Limits — Plans Must Respect These)
- **Cron frequency**: once per day maximum per cron job. Schedules more frequent than daily (e.g. `*/4 * * * *`) will **fail on deployment**. Do not plan sub-daily cron intervals.
- **Multiple crons**: You CAN add multiple separate cron entries at different daily times (e.g. one at 20:00, another at 23:00) — each fires once per day. This is the correct workaround for needing more coverage.
- **Cron precision**: ±59 minutes. Crons fire somewhere within the target hour, not at the exact minute.
- **Max cron jobs**: 100 per project. Currently using 5, so there is room to add more.
- **Max function duration**: 300 seconds (5 minutes) with Vercel's fluid compute enabled (default). The `maxDuration = 60` comments in the codebase are outdated — the actual limit is 300s on Hobby.
- **Function invocations**: 1,000,000 per month included. Heavy sync operations should not be scheduled more than necessary.

### Fragile Areas — Plans Must Flag These
- `matchRating.ts` changes must be mirrored in the `sync-ratings` Edge Function
- Do not trigger batch score recalculations without explicit reason
- Prefer RPCs over raw mutations for FAAB and points-sensitive operations (ACID compliance)
- Never hardcode sigmoid medians/stddevs — always load from DB via `loadReferenceStats()`

### What Has Been Intentionally Decided
- **Public bidding** is a core design choice — do not plan blind auction alternatives
- No real-time websockets — architecture uses polling/revalidation
- Scoring is position-weighted — do not plan features that flatten position importance
- No playoffs — total points determines the champion, always
