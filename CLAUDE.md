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

**Before declaring work done or pushing commits, run `npm run build` and make sure it passes.** This project has no CI; the build is the only correctness gate besides manual verification.

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
```

Key domains under `src/lib/`: `scoring/` (the sigmoid rating/points engine and matchup processor), `tournaments/` (cup bracket generation and advancement), `offseason/` (season reset, relegation compensation, prize distribution), `auction/` and `listings/` (FAAB bidding economy), `roster/` and `lineups/` (lineup validation and auto-subs), `transfers/` (transfer-out compensation), `fpl/` and `api-football/` (external data clients), `supabase/` (client/server/admin Supabase clients), `email/` (Resend templates).

### Data pipeline
Player and stat data flows from three external sources into Supabase, then through the scoring engine into matchups:
1. **FPL API** → `/api/sync/players` — base player metadata, injury status, live gameweek stats.
2. **SoFIFA** (scraped) → `/api/sync/sofifa-players` — granular primary/secondary tactical positions.
3. **Transfermarkt** (scraped, fuzzy name-matched, threshold 0.72) → market values; a new arrival ≥ £40m auto-triggers a system auction.
4. **Live ingestion**: `/api/sync/stats?mode=fpl_live` fetches live events, runs them through `src/lib/scoring/engine.ts` to produce match ratings and fantasy points, writes to `player_stats`.
5. **Gameweek resolution**: when FPL marks a gameweek finished, the matchup processor (`src/lib/scoring/matchupProcessor.ts`) resolves head-to-head scores, applies auto-subs and role-aware re-scoring, and advances cup tournaments.

Sync/resolution timing is driven entirely by Vercel Cron (`vercel.json`), not `pg_cron` triggers in application code — check `vercel.json` for the current schedule before changing sync frequency assumptions.

### Scoring engine (read `README.md` § "Scoring Engine" before touching this)
`src/lib/scoring/engine.ts` normalizes raw FPL stats into 8 rating components (match_impact, influence, creativity, threat, defensive, goal_involvement, finishing, save_score) via a sigmoid transform against position-specific medians/stddevs stored in the `rating_reference_stats` table. Component scores combine into a composite via positional weights + a "flex" boost on the highest-scoring flex component, then map to a display rating (Fotmob-calibrated) and a separately-calibrated fantasy points scale via a convex curve. Out-of-position defenders take a 20% penalty. Changing weights, K, or the point curve affects historical comparability — check `scripts/backfill-scoring-v2.mjs` and `scripts/recompute_reference_stats.mjs` when doing so, and note migrations `038`–`040` cover the "scoring v2" shadow/promotion rollout pattern used previously.

### Position taxonomy
12 tactical positions (GK, CB, LB, RB, LWB, RWB, DM, CM, AM, LW, RW, ST) — no generic DEF/MID/FWD buckets, no LM/RM (mapped to LW/RW). This taxonomy is enforced across roster validation, lineup eligibility, and scoring weights, so a change to position handling usually touches all three. Formations are restricted to 7 supported layouts (see README for the list).

### Database
Schema lives entirely in `supabase/migrations/*.sql` as sequential numbered files (currently up to `063`, plus one timestamp-named migration). There's no ORM — queries go through the Supabase JS client (`src/lib/supabase/{client,server,admin}.ts`). Critical game logic (bid resolution, matchup scoring RPCs, trade execution) is implemented as Postgres stored procedures/RPCs, not just application code — check for an existing RPC before reimplementing transactional logic in TypeScript. `admin.ts` uses the service role key and bypasses RLS; only use it in trusted server contexts (cron/admin API routes), never expose it to client code.

### Auth
Supabase SSR via `@supabase/ssr`. Browser client in `src/lib/supabase/client.ts`, server client in `src/lib/supabase/server.ts`. Route groups `(auth)` and `(dashboard)` split public/protected pages; `src/proxy.ts` is where session refresh / route protection happens (the Next.js 16 equivalent of middleware).

### Styling
Strict CSS Modules, no utility CSS frameworks. Design tokens (colors, including a distinct color per tactical position) are defined as CSS custom properties in `src/app/globals.css`; reuse existing `--color-*` tokens instead of hardcoding hex values. Two themes: Cream Editorial (light, serif headings via Newsreader + Hanken Grotesk body) and Premium Dark.

## Environment

Required vars (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `API_FOOTBALL_KEY` (free tier, 100 req/day — doesn't cover `big_chances_created`, see `specs/research_data_sources.md`), `CRON_SECRET` (protects cron/admin API routes — pass as `x-cron-secret` header).
