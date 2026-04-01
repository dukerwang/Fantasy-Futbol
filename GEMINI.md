# Fantasy Futbol — Planning Context (Antigravity / Gemini)

Plans produced here are handed off to Claude Code for execution. Write implementation plans with enough specificity that an AI agent with no additional context can execute them — include file paths, function names, DB tables, and edge cases explicitly. Do not execute code yourself.

Your default mode in this file is planning only. Never write, create, or modify files unless explicitly told to implement. If the user asks a question or requests changes to a plan, update the plan document only. Wait for explicit instruction like "implement this" or "execute" before touching any code.

## What This App Is
Vision: Fantasy Futbol is built to be a more realistic, tactically deep alternative to mainstream dynasty apps like Sleeper. Where those apps abstract away football into arbitrary point systems, Fantasy Futbol mirrors how real football actually works — managers negotiate for players through public auctions (like real transfer windows), players are scored based on how they actually performed in their real-world position, and the best real-world players are the most valuable fantasy assets. Every mechanic should reinforce this philosophy: if a feature would feel at home in Sleeper but wouldn't make sense in the context of real football management, it probably needs rethinking.

Fantasy Futbol is a multi-tenant dynasty fantasy soccer platform. Leagues support 4–10 managers and are invite-based. Anyone can create or join a league. It is NOT a clone of FPL or ESPN Fantasy. It has deeply custom mechanics around scoring, transfers, and economy that must be preserved in every plan.

When planning features, always ask: *does this plan respect the custom rules below?* Generic fantasy sports patterns will often be wrong here.

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

## Design System
- **CSS Modules** with CSS variable-based theme — no Tailwind, no inline styles
- Premium dark aesthetic: `var(--color-bg-primary)` (#0a0c10), `var(--color-text-primary)` (#e8eaf0)
- Positional accent colors: `var(--color-pos-gk)`, `var(--color-pos-st)`, etc.
- All components are functional React (TypeScript)
- Mobile-responsive but primarily a desktop experience

A full UI overhaul is planned — do not extend the current design system, just maintain it until the overhaul is explicitly scoped.

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
