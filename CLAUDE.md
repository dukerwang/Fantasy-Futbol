# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gaffa is a dynasty-style fantasy football (soccer) app for a single private league, live at [gaffa.live](https://gaffa.live). Unlike mainstream fantasy platforms, it mirrors real-world tactical roles and scores players contextually against position-specific statistical baselines rather than flat point tables. Full product/design spec lives in `README.md` — read it for the scoring formulas, position taxonomy, matchup rules, auction economy, and offseason reset logic; this file only covers what's needed to work in the code.

**`docs/USER_GUIDE.md` is the canonical statement of intent** — written for players, but it's also the most reliable single place to check *why* a mechanic works the way it does before changing it (each rule is paired with the reasoning behind it, e.g. why the draw band exists, why loans are capped 1-out/2-in, why retention pays only 60%). Spot-checked against the code as of 2026-08: `DRAW_THRESHOLD = 10` (`src/lib/scoring/matchupProcessor.ts`), `BENCH_DEPTH_BONUS` 25% (`src/types`), OOP penalty 20% (`src/lib/scoring/engine.ts`), severance 20%/min €2m (`src/lib/roster/executeDrop.ts`), solidarity 20% pool / 10% scout / 10% split (`src/lib/economy/solidarity.ts`), free-agent bid floor 50% and listing floor 80% (`src/lib/auction/leagueAuctionSettings.ts`, listings route), auction timing 72h initial window / 24h min-duration / decaying inactivity timeout / quiet hours (`src/lib/auction/timer.ts`), academy age cutoff 21 (`taxi_age_limit`, migration 035), retained-list compensation rate 60% (`COMPENSATION_RATE`, `src/lib/transfers/compensation.ts`), loan caps 1 out / 2 in and buyback fee 25 (migration 060), match revenue win/draw/loss/bye = 2.5/1.5/0.5/1.5 (`src/lib/economy/meritPayments.ts`), season/cup prizes 40→20 placement, 40/15 Champions Cup, 20/8 League/Consolation Cup (`src/lib/offseason/prizeDistribution.ts`) — all matched the guide exactly. Update the guide whenever one of these numbers or rules changes in code; it drifting out of sync (like the formations count already has — see Position taxonomy below) is worse than not having it.

## Commands

Node is installed at `/opt/homebrew/bin/node` (v25) and npm at `/opt/homebrew/bin/npm`. `npx`/`npm run` wrappers may not resolve on PATH in this environment — prefer invoking the binary directly via `node node_modules/...` if a plain `npm run` fails.

```bash
npm run dev                                          # start dev server
npm run build                                        # production build (next build)
npm run lint                                         # eslint
node node_modules/typescript/bin/tsc --noEmit         # typecheck (no separate npm script)
npm run download-team-logos                           # scripts/download-pl-team-logos.mjs
```

Tests run under **vitest** (`npm test` → `vitest run`). `vitest.config.ts` includes only `src/**/__tests__/**/*.test.ts`; widen that glob when tests land elsewhere. Current coverage: the scoring engine (`src/lib/scoring/__tests__/`), the economy modules (`src/lib/economy/__tests__/`) and the prize curve (`src/lib/offseason/__tests__/`).

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
supabase/migrations/ Sequential numbered SQL migrations — the source of truth for schema; applied via
                     the Supabase MCP `apply_migration` tool against project "Gaffa" (no local runner)
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

### Club identity (never key anything on an FPL team id)

FPL's `teams[].id` is 1–20 assigned **alphabetically over whichever 20 clubs are in the division that season**, so it is reassigned every summer. The same is true of `fixtures[].id`, which restarts at 1 each season. Keying durable data on either silently corrupts history at the rollover — it already destroyed the 2025-26 fixture list and turned `team-logos/19.png` from West Ham's badge into Spurs'.

- **The stable key is the slug** in `src/lib/clubs/clubs.json`, surfaced by `src/lib/clubs/registry.ts`. Resolve clubs by name via `resolveClub()`, which handles every feed spelling. Badges are `/team-logos/{slug}.png`. Relegated clubs keep their entry; add a new one when a club is promoted.
- `fplCode` in that registry is FPL's *other* identifier — genuinely stable per club (Man Utd is always 1) — and is used only to fetch badge art. `slugMapFromBootstrapTeams()` is the one sanctioned place to interpret a seasonal team id, and only against the payload it arrived in.
- `pl_fixtures` is keyed `(season, fpl_fixture_id)` with clubs as slugs; write to it only through `src/lib/fixtures/upsertFixtures.ts`.
- **`players.pl_team` / `pl_team_id` describe the player's club TODAY**, not in any past season — the table is overwritten by every sync, and its `pl_season` column is not reliably updated with it. For anything archived, join `player_season_clubs (player_id, season) → club_slug` instead, or you will attribute every summer transfer to the wrong club.

`clubs.json` is deliberately data, not TypeScript, so `scripts/download-pl-team-logos.mjs` and the app read identical bytes. Do not reintroduce parsing of the `.ts` file — an earlier version did, and mispaired a slug with the next club's code the moment a name needed double quotes.

### Position taxonomy
12 tactical positions (GK, CB, LB, RB, LWB, RWB, DM, CM, AM, LW, RW, ST) — no generic DEF/MID/FWD buckets, no LM/RM (mapped to LW/RW). This taxonomy is enforced across roster validation, lineup eligibility, and scoring weights, so a change to position handling usually touches all three. Formations are restricted to **10** supported layouts — `src/types/index.ts` `Formation` is the source of truth. (README says seven; it is wrong.)

### Database
Schema lives entirely in `supabase/migrations/*.sql` as sequential numbered files (plus one timestamp-named migration); `ls supabase/migrations | tail` for the current head. There's no local migration runner — after writing a new migration file, apply it immediately via the Supabase MCP `mcp__<supabase-server>__apply_migration` tool (project name **"Gaffa"**, id `hnkavimrsbytsesdzwvj` — the org also has unrelated "Futbolpedia"/"Futbolpedia 2" projects, both INACTIVE; never guess, confirm via `list_projects` if the id isn't already known this session) rather than telling the user to paste it into the SQL editor. Still confirm before applying anything genuinely destructive (`DROP`/`TRUNCATE`/irreversible data rewrites) — routine additive migrations (new tables/columns/functions/RLS policies/cron jobs, the vast majority of this project's history) don't need to wait for a yes. Note `list_migrations` under-reports what's actually live: a long run of past migrations were applied by pasting raw SQL into the dashboard editor rather than through a tracked flow, so its history has gaps that don't reflect reality — verify actual DB state with `execute_sql` (e.g. `SELECT * FROM cron.job`, `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'`) rather than trusting that list. If the MCP connection isn't authenticated/available this session, fall back to asking the user to run it manually and say why. There's no ORM — queries go through the Supabase JS client (`src/lib/supabase/{client,server,admin}.ts`). Critical game logic (bid resolution, matchup scoring RPCs, trade execution) is implemented as Postgres stored procedures/RPCs, not just application code — check for an existing RPC before reimplementing transactional logic in TypeScript. `admin.ts` uses the service role key and bypasses RLS; only use it in trusted server contexts (cron/admin API routes), never expose it to client code.

Two query conventions that are easy to break:
- Select player columns via `FULL_PLAYER_SELECT` from `src/lib/constants/queries.ts` so rank/stat shape stays consistent app-wide. `player_rankings` is a **view** and cannot be nested-joined through PostgREST — fetch it separately and merge in page logic.
- The current season string ("YYYY-YY") is never hardcoded. It's derived from the FPL bootstrap API by `src/lib/season/currentSeason.ts` (`getCurrentFplSeason` / `getLatestReferenceStatsSeason`), which is the single source of truth and caches per serverless invocation.

### Auth
Supabase SSR via `@supabase/ssr`. Browser client in `src/lib/supabase/client.ts`, server client in `src/lib/supabase/server.ts`. Route groups `(auth)` and `(dashboard)` split public/protected pages; `src/proxy.ts` is where session refresh / route protection happens (the Next.js 16 equivalent of middleware).

### Styling
Strict CSS Modules, no utility CSS frameworks. Design tokens (colors, including a distinct color per tactical position) are defined as CSS custom properties in `src/app/globals.css`; reuse existing `--color-*` tokens instead of hardcoding hex values. Two themes: Cream Editorial (light, serif headings via Newsreader + Hanken Grotesk body) and Premium Dark — every color change must be checked in both.

### User-facing copy
"FAAB" is internal vocabulary only: the DB column is `faab_budget`, but all UI text, error messages, and emails say **"Club Balance"** (or "budget"), formatted as `€{n}m`. The budget is uncapped and a permanent dynasty asset — never render it as a spent/remaining usage meter. Leagues are dynasty and never reach a "completed" state; they cycle season → offseason → season indefinitely.

### Domain rules that aren't obvious from the code alone
Non-negotiable mechanics from `docs/USER_GUIDE.md` that are easy to get wrong when touching adjacent code, because nothing about the schema or types forces them:
- **Eligibility is exact-position only** — a bench CB never covers an LB slot, even though both are "defenders." Never infer cover from the DEF/MID/ATT/FLEX bench category; that grouping controls *where a player may sit*, not what he can *cover*.
- **Auto-sub bench search order is fixed: DEF, then MID, then ATT, then FLEX** — a sub is also re-rated at the slot he fills, not his own position (§5 in the guide, `matchupProcessor.ts`).
- **Two independent lockouts**: formation locks when *any* squad player's match kicks off; an individual player locks only when *his own* club kicks off. Don't collapse these into one lock.
- **Cup ties never draw.** Level score → best individual performer wins it → still level (including 0–0, where nobody has a "best performer") → higher bracket seed advances. The league's 10-point draw band only applies to regular-season matchups.
- **IR gates auction bidding, not roster space**: no cap on IR, but a team can't place any bid while a healthy player sits on IR — check `roster_status` before allowing a bid, don't just check roster count.
- **Release vs. Retain on departure is mutually exclusive and the exclusion travels with the compensation, not the player**: taking compensation bars that manager from the return auction even if the retained rights claim is later traded away — see `src/lib/transfers/compensation.ts`.
- **The draft happens exactly once per league**, ever — there's no per-season re-draft; everything after is auctions/trades/loans. Don't build features assuming a recurring draft.
- **Points floor at zero, never negative** — a red card or a terrible match can only reduce a player's contribution to nothing.

## Environment

Required vars (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `API_FOOTBALL_KEY` (free tier, 100 req/day — doesn't cover `big_chances_created`, see `specs/research_data_sources.md`), `CRON_SECRET` (protects cron/admin API routes — pass as `x-cron-secret` header).
