# Fantasy Futbol — Claude Code Execution Context

## CRITICAL: Deployment Rules
- This app is hosted on **Vercel** at `fantasy-futbol-tau.vercel.app`
- Local changes are **NOT visible to the user** until pushed to GitHub
- After every implementation: `npm run build` (must pass) → `git add . && git commit -m "..." && git push`
- Never tell the user a feature is live until after `git push` has run successfully
- Do not assume `npm run dev` output proves anything works in production

## Commands
```bash
npm run dev        # local dev server (port 3000)
npm run build      # production build — run this before every push
npm run lint       # lint check
git push           # triggers Vercel deployment
```

Database migrations: apply new `.sql` files in `supabase/migrations/` via Supabase Dashboard or CLI.
Edge Functions: deploy via `supabase functions deploy [slug]`.

## Stack
- **Frontend**: Next.js App Router, TypeScript, CSS Modules (vanilla — no Tailwind)
- **Backend**: Supabase (PostgreSQL), RPC functions, Edge Functions
- **Auth**: Supabase Auth
- **Hosting**: Vercel (auto-deploys on git push to main)
- **External APIs**: FPL API (stats), Transfermarkt (market values), API-Football, SoFIFA

## 4-Phase Roadmap
1. ~~**Phase 1: Automation (Precision Finish)**~~ ✅ **COMPLETE** — Matchweeks resolve immediately when FPL marks a GW as `finished`. Resolution check embedded in the live stats sync; additional daily cron windows at 18:00/19:00 UTC added. Worst-case gap reduced from 48 hours to ~1 hour.
2. **Phase 2: Tactical Depth (Taxi Squad)** - Implementing the "B-team" storage mechanics and DB structure for youth/stash players.
3. **Phase 3: Visual Completion & Dark Mode** - Finalizing the Draft, Stats, Dashboard, and the My Team page in the Cream Editorial style, including a Dark Mode toggle. The Taxi Squad portion of My Team depends on Phase 2 — cannot be built until Phase 2 is complete.
4. **Phase 4: Market Expansion (Loans & Selling)** - Implementing temporary trades (Loans) and Intra-League Auctions (Selling players).

## Project Structure
```
src/
  app/
    (auth)/           # login, signup pages
    (dashboard)/      # all league UI pages
      league/[leagueId]/
        draft/        # draft room
        trades/       # trade proposals
        players/      # player browser
        standings/    # league standings
        matchups/     # weekly matchups
        team/         # user's team/lineup
        fixtures/     # real-world fixtures
        tournaments/  # cup tournaments
        stats/        # league stats
        activity/     # transaction log
    api/
      leagues/[leagueId]/   # league actions (draft, trades, auctions)
      teams/[teamId]/       # roster actions (lineup, drop, IR, trade-block)
      sync/                 # data sync routes (players, stats, matchups)
      cron/                 # scheduled jobs (process-auctions, set-bot-lineups)
      admin/                # admin-only utilities
      debug/                # debug routes (non-production)
  components/
    auth/ players/ layout/ transfers/ teams/
  lib/
    scoring/          # custom rating engine — MOST FRAGILE AREA
    supabase/         # Supabase client + helpers
    fpl/              # FPL API integration
    api-football/     # API-Football integration
    transfers/        # transfer/FAAB logic
    tournaments/      # cup tournament logic
    schedule/         # fixture schedule helpers

supabase/
  migrations/         # all DB migrations
  functions/
    sync-ratings/     # Edge Function — must stay in sync with matchRating.ts
```

## Scoring Engine (Handle With Extreme Care)
- Primary source: `src/lib/scoring/matchRating.ts`
- **CRITICAL**: Any changes to `matchRating.ts` MUST be manually mirrored in `supabase/functions/sync-ratings/index.ts`
- Uses sigmoid normalization: `sigmoidNormalize(val, median, stddev)`
- Always load reference stats from DB using `loadReferenceStats()` — never hardcode medians/stddevs
- Use `DEFAULT_REFERENCE_STATS` only as a fallback, never as primary values
- Ratings are cached in `player_stats` — do not trigger batch recalculations without a clear reason
- Scoring weights per position group are in `matchRating.ts` — attacker ratings are highly sensitive to Finishing (`stddev: 0.15`)

## Database Tables
| Table | Purpose | Rows |
|---|---|---|
| `users` | Auth users | 37 |
| `leagues` | League configs, FAAB settings, scoring weights | 9 |
| `teams` | Manager teams within leagues | 35 |
| `players` | Master player list — 28 columns, PPG, form, market value | 825 |
| `roster_entries` | Player ↔ team link, contract/slot info | 524 |
| `player_stats` | Granular per-match FPL stats (cached ratings here) | 9,320 |
| `rating_reference_stats` | Baseline stats for sigmoid normalization | 96 |
| `matchups` | Weekly head-to-head matchups | 151 |
| `league_standings` | Computed view — rank by `league_points` | view |
| `player_rankings` | Overall and positional ranks | view |
| `draft_picks` | Draft order and picks | 524 |
| `draft_queues` | Pre-draft player queues | — |
| `waiver_claims` | Active waiver bids (48hr window) | — |
| `transactions` | Full audit log of all moves | — |
| `trade_proposals` | Manager-to-manager trades | — |
| `tournaments` | Cup tournament instances | — |
| `tournament_rounds` | Rounds within tournaments | — |
| `tournament_matchups` | Individual cup matchups | — |
| `league_members` | Users ↔ leagues junction | — |

## Key RPCs & Views
```sql
-- RPCs
resolve_matchup(p_matchup_id, p_score_a, p_score_b, ...)  -- exists in DB but NOT called by app code; runtime uses processMatchupsForGameweek() in TypeScript instead
increment_team_points(team_id, pts)
update_player_form_ratings()   -- updates form_rating and ppg on players table

-- Views
league_standings   -- rank by league_points; draw = ABS(score_a - score_b) <= 10
player_rankings    -- overall and positional ranks
```

**Prefer RPCs for any FAAB or points-sensitive updates** — ensures ACID compliance. Do not write raw mutations in route handlers for financial or scoring operations.

**Note on matchup resolution**: Do not use the `resolve_matchup` RPC for resolving league matchups. Call `processMatchupsForGameweek(gameweek, finished)` from `src/lib/scoring/matchupProcessor.ts` — that is the actual runtime path.

## ID System — Critical
Three different player ID types exist. Never confuse them:
- `id` — internal UUID (primary key, use this for all internal relations)
- `fpl_id` — FPL API identifier (use only for FPL live data fetches)
- `api_football_id` — API-Football / Transfermarkt identifier (use for market value data)

## Design System
- **CSS Modules only** — no Tailwind, no inline styles, no styled-components
- All tokens defined in `src/app/globals.css` — never hardcode hex values in module CSS files
- **Dual Theme Support**: 
  - **Cream Editorial (Primary)**: `#F7F3ED` background, high-contrast serif typography, premium magazine aesthetic.
  - **Premium Dark (Toggle)**: `var(--color-bg-primary)` (#0a0c10), `var(--color-text-primary)` (#e8eaf0).

### Locked Color Tokens
| Token | Value | Usage |
|---|---|---|
| `--color-bg-primary` | #F7F3ED | Main content area background |
| `--color-bg-secondary` | #EDE8DE | Sidebar, topbar — warm cream anchor |
| `--color-bg-card` | #FDFCF9 | Card surfaces — near white |
| `--color-bg-card-hover` | #EDE8E0 | Hover/pressed state for cards |
| `--color-bg-elevated` | #EDE8DE | Inset elements: inputs, secondary buttons |
| `--color-border` | #C8C3BC | Standard borders |
| `--color-border-subtle` | #D9D4CD | Subtle separators |
| `--color-accent-green` | #3A6B4A | Primary accent — forest green |
| `--color-text-primary` | #1C1C1C | Primary text |
| `--color-text-secondary` | #4A4A4A | Secondary text |
| `--color-text-muted` | #9A9488 | Muted/placeholder text |

### Typography
- `--font-serif`: Noto Serif — player names, team names, stat values, page headings
- `--font-sans`: Inter — body text, labels, nav items

- Use CSS variables for all color values.
- Positional accent colors: `var(--color-pos-gk)`, `var(--color-pos-st)`, etc.

## Core Mechanics (Read Before Touching Transfers or Scoring)

### Positional System
- 12 granular positions: GK, CB, LB, RB, DM, CM, LM, RM, AM, LW, RW, ST
- Players can only be slotted into their primary or secondary position — strictly enforced
- The slot a player occupies changes how their stats are weighted in scoring

### FAAB / Transfer Economy
- **Public bidding** — all managers see the current highest bid (not blind)
- Dropping a player triggers a **48-hour waiver window** before they become a free agent
- Drop cost: **10% FAAB severance** based on current Transfermarkt market value
- **Scout's Rebate**: nominating team gets 20% FAAB back if another team wins the auction
- Minimum bid = 20% of Transfermarkt market value

### League Format
- Dynasty (rosters persist year-over-year), 4-10 teams
- Season winner = most points after 38 games — no playoffs
- Weekly matchups are for bragging rights and cup competitions only
- Draw awarded when `ABS(score_a - score_b) <= 10`

## Coding Standards
- TypeScript strictly — no `any` unless unavoidable (add a comment explaining why)
- Functional components only — no class components
- Always handle loading, error, and empty states in UI components
- Migrations go in `supabase/migrations/` — never alter DB schema directly
- Admin utilities → `/api/admin/`, debug tools → `/api/debug/` (never ship debug routes as features)
- When refactoring or finishing a feature, remove unused imports, dead code, and unreachable branches. Run npm run lint and fix all warnings before committing.

## Known Fragile Areas
- `src/lib/scoring/matchRating.ts` + its Edge Function mirror — changes affect all historical scores
- Waiver/auction timing — 48hr window must be server-enforced, not client-side
- Lineup slot scoring weights — position-dependent, do not generalize or flatten
- ID mapping between `fpl_id`, `api_football_id`, and internal `id`
- Vercel cron jobs (`/api/cron/` and `/api/sync/`) — verify on live after every push; cron-triggered routes live in both directories

## Definition of Done
A feature is **NOT complete** until all of the following are true:
- [ ] After writing code, run npm run build. If it fails, read the errors, fix them, and run again. Loop until the build passes clean — do not stop and ask the user. Only then commit and push.
- [ ] Edge cases handled: `null` stats, missing players, invalid bids, mid-game transfers
- [ ] Error states: UI feedback for failed API calls
- [ ] Empty states: placeholder UI when no data exists
- [ ] Loading states: skeletons or spinners during data fetch
- [ ] Mobile responsiveness checked
- [ ] `npm run build` passes with zero errors
- [ ] Code committed and pushed → verified live on `fantasy-futbol-tau.vercel.app`
