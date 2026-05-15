# Gaffa — Claude Code Execution Context

> **Agent routing:** Claude Code prioritizes this file; also read `CURSOR.md` and `GEMINI.md`. Cursor / Antigravity agents read all three before implementing.

## CRITICAL: Deployment Rules

- Hosted on **Vercel** at [gaffa.live](https://gaffa.live) (alias `fantasy-futbol-tau.vercel.app`)
- Local changes are **not visible** until pushed to GitHub → Vercel auto-deploys `main`
- After every implementation: `npm run build` (must pass) → `git add` → `git commit` → `git push`
- Never claim a feature is live until `git push` succeeds
- `npm run dev` does not prove production behavior

## Commands

```bash
npm run dev        # local dev (port 3000)
npm run build      # production build — required before every push
npm run lint       # ESLint
git push           # triggers Vercel deployment
```

- **Migrations:** add `.sql` under `supabase/migrations/`, apply via Supabase Dashboard or CLI
- **Edge Functions:** `supabase functions deploy [slug]` (scoring no longer uses Edge Functions — see Scoring below)

## Stack

| Layer | Technology |
|---|---|
| Frontend | Next.js App Router, TypeScript, **CSS Modules only** (no Tailwind) |
| Backend | Supabase (PostgreSQL, RPCs) |
| Auth | Supabase Auth |
| Hosting | Vercel |
| Data | FPL API (live stats), Transfermarkt (market values), API-Football, SoFIFA (positions) |

**Season context:** Active development targets **2025/26** FPL data (`defensive_contribution`, current squads). Do not assume 2024/25 rosters or stats.

## 4-Phase Roadmap

1. ~~**Phase 1: Automation (Precision Finish)**~~ ✅ — GW resolves when FPL `events[gw].finished`; embedded in live stats sync + daily crons (18:00/19:00 UTC). Worst-case gap ~1 hour (was ~48h).
2. ~~**Phase 2: Tactical Depth (Taxi Squad)**~~ ✅ — `roster_status` includes `taxi`; `taxi_size` / `taxi_age_limit` on `leagues`; `POST /api/teams/[teamId]/taxi`; lineup/IR exclude taxi from counts.
3. **Phase 3: Visual Completion & Scoring V2** — Cream Editorial UI (see `CURSOR.md`). **Scoring V2** in shadow validation on 25/26 (see Scoring below); promotion after sign-off.
4. **Phase 4: Market Expansion (Loans & Selling)** — temporary loans + intra-league selling auctions.

## Project Structure

```
src/
  app/
    (auth)/              # login, signup
    (dashboard)/         # league UI + admin
      admin/scoring-v2/  # V1 vs V2 comparison (shadow validation)
      league/[leagueId]/ # draft, trades, players, standings, matchups, team, roster, …
    api/
      sync/              # FPL stats sync (live + cron)
      cron/              # auctions, bot lineups, resolution windows
      admin/             # backfill-scoring-v2, admin utilities
      leagues/ teams/    # domain routes
  components/            # auth, players, layout, transfers, teams
  lib/
    scoring/             # matchRating.ts — SINGLE SOURCE OF TRUTH
      matchRating.ts     # V2 engine
      matchRatingV1Legacy.ts  # frozen V1 (dual-write only; delete at promotion)
      engine.ts          # re-exports calculateMatchRating
      matchupProcessor.ts
      matchups.ts
    supabase/ fpl/ api-football/ transfers/ tournaments/ schedule/

supabase/migrations/     # 037+ removed sync-ratings edge cron; 039 shadow cols; 040 promotion (DO NOT apply yet)
scripts/
  backfill-scoring-v2.mjs
  recompute_reference_stats.mjs
```

## Scoring Engine (Handle With Extreme Care)

### Source of truth

- **V2 engine:** `src/lib/scoring/matchRating.ts` (imported via `src/lib/scoring/engine.ts`)
- **V1 frozen:** `src/lib/scoring/matchRatingV1Legacy.ts` — used only for dual-write to primary columns during shadow phase
- **Deleted:** Supabase Edge Function `sync-ratings` (migration `037`). **Never** add a parallel scoring implementation.

### Runtime paths

| Path | What runs |
|---|---|
| Live sync | Cron → `POST /api/sync/stats?mode=fpl_live` → V2 + V1 → `player_stats` (primary = V1, `*_v2` = V2) |
| Matchup resolution | `processMatchupsForGameweek()` in `matchupProcessor.ts` (not `resolve_matchup` RPC) |
| Historical V2 backfill | `node scripts/backfill-scoring-v2.mjs` → `POST /api/admin/backfill-scoring-v2` per GW |
| Admin review | `/admin/scoring-v2` |

### Pipeline (V2)

1. **Sigmoid normalize** raw inputs → 0–1 per component (`sigmoidNormalize`, `SIGMOID_K`)
2. **Position weights** + flex → composite 0–1 (`POSITION_WEIGHTS`, `FLEX_CONFIG`)
3. **Display rating** — `curveFinalRating`: `3.0 + 7.0 × composite` (FotMob-like; median starter ≈ **6.5**)
4. **Fantasy points** — `calculateFantasyPoints` on internal scoring scale `1.0 + 9.0 × composite` (display and points are **decoupled**)

### Current calibration (May 2026 — do not change without explicit product sign-off)

| Constant | Value | Notes |
|---|---|---|
| `SIGMOID_K` | **1.0** | Neutral spread. **Rejected:** `1.3` — inflated elite AM/CM season averages (e.g. Bruno ~8.4). |
| Display scale | `3.0 + 7.0 × composite` | Average game ≈ 6–6.5; good ≈ 7; exceptional ≈ 8; masterclass 9+ |
| Points `scale` | **6.0** | Up from 5.0 for slightly wider PPG gaps |
| Points exponent | **1.5** | Convex curve rewards **peak games** (intentional). **Rejected:** `2.0` — stronger variance artifact (lower avg rating can beat higher avg PPG). |
| Points floor | `basePoints = 4.0`, curve on `(rating - 4) / 2` | Sub-60 min: −1 pt; rating &lt; 3: −2 pts |

Approximate points targets (display rating): 6.5 → ~8 pts, 7.0 → ~11, 8.0 → ~19, 9.0 → ~29.

### Design goals (product)

- **FotMob-like** display distribution (not FPL default points)
- **Positional balance** — top DM/CB can compete with top attackers; `match_impact` (BPS-driven) matters for mids/defenders
- **Real-life accuracy** — best real-world players rise; no per-player hardcoding
- **Peak performances matter** — explosive GWs can lift season PPG above a steadier, higher-rated player; do not “fix” this with exponent ≤ 1 unless product explicitly reverses

### Critical data bug (fixed — keep fixed)

Per-fixture `bps` must **not** come from FPL `explain` (no `bps` key there). Both sync and backfill use:

```typescript
bps: Math.round((el.stats.bps ?? 0) * ratio)  // ratio = fixture minutes / GW total minutes
```

Broken `bps` zeroed `match_impact` and collapsed DM/CM/CB vs attackers.

### Reference stats

- Load at runtime: `loadReferenceStats()` from `rating_reference_stats` table
- Regenerate: `node scripts/recompute_reference_stats.mjs` (new season or raw-input formula changes)
- `DEFAULT_REFERENCE_STATS` in `matchRating.ts` — **fallback only**, never primary

### Shadow validation (25/26 season)

Migration **039** added nullable shadow columns:

- `player_stats.match_rating_v2`, `fantasy_points_v2`
- `matchups.score_a_v2`, `score_b_v2`

Primary columns still hold **V1** until promotion. Role-aware slot scoring at matchup resolution uses lineup slot position (Phase 2 of rebalance).

### Phase 3D promotion runbook (after full-season sign-off in `/admin/scoring-v2`)

1. `node scripts/backfill-scoring-v2.mjs` (GW 1–38; script prints `stats:N matchups:M` per GW)
2. Review `/admin/scoring-v2` — stop if distributions or spot-checks look wrong
3. Apply migration **`040_promote_scoring_v2.sql`** (copies v2 → primary, drops shadow cols, recomputes winners)
4. Same PR: delete `matchRatingV1Legacy.ts`; remove V1 dual-write in `/api/sync/stats/route.ts` and `matchupProcessor.ts`; remove `/admin/scoring-v2` + `/api/admin/backfill-scoring-v2`
5. `npm run build` → commit → push

**Do not apply migration 040** until the user signs off.

## Database (core tables)

| Table | Purpose |
|---|---|
| `users`, `leagues`, `teams`, `league_members` | Tenancy & config |
| `players` | Master list (PPG, form, market value, positions) |
| `roster_entries` | `active` / `bench` / `ir` / `taxi` |
| `player_stats` | Per-fixture FPL stats + cached ratings (V1 primary, V2 shadow) |
| `rating_reference_stats` | Sigmoid baselines per position × component |
| `matchups` | Weekly H2H (bragging + cups); draw if `ABS(score_a - score_b) <= 10` |
| `waiver_claims`, `transactions`, `trade_proposals` | Economy audit trail |
| `tournaments` + rounds/matchups | Cups |

**Views:** `league_standings` (season points), `player_rankings`

## Key RPCs

```sql
resolve_matchup(...)   -- EXISTS but NOT used; app uses processMatchupsForGameweek() in TS
increment_team_points(team_id, pts)
update_player_form_ratings()
```

**Prefer RPCs** for FAAB and points-sensitive mutations (ACID). Do not bypass with ad-hoc handler writes for money or standings.

## ID System — Critical

| ID | Use |
|---|---|
| `players.id` | Internal UUID — all relations |
| `players.fpl_id` | FPL live fetch only |
| `players.api_football_id` | Market value / API-Football only |

Never mix these in queries or caches.

## Positional System

**12 granular positions:** GK, CB, LB, RB, LWB, RWB, DM, CM, AM, LW, RW, ST (no LM/RM in app taxonomy).

- Primary or secondary slot only (enforced in lineup)
- **Slot position** drives scoring weights for that matchup (role-aware resolution)
- SoFIFA ingest maps legacy LM/RM → LWB/RWB or LW/RW (see `GEMINI.md`)

## Design System

- **CSS Modules** + tokens in `src/app/globals.css` — no Tailwind, no inline styles, no hardcoded hex in modules
- **Cream Editorial** (default): `#F7F3ED` bg, Noto Serif headlines, forest green `#3A6B4A` accent
- **Premium Dark** (toggle planned): CSS variables swap theme
- Typography: `--font-serif` (Noto Serif), `--font-sans` (Inter)
- Position badge colors: `--color-pos-*` — do not change without design review (`CURSOR.md`)

## Core Mechanics

### FAAB / transfers

- **Public** highest bid visible to all managers
- Drop → **48-hour waiver** before free agency; competitive bids; highest wins
- Drop cost: **10%** of Transfermarkt value (severance)
- **Scout's Rebate:** 20% to nominator if another team wins
- Min bid: **20%** of market value

### League format

- Dynasty, 4–10 teams, 38 GWs, **no playoffs** — most `league_points` wins
- Weekly matchups: bragging + cups only
- Draw: `ABS(score_a - score_b) <= 10`

## Coding Standards

- TypeScript strict; avoid `any` (comment if unavoidable)
- Functional React components only
- Loading, error, and empty states required in UI
- Admin → `/api/admin/`; debug → `/api/debug/` (never productize debug routes)
- Remove dead code on finish; run `npm run lint` before commit

## Known Fragile Areas

- `matchRating.ts` — any change affects perception of all player values; requires backfill + admin review
- Waiver/auction **48h** must be server-enforced
- Lineup slot weights — position-specific; never flatten
- `fpl_id` ↔ `id` mapping in sync routes
- Vercel crons in `/api/cron/` and `/api/sync/` — verify on live after deploy

## Definition of Done

- [ ] `npm run build` passes (fix loop until clean)
- [ ] Edge cases: null stats, missing players, invalid bids, mid-GW moves
- [ ] UI: loading, error, empty states; mobile checked
- [ ] Committed and pushed; verified on `gaffa.live` when user expects production
