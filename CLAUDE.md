# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Gaffa is a dynasty-style fantasy football (soccer) app for a single private league, live at [gaffa.live](https://gaffa.live). Unlike mainstream fantasy platforms, it mirrors real-world tactical roles and scores players contextually against position-specific statistical baselines rather than flat point tables. Full product/design spec lives in `README.md` — read it for the scoring formulas, position taxonomy, matchup rules, auction economy, and offseason reset logic; this file only covers what's needed to work in the code.

**`docs/USER_GUIDE.md` is the canonical statement of intent** — written for players, but it's also the most reliable single place to check *why* a mechanic works the way it does before changing it (each rule is paired with the reasoning behind it, e.g. why the draw band exists, why loans are capped 1-out/2-in, why retention pays only 60%). Spot-checked against the code as of 2026-08: `DRAW_THRESHOLD = 10` (`src/lib/scoring/matchupProcessor.ts`), `BENCH_DEPTH_BONUS` 25% (`src/types`), OOP penalty 20% (`src/lib/scoring/engine.ts`), no appearance credit for any position and no goalkeeper points haircut (both removed 2026-08-23; keeper balance now sits in `GK_CLEAN_SHEET` / `GK_GOAL_CONCEDED` / `GK_XGC_DIFF` in `src/lib/scoring/matchRating.ts`, which `scripts/recompute_reference_stats.mjs` duplicates — keep the two in step, they had silently drifted apart before), severance 20%/min €2m (`src/lib/roster/executeDrop.ts`), solidarity 20% pool / 10% scout / 10% split (`src/lib/economy/solidarity.ts`), free-agent bid floor 50% and listing floor 60% (`src/lib/auction/leagueAuctionSettings.ts`, `supabase/migrations/129_lower_listing_min_bid_floor.sql`, listings route), auction timing 72h initial window / 24h min-duration / decaying inactivity timeout / quiet hours (`src/lib/auction/timer.ts`), academy age cutoff 21 (`taxi_age_limit`, migration 035), retained-list compensation rate 60% (`COMPENSATION_RATE`, `src/lib/transfers/compensation.ts`), loan caps 1 out / 2 in and buyback fee 25 (migration 060), match revenue win/draw/loss/bye = 2.5/1.5/0.5/1.5 (`src/lib/economy/meritPayments.ts`), season/cup prizes 40→20 placement, 50/20 Champions Cup, 25/10 League/Consolation Cup (`src/lib/offseason/prizeDistribution.ts`) — all matched the guide exactly. Update the guide whenever one of these numbers or rules changes in code; it drifting out of sync (like the formations count already has — see Position taxonomy below) is worse than not having it.

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

**Before declaring work done or pushing commits, run `npm run build` and make sure it passes.** This project has no CI; the build is the only correctness gate besides manual verification. (`.cursor/rules/project-context.mdc`, `.cursorrules`, and `AGENTS.md` encode the same rule.)

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

The repo root holds live scraper tooling (`playwright-sofifa.js`) plus one-off investigation scripts in `scratch/`. Don't treat scratch or historical dumps as reference implementations — see "Local scraper tooling" below before writing a replacement.

Key domains under `src/lib/`: `effect/` (Effect-TS standard library runtime, typed errors, service layers, and Next.js route adapters — see `docs/EFFECT.md`), `scoring/` (the sigmoid rating/points engine and matchup processor), `tournaments/` (cup bracket generation and advancement), `offseason/` (season reset, relegation compensation, prize distribution), `auction/` and `listings/` (bidding economy, sale listings, loans), `roster/` and `lineups/` (lineup validation and auto-subs), `transfers/` (transfer-out compensation), `schedule/` (fixture generation), `season/` (current-season resolution + archives), `narrative/` (generated match reports), `notifications/` + `email/` (in-app notices and Resend templates), `fpl/` and `api-football/` (external data clients), `supabase/` (client/server/admin Supabase clients).

Note that a lot of logic lives in `src/app/api/leagues/[leagueId]/**` route handlers rather than in `src/lib/` — trades, bids, loans, and listing actions each validate and mutate inside their route. Look there before assuming a domain has no implementation. When authoring or refactoring background syncs, cron routes, or external integrations, prefer writing them with Effect (`src/lib/effect/` and `runApiEffect`) as documented in `docs/EFFECT.md`.

### Data pipeline
Player and stat data flows from three external sources into Supabase, then through the scoring engine into matchups:
1. **FPL API** → `/api/sync/players` — base player metadata, injury status, live gameweek stats.
2. **SoFIFA** (scraped) → `/api/sync/sofifa-players` — granular primary/secondary tactical positions.
3. **Transfermarkt** (scraped, fuzzy name-matched, threshold 0.72) → market values; a new arrival ≥ £50m auto-triggers a system auction.
4. **Live ingestion**: `/api/sync/stats?mode=fpl_live` fetches live events, runs them through `src/lib/scoring/engine.ts` to produce match ratings and fantasy points, writes to `player_stats`.
5. **Gameweek resolution**: when FPL marks a gameweek finished *and* the post-lockdown stats pass has run, the matchup processor (`src/lib/scoring/matchupProcessor.ts`) resolves head-to-head scores, applies auto-subs and role-aware re-scoring, and advances cup tournaments.

### FPL's 2026/27 lockdown, and why scores are provisional until it passes

FPL moved its gameweek lockdown to **09:00 UK on the day after the gameweek's final match**, so post-match Opta review data can be folded into BPS and defensive contribution points. Two consequences drive real logic here, and neither is visible from the schema:

- **The ICT block reads 0.0 for every player during the live window.** It is not noise: ICT carries 6% of a GK's positional weight and 50% of an AM's, so scoring against zeroes drags midfielders down roughly five times harder than centre-backs (measured: −0.15 rating for GK, −0.65 for AM). `src/lib/scoring/ictImputation.ts` estimates the block from the stats FPL *does* publish (bps above all), which cuts mean absolute rating error from 0.338 to 0.110 and positional bias from 0.51 to 0.05. Rows scored this way carry `ict_imputed: true` in their stats JSON. Coefficients are checked in as `ictImputation.json` and refitted by `scripts/fit_ict_imputation.ts` — **refit once 2026/27 has ~5 gameweeks of its own data**, because FPL also changed the BPS formula and bps is the strongest feature.
- **A gameweek must not be locked on FPL's `finished` flag alone.** Locking is irreversible in normal operation (`processMatchupsForGameweek` skips anything already `completed`), so resolving on `finished` freezes whatever provisional stats happen to be in our DB. The gate is `gameweek_sync_state.final_synced_at` (migration 135), written by the one post-lockdown pass in `/api/sync/stats`. Three separate paths reach the lock — the resolve cron, the stats sync, and *a plain page load on the matchups screen* — so the check lives inside `processMatchupsForGameweek` rather than at each call site. `/api/sync/matchups?finished=true&force=true` is the deliberate override.

`vercel.json` runs a stats sync at **08:15 and 09:15 UTC** specifically to land the post-lockdown pass. Two, because Vercel crons are UTC and 09:00 UK is 08:00 UTC under BST but 09:00 UTC under GMT — 08:15 lands promptly in summer, 09:15 is the winter backstop. The redundant one is nearly free: once `final_synced_at` is set the sync short-circuits before fetching the ~600-player payload. Until that pass runs, matchup cards read "Provisional" rather than "Final" (`src/lib/scoring/gameweekState.ts`).

Note `finished_provisional` lives on FPL **fixtures**, not events — an event has only `finished` and `data_checked`. Two separate attempts have now gated event logic on `e.finished_provisional === true`, which is always `undefined === true`; the dead branch silently disabled the fix each time. Don't reintroduce it.

Sync/resolution timing is driven by Vercel Cron (`vercel.json`), not `pg_cron` triggers in application code — check `vercel.json` for the current schedule before changing sync frequency assumptions. Important: `vercel.json` does **not** schedule every `/api/cron/*` route. `process-auctions`, `process-loans`, `start-scheduled-drafts`, and `fill-matchup-lineups` exist as endpoints but are not in `vercel.json`; they're triggered externally or manually. Adding a cron route does not schedule it.

Every `/api/sync/*`, `/api/cron/*`, and `/api/admin/*` route gates on the `x-cron-secret` header (`CRON_SECRET`). New routes in those trees should do the same.

### Local scraper tooling (Transfermarkt, SoFIFA)

`/api/sync/players` and `/api/sync/stats` are plain HTTP routes, callable from anywhere (Vercel Cron, curl, this session) via `x-cron-secret`. Transfermarkt and SoFIFA are **not** — both block cloud/CI IPs (Vercel, GitHub Actions' shared runners), and SoFIFA sits behind an interactive Cloudflare challenge on top of that. Their sync tooling runs from a real machine (the maintainer's Mac) instead, and it already exists — **check here before writing a new gap-fill/backfill script for either**, one already got written from scratch and had to be thrown away mid-session before this section existed.

- **Transfermarkt gap-fill** — `scripts/sync_transfermarkt_gaps.ts` (invoked via `scripts/run_transfermarkt_gaps.sh`), a dependency-free fetch-based scraper: per-player search + profile lookup, writes `market_value`. Flags: `--apply` (write; dry-run is the default), `--all` (include unrostered players, not just rostered), `--full` (re-check every targeted player instead of only ones with a suspect/never-set value — for periodic drift correction, not the daily gap-fill). Already scheduled outside Vercel via macOS `launchd`: `com.gaffa.transfermarkt-gaps-daily` (`--all --apply`, daily 9am) and `com.gaffa.transfermarkt-full-monthly` (`--all --full --apply`, 1st of the month). Run `launchctl list | grep gaffa` and check `~/Library/LaunchAgents/com.gaffa.transfermarkt-*.plist` before assuming a manual run is needed — the daily job usually already covers it.
- **Transfermarkt full squad crawl** — `scripts/sync_transfermarkt.ts`, a heavier tool that shells out to the `dcaribou/transfermarkt-scraper` Python CLI (needs cloning into `scripts/scrapers/transfermarkt-scraper` + `poetry install`, not currently set up in this environment). This is the nominal "full" sync; in practice the gap-fill script above covers day-to-day needs without that setup.
- **SoFIFA positions** — `playwright-sofifa.js` at the repo root: a real (headful) Chrome session via Playwright that scrapes squad/position/role data and POSTs it to `/api/sync/sofifa-players` as `preloadedTeams`. `--headful` is effectively required — headless gets zero results even with a previously-warmed session, because SoFIFA's Cloudflare check evaluates the live request, not just cookie validity. A "Verify you are human" checkbox may appear in the opened window; a human clicks it, then the script proceeds unattended. `--top5` additionally scrapes La Liga/Serie A/Bundesliga/Ligue 1 into `sofifa_position_reference` — the cache `syncPlayers.ts` draws from to give a brand-new PL arrival a real position on day one instead of a coarse GK/DEF/MID/FWD default — and only needs running 1-2x/year. `--only=<team,team,...>` (comma-separated, substring match against SoFIFA's team names) scopes a run to specific clubs instead of a whole league; use this to fill gaps for a handful of new arrivals rather than re-crawling everything. `--send-only` resends the last scrape (`scraped-sofifa.json`) without re-scraping, e.g. after a failed POST. Point it at production with `SOFIFA_SYNC_URL=https://gaffa.live/api/sync/sofifa-players` (defaults to localhost:3000).
- `/api/sync/sofifa-players` also has a second, direct-fetch code path gated on a `SOFIFA_CF_CLEARANCE` env var (a manually-copied `cf_clearance` cookie value) for when no `preloadedTeams` body is sent. This is a separate, effectively-unused cron-style path — don't confuse it with the checkbox-driven Playwright flow above, and don't treat a missing `SOFIFA_CF_CLEARANCE` as a blocker; it isn't part of the normal workflow.
- **`sofifa_position_reference`** has grown past 1,000 rows — any query against it from application code (not just the sync) must paginate (`.range()`) or it silently truncates under PostgREST's default page size.

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
12 tactical positions (GK, CB, LB, RB, LWB, RWB, DM, CM, AM, LW, RW, ST) — no generic DEF/MID/FWD buckets, no LM/RM (mapped to LW/RW). This taxonomy is enforced across roster validation, lineup eligibility, and scoring weights, so a change to position handling usually touches all three. Formations are restricted to **12** supported layouts — `src/types/index.ts` `Formation` is the source of truth. README and `docs/USER_GUIDE.md` are kept in sync with this list; update both whenever it changes.

### Database
Schema lives entirely in `supabase/migrations/*.sql` as sequential numbered files (plus one timestamp-named migration); `ls supabase/migrations | tail` for the current head. There's no local migration runner — after writing a new migration file, apply it immediately via the Supabase MCP `mcp__<supabase-server>__apply_migration` tool (project name **"Gaffa"**, id `hnkavimrsbytsesdzwvj` — the org also has unrelated "Futbolpedia"/"Futbolpedia 2" projects, both INACTIVE; never guess, confirm via `list_projects` if the id isn't already known this session) rather than telling the user to paste it into the SQL editor. Still confirm before applying anything genuinely destructive (`DROP`/`TRUNCATE`/irreversible data rewrites) — routine additive migrations (new tables/columns/functions/RLS policies/cron jobs, the vast majority of this project's history) don't need to wait for a yes. Note `list_migrations` under-reports what's actually live: a long run of past migrations were applied by pasting raw SQL into the dashboard editor rather than through a tracked flow, so its history has gaps that don't reflect reality — verify actual DB state with `execute_sql` (e.g. `SELECT * FROM cron.job`, `SELECT tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime'`) rather than trusting that list. If the MCP connection isn't authenticated/available this session, fall back to asking the user to run it manually and say why. There's no ORM — queries go through the Supabase JS client (`src/lib/supabase/{client,server,admin}.ts`). Critical game logic (bid resolution, matchup scoring RPCs, trade execution) is implemented as Postgres stored procedures/RPCs, not just application code — check for an existing RPC before reimplementing transactional logic in TypeScript. `admin.ts` uses the service role key and bypasses RLS; only use it in trusted server contexts (cron/admin API routes), never expose it to client code.

Two query conventions that are easy to break:
- Select player columns via `FULL_PLAYER_SELECT` from `src/lib/constants/queries.ts` so rank/stat shape stays consistent app-wide. `player_rankings` is a **view** and cannot be nested-joined through PostgREST — fetch it separately and merge in page logic.
- The current season string ("YYYY-YY") is never hardcoded. It's derived from the FPL bootstrap API by `src/lib/season/currentSeason.ts` (`getCurrentFplSeason` / `getLatestReferenceStatsSeason`), which is the single source of truth and caches per serverless invocation.

### Auth
Supabase SSR via `@supabase/ssr`. Browser client in `src/lib/supabase/client.ts`, server client in `src/lib/supabase/server.ts`. Route groups `(auth)` and `(dashboard)` split public/protected pages; `src/proxy.ts` is where session refresh / route protection happens (the Next.js 16 equivalent of middleware).

### Styling & UI Design
Strict CSS Modules, no utility CSS frameworks. Design tokens (colors, including a distinct color per tactical position) are defined as CSS custom properties in `src/app/globals.css`; reuse existing `--color-*` tokens instead of hardcoding hex values. Two themes: Cream Editorial (light, serif headings via Newsreader + Hanken Grotesk body) and Premium Dark — every color change must be checked in both.

**Before modifying or designing any UI components, layout, typography, or CSS, read `DESIGN.md`.** It describes tokens as shipped, mobile standards (dynamic viewport `dvh`, bottom sheets, touch targets), and explicit anti-patterns (no eyebrows/kickers, no colored left container stripes, no heavy wireframe borders, no uppercase buttons).

**Before making a design argument or asserting policy, read `docs/DECISIONS.md`.** It records what Duke has actually decided, quoted and dated. `DESIGN.md` describes what the code currently does and tags every claim `[code]` / `[decided]` / `[inferred]`.

This distinction is load-bearing, not bookkeeping. Gaffa is a solo repo, so git attributes every commit to Duke no matter who wrote the content — which means **prose in `design-2.0/`, in `globals.css` comments, and in component comments is frequently agent-written and was never ratified by anyone.** A previous session invented a colour law, later sessions read it as settled, cited it back to Duke as his own rule, spread it to ~20 files, and designed workarounds for problems the invented rule had itself created. Duke's instruction on finding it: *"i don't want polluted context that affects your (and future agent) decisionmaking."*

So: don't treat a confident sentence in a repo doc as a decision. If you can't cite a file or a message from Duke, mark it as inference and say so. Never coin a named rule and never cite one back to him as his.

### User-facing copy & prose style (Google Developer Style)
All frontend UI copy, microcopy, error messages, documentation, and agent responses must strictly follow the **Google Developer Documentation Style Guide** (`developers.google.com/style`) to eliminate "Claude-lish" AI assistant mannerisms:
- **Voice & Person**: Active voice ("Click Submit", "The server returns an acknowledgment"). Address the user as "you", never "we".
- **No Throat-Clearing**: Cut opening cheerleading ("Certainly!", "Great question!", "I'd be happy to help!"). Answer directly.
- **No Polite Filler**: Never say "please" on routine instructions ("Click Save", not "Please click Save").
- **Word Choice**: Delete "just", "simply", "easily", and "obviously". Replace "allows you to" with "lets you". Use specific verbs instead of "access".
- **No Hedge-Stacking**: Cut "it is worth noting that", "this might potentially", etc. State facts directly.
- **Em-Dash Restraint**: Avoid using em dashes as a sentence-joining tic; split sentences instead.
- **Prose Over Lists**: Do not list-ify everything into bullets. Use natural prose paragraphs; save lists for sequential steps or parallel items.
- **Sentence Case**: Use sentence case for headings, section titles, and buttons ("Submit proposal", not "Submit Proposal").
- **Vocabulary**: "FAAB" is internal vocabulary only (`faab_budget`), but all UI text, error messages, and emails say **"Club Balance"** (or "budget"), formatted as `€{n}m`. Never render it as a spent/remaining usage meter. Leagues cycle indefinitely; they are never "completed".

### Agent skills policy
- **Recommended skills**:
  - `emil-design-eng`: Implements §4.A of `DESIGN.md` (button press physics, modal/drawer transitions, origin-aware popovers, snappy <250ms threshold).
  - `apple-design`: Implements §4.B of `DESIGN.md` (mobile touch ergonomics, dynamic viewport `dvh`, safe-area insets, bottom sheets).
  - `google-dev-style`: Guides all UI copy, error messages, docs, and communication.
  - `modern-web-guidance`: Provides modern CSS APIs (`:has()`, container queries, modern dialog/popover) instead of JS workarounds.
  - `impeccable` (in `Operate` mode): High-density dashboard, data table, and app shell refinement.
  - `full-output-enforcement`: Prevents code truncation and placeholder comments.
  - `animate`: Targeted CSS and Framer Motion transitions calibrated to Gaffa's tokens.
- **Banned skills (do not use in this repo)**:
  - `industrial-brutalist-ui`: Conflicts with Gaffa's calm European broadsheet journal identity; enforces military/CRT terminal aesthetics and all-caps headings.
  - `high-end-visual-design` (`soft-skill`): Mandates title eyebrows (banned by Duke), bans sticky topbars (violates the green topbar), and forces pill buttons.
  - `design-taste-frontend` (`taste-skill` v1/v2) & `gpt-taste`: Designed for marketing landing pages/portfolios, not dashboards or data tables; attempts to introduce Tailwind and GSAP marketing heroes.
  - `minimalist-ui`: Bans colored header sections (breaks green topbar) and forces monochrome `#111111` buttons with pastels, conflicting with the green ramp and 12 tactical position colors.
  - `stitch-design-taste`: Designed to generate new `DESIGN.md` files from scratch; risks overwriting Gaffa's custom palette and locked decisions.
  - `image-to-code`: Scaffolds disposable marketing pages from synthetic mockups rather than working inside Gaffa's design system.

### Domain rules that aren't obvious from the code alone
Non-negotiable mechanics from `docs/USER_GUIDE.md` that are easy to get wrong when touching adjacent code, because nothing about the schema or types forces them:
- **Eligibility is exact-position only** — a bench CB never covers an LB slot, even though both are "defenders." Never infer cover from the DEF/MID/ATT/FLEX bench category; that grouping controls *where a player may sit*, not what he can *cover*.
- **Auto-sub bench search order is fixed: DEF, then MID, then ATT, then FLEX** — a sub is also re-rated at the slot he fills, not his own position (§5 in the guide, `matchupProcessor.ts`).
- **Two independent lockouts**: formation locks when *any* squad player's match kicks off; an individual player locks only when *his own* club kicks off. Don't collapse these into one lock. Once the gameweek's last *dated* kickoff has passed, next week's lineup and academy moves unlock — do not wait for matchup `completed` / the 09:00 UK review. This week's scores and live matchup stay on home/matchups until that row completes. IR and drops stay on the scoring week (`src/lib/lineups/editTarget.ts`).
- **Free-agent auctions settle at the clock.** Kickoff lock only defers manager listings and a locked drop-player on the winning bid. Trades, loans, and drops of locked players still wait until the gameweek finishes (`resolve_single_player_auction_rpc`, migration 136). Auction cards read "settling" while the lot is still live past zero, not "ended."
- **Cup ties never draw.** Level score → best individual performer wins it → still level (including 0–0, where nobody has a "best performer") → higher bracket seed advances. The league's 10-point draw band only applies to regular-season matchups.
- **IR gates auction bidding independently of its own slot cap**: IR is capped at `leagues.ir_size` (default 2, migration 127, enforced in `src/app/api/teams/[teamId]/ir/route.ts`), and separately a team can't place any bid while a healthy player sits on IR — check `roster_status` before allowing a bid, don't just check roster count. Neither rule substitutes for the other.
- **Release vs. Retain on departure is mutually exclusive and the exclusion travels with the compensation, not the player**: taking compensation bars that manager from the return auction even if the retained rights claim is later traded away — see `src/lib/transfers/compensation.ts`.
- **The draft happens exactly once per league**, ever — there's no per-season re-draft; everything after is auctions/trades/loans. Don't build features assuming a recurring draft.
- **Points floor at zero, never negative** — a red card or a terrible match can only reduce a player's contribution to nothing.

### Resource limits, server efficiency, and cost awareness
All AI agents and assistants working in this repo must actively design and execute for cost and resource efficiency. Never blindly invoke remote endpoints, introduce unthrottled polling, or run heavy data workloads through production serverless functions.

- **Vercel (Hobby compute)**: 1,000,000 Function Invocations per rolling 30-day window; 4 Fluid Active CPU hours per month.
  - **Prefer local compute for batch work**: When generating scouting outlooks, backfilling data, or running multi-minute syncs, run them locally via CLI scripts (`scripts/...` or `tsx ...`) directly against Postgres. Do not route heavy batch jobs through Vercel serverless functions when a local script can do it.
  - **Avoid unthrottled remote loops**: Do not repeatedly hammer remote Vercel API routes in loops if a direct database query or local script achieves the same result. Only invoke remote routes when testing them or when no local equivalent exists.
  - **No client-side polling**: Do not use `setInterval` to poll Next.js API routes from client components. Use Supabase Realtime WebSockets directly (0 Vercel invocations).
- **Supabase (Postgres & Realtime)**: Free tier storage, 200 concurrent Realtime connections, 500 MB DB size.
  - **Batching & pagination**: Avoid N+1 queries. PostgREST truncates queries at 1,000 rows, so paginate (`.range()`) whenever querying large tables (`player_stats`, `sofifa_position_reference`).
  - **Use database RPCs**: Prefer Postgres RPCs and stored procedures for complex transactions (bids, trades, payouts) instead of multiple round trips from application code.
  - **Channel cleanup**: Always clean up Realtime subscriptions on component unmount (`supabase.removeChannel(channel)`).
- **Google Gemini / AI Studio (Scouting reports & outlooks)**: Monthly spend cap on Google AI Studio project.
  - **Cache search queries**: Share head-coach and club queries across players. Do not regenerate outlooks that already match the current `PIPELINE_VERSION`. Respect `OUTLOOK_MONTHLY_GROUNDED_CAP`.
- **External data sources**: API-Football (100 req/day limit); SoFIFA & Transfermarkt (scrape locally only via `playwright-sofifa.js` and `scripts/sync_transfermarkt_gaps.ts`, never from cloud IPs).
- **The efficiency principle**: Before proposing or running any operational task, think: *How can we achieve the desired outcome with minimum remote invocations, lowest CPU time, and zero unnecessary API spend while maintaining speed and correctness?*

## Environment

Required vars (see `.env.example`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `API_FOOTBALL_KEY` (free tier, 100 req/day — doesn't cover `big_chances_created`, see `specs/research_data_sources.md`), `CRON_SECRET` (protects cron/admin API routes — pass as `x-cron-secret` header).
