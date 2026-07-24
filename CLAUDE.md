# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gaffa is a dynasty-style fantasy football (soccer) app for a single private league, live at [gaffa.live](https://gaffa.live). Unlike mainstream fantasy platforms, it mirrors real-world tactical roles and scores players contextually against position-specific statistical baselines rather than flat point tables. Full product/design spec lives in `README.md` — read it for the scoring formulas, position taxonomy, matchup rules, auction economy, and offseason reset logic; this file only covers what's needed to work in the code.

## Commands

Node is installed at `/opt/homebrew/bin/node` (v25) and npm at `/opt/homebrew/bin/npm`. `npx`/`npm run` wrappers may not resolve on PATH in this environment — prefer invoking the binary directly via `node node_modules/...` if a plain `npm run` fails.

```bash
npm run dev                                          # start dev server
npm run build                                        # production build (next build)
npm run lint                                         # eslint
node node_modules/typescript/bin/tsc --noEmit         # typecheck (no separate npm script)
npm run download-team-logos                           # scripts/download-pl-team-logos.mjs
```

There is no test runner configured in this repo (no `test` script, no test framework dependency) — do not assume Jest/Vitest exist.

**Before declaring work done or pushing commits, run `npm run build` and make sure it passes.** This project has no CI; the build is the only correctness gate besides manual verification. (`.cursor/rules/project-context.mdc` encodes the same rule; it also references `CURSOR.md` and `GEMINI.md`, which no longer exist. `ANTIGRAVITY.md` at the repo root documents an unrelated third-party agent tool, not this codebase — ignore it.)

`.claude/launch.json` defines dev servers on ports 3000 / 3010 (`next dev`) and 3005 (`next start`). Another session may already own one — check before starting or killing a server.

## Architecture

### Stack
Next.js 16 App Router + TypeScript + React 19, Supabase (Postgres) for auth/data/RLS, vanilla CSS Modules (no Tailwind/utility CSS — see `src/app/globals.css` for the design token system), Framer Motion for animation. Next.js 16 renamed `middleware.ts` to `proxy.ts` — that rename is already applied at `src/proxy.ts`.

### Directory layout
```
src/app/            Route groups: (auth) for login/signup, (dashboard) for protected pages,
                     plus api/ for route handlers (sync, cron, admin, transfers, etc.)
src/components/      UI components, organized by domain (players, teams, transfers, layout, ui)
src/context/         React context (theme)
src/lib/             Core business logic — see below
src/scripts/         One-off/data scripts colocated with app code
scripts/             Standalone Node/TS scripts run outside the Next.js process (backfills, scrapers)
supabase/migrations/ Sequential numbered SQL migrations — the source of truth for schema; run manually
                     in the Supabase SQL editor (no local migration runner wired up)
specs/               Original planning docs (implementation_plan.md, tasks.md, data source research)
docs/USER_GUIDE.md   Player-facing rules explainer — keep in sync when league mechanics change
scratch/             Ad-hoc throwaway node scripts (DB audits, one-off checks). Not part of the app.
                     Put new one-off investigation scripts here, not at the repo root.
```

The repo root also holds legacy debug/scraper leftovers (`playwright-*.js`, `test-*.js`, `parse-*.js`, `fix_page.js`, `*.json` scrape dumps). They are historical, not wired into the app — don't treat them as reference implementations.

Key domains under `src/lib/`: `scoring/` (the sigmoid rating/points engine and matchup processor), `tournaments/` (cup bracket generation and advancement), `offseason/` (season reset, relegation compensation, prize distribution), `auction/` and `listings/` (bidding economy, sale listings, loans), `roster/` and `lineups/` (lineup validation and auto-subs), `transfers/` (transfer-out compensation), `schedule/` (fixture generation), `season/` (current-season resolution + archives), `narrative/` (generated match reports), `notifications/` + `email/` (in-app notices and Resend templates), `fpl/` and `api-football/` (external data clients), `supabase/` (client/server/admin Supabase clients).

Note that a lot of logic lives in `src/app/api/leagues/[leagueId]/**` route handlers rather than in `src/lib/` — trades, bids, loans, and listing actions each validate and mutate inside their route. Look there before assuming a domain has no implementation.

### Data pipeline
Player and stat data flows from three external sources into Supabase, then through the scoring engine into matchups:
1. **FPL API** → `/api/sync/players` — base player metadata, injury status, live gameweek stats.
2. **SoFIFA** (scraped) → `/api/sync/sofifa-players` — granular primary/secondary tactical positions.
3. **Transfermarkt** (scraped, fuzzy name-matched, threshold 0.72) → market values; a new arrival ≥ £50m auto-triggers a system auction.
4. **Live ingestion**: `/api/sync/stats?mode=fpl_live` fetches live events, runs them through `src/lib/scoring/engine.ts` to produce match ratings and fantasy points, writes to `player_stats`.
5. **Gameweek resolution**: when FPL marks a gameweek finished, the matchup processor (`src/lib/scoring/matchupProcessor.ts`) resolves head-to-head scores, applies auto-subs and role-aware re-scoring, and advances cup tournaments.

Sync/resolution timing is driven by Vercel Cron (`vercel.json`), not `pg_cron` triggers in application code — check `vercel.json` for the current schedule before changing sync frequency assumptions. Important: `vercel.json` does **not** schedule every `/api/cron/*` route. `process-auctions`, `process-loans`, `start-scheduled-drafts`, and `fill-matchup-lineups` exist as endpoints but are not in `vercel.json`; they're triggered externally or manually. Adding a cron route does not schedule it.

Every `/api/sync/*`, `/api/cron/*`, and `/api/admin/*` route gates on the `x-cron-secret` header (`CRON_SECRET`). New routes in those trees should do the same.

### Scoring engine (read `README.md` § "Scoring Engine" before touching this)
`src/lib/scoring/engine.ts` normalizes raw FPL stats into 8 rating components (match_impact, influence, creativity, threat, defensive, goal_involvement, finishing, save_score) via a sigmoid transform against position-specific medians/stddevs stored in the `rating_reference_stats` table. Component scores combine into a composite via positional weights + a "flex" boost on the highest-scoring flex component, then map to a display rating (Fotmob-calibrated) and a separately-calibrated fantasy points scale via a convex curve. Out-of-position defenders take a 20% penalty. Changing weights, K, or the point curve affects historical comparability — check `scripts/backfill-scoring-v2.mjs` and `scripts/recompute_reference_stats.mjs` when doing so, and note migrations `038`–`040` cover the "scoring v2" shadow/promotion rollout pattern used previously.

### Position taxonomy
12 tactical positions (GK, CB, LB, RB, LWB, RWB, DM, CM, AM, LW, RW, ST) — no generic DEF/MID/FWD buckets, no LM/RM (mapped to LW/RW). This taxonomy is enforced across roster validation, lineup eligibility, and scoring weights, so a change to position handling usually touches all three. Formations are restricted to 7 supported layouts (see README for the list).

### Database
Schema lives entirely in `supabase/migrations/*.sql` as sequential numbered files (plus one timestamp-named migration); `ls supabase/migrations | tail` for the current head. Migrations are run manually in the Supabase SQL editor — there's no local runner, so a new migration file is not applied until the user runs it. There's no ORM — queries go through the Supabase JS client (`src/lib/supabase/{client,server,admin}.ts`). Critical game logic (bid resolution, matchup scoring RPCs, trade execution) is implemented as Postgres stored procedures/RPCs, not just application code — check for an existing RPC before reimplementing transactional logic in TypeScript. `admin.ts` uses the service role key and bypasses RLS; only use it in trusted server contexts (cron/admin API routes), never expose it to client code.

Two query conventions that are easy to break:
- Select player columns via `FULL_PLAYER_SELECT` from `src/lib/constants/queries.ts` so rank/stat shape stays consistent app-wide. `player_rankings` is a **view** and cannot be nested-joined through PostgREST — fetch it separately and merge in page logic.
- The current season string ("YYYY-YY") is never hardcoded. It's derived from the FPL bootstrap API by `src/lib/season/currentSeason.ts` (`getCurrentFplSeason` / `getLatestReferenceStatsSeason`), which is the single source of truth and caches per serverless invocation.

### Auth
Supabase SSR via `@supabase/ssr`. Browser client in `src/lib/supabase/client.ts`, server client in `src/lib/supabase/server.ts`. Route groups `(auth)` and `(dashboard)` split public/protected pages; `src/proxy.ts` is where session refresh / route protection happens (the Next.js 16 equivalent of middleware).

### Styling
Strict CSS Modules, no utility CSS frameworks. Design tokens (colors, including a distinct color per tactical position) are defined as CSS custom properties in `src/app/globals.css`; reuse existing `--color-*` tokens instead of hardcoding hex values. Two themes: Cream Editorial (light, serif headings via Newsreader + Hanken Grotesk body) and Premium Dark — every color change must be checked in both.

### User-facing copy
"FAAB" is internal vocabulary only: the DB column is `faab_budget`, but all UI text, error messages, and emails say **"Club Balance"** (or "budget"), formatted as `€{n}m`. The budget is uncapped and a permanent dynasty asset — never render it as a spent/remaining usage meter. Leagues are dynasty and never reach a "completed" state; they cycle season → offseason → season indefinitely.

## Environment

Required vars (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `API_FOOTBALL_KEY` (free tier, 100 req/day — doesn't cover `big_chances_created`, see `specs/research_data_sources.md`), `CRON_SECRET` (protects cron/admin API routes — pass as `x-cron-secret` header).
