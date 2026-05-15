# Gaffa — Cursor Context

## Read First

Before planning or implementing, read:

| File | Role |
|---|---|
| `CLAUDE.md` | Deployment, stack, DB, scoring runbook, definition of done |
| `GEMINI.md` | Product philosophy, mechanics, planning standards |
| This file | Cursor workflow, UI status, Stitch protocol |

If files conflict on execution (build, push, scoring paths), **`CLAUDE.md` wins**.

## Agent Role

**Cursor is the planning + implementation agent** (Antigravity/Gemini substitute in this repo).

| User intent | Action |
|---|---|
| “How should we…”, new feature, large refactor | **Plan first** — files, types, APIs, edge cases; wait for approval unless clearly told to implement |
| Small fix (token, CSS, one-line bug) | Implement directly |
| Scoring / FAAB / standings changes | Extra caution — read Scoring section below; never tune constants to fix one player |

**Commits:** only when the user asks. **Push:** only when asked. **Build:** run before claiming work is done (`CLAUDE.md`).

---

## Scoring V2 — Implementer Notes (Shadow Phase)

Live production still serves **V1** in primary columns. V2 is in `*_v2` columns for comparison.

### When you touch scoring

1. Edit only `src/lib/scoring/matchRating.ts` (and sync/backfill routes if inputs change)
2. `npm run build`
3. Push → wait for Vercel deploy
4. `node scripts/backfill-scoring-v2.mjs` (optionally `--from=N --to=M`)
5. User reviews `/admin/scoring-v2`

### Script output

Per gameweek line example:

`HTTP 200 — stats:412 matchups:15 errors:0`

- **stats** — `player_stats` rows updated with V2 rating/points  
- **matchups** — H2H rows with `score_*_v2` recalculated  
- Script pauses **1.5s** between GWs (FPL rate limits)

### Do not change without explicit approval

- `SIGMOID_K` (stay **1.0** — 1.3 over-inflated elite mids)
- Points exponent (stay **1.5** — 2.0 worsened avg-rating vs PPG inversions)
- `curveFinalRating` coefficients (display scale tied to FotMob targets)
- Per-player hacks

### Intentional product behavior

Higher **peak** games can yield higher season PPG than a player with a higher **average** display rating. The points curve is convex (`exponent 1.5`). Do not “fix” Neto-style examples by flattening the curve unless product reverses that decision.

---

## 4-Phase Roadmap

1. ~~Automation~~ ✅  
2. ~~Taxi squad~~ ✅  
3. **Visual + Scoring V2 shadow** — in progress (`CURSOR.md` UI list; `CLAUDE.md` promotion runbook)  
4. Loans & selling — not started  

---

## Cream Editorial UI — Status

Warm parchment UI replacing legacy dark theme. **Partially complete.**

### Done

- `globals.css` tokens, Google Fonts (Noto Serif, Inter, Work Sans)
- `AppShell` sidebar; league layout uses it
- Navbar, login, dashboard padding
- League Home, Trades (4-tab), Standings, Activity, Matchups (pitch H2H)
- **My Team** — pitch, formation, bench/reserves/taxi/IR, FAAB strip, kickoff locks
- **Roster management** — functional; editorial polish optional
- Token fixes: matchups, tournaments, transfers modals, trades, PlayerDetailCard

### Remaining (Phase 3 UI)

| Area | Status |
|---|---|
| Dashboard (league picker) | Legacy dark |
| Stats | Functional; needs editorial pass |
| Draft room | Complex; needs visual overhaul |
| Fixtures | Legacy layout |
| Dark mode toggle | Not shipped |
| Shared sweep | Hardcoded hex, card headers |

### My Team — polish backlog (deferrable)

- PL club logos (rights + source TBD)
- Player chip borders (position color vs neutral)
- Bench slot labels (shorten “Defender” / “Midfielder” copy)
- Typography pass; emoji → SVG icons
- Roster page spacing/hierarchy to match My Team

### League Home notes

- Matchup hero priority: live → upcoming (FPL bootstrap, `revalidate: 3600`) → last completed
- Top performers: `player_stats` × `players` × `roster_entries`, latest finished GW
- Transfer Gazette: last 5 `transactions` (not editorial articles)
- Stitch screen `9397d59caa074cc382d3eaad4cebac9e`

### Trades notes

- League Feed: all `accepted` trades in league
- Trade-block API: `src/app/api/teams/[teamId]/trade-block/route.ts` — verify HTTP method before fetch
- Stitch screen `0be4d38bf3d7466ba8eaa25b5b936e12`

---

## Design System (locked tokens)

```css
--color-bg-primary: #F7F3ED;
--color-bg-secondary: #EDE8DE;
--color-bg-card: #FDFCF9;
--color-bg-elevated: #EDE8DE;
--color-border: #C8C3BC;
--color-accent-green: #3A6B4A;
--color-text-primary: #1C1C1C;
--font-serif: 'Noto Serif', Georgia, serif;
--font-sans: 'Inter', system-ui, sans-serif;
```

- Page titles: serif bold  
- Nav/body: Work Sans / Inter  
- ALL CAPS labels: Inter, tracked  

### Position badge colors (do not change)

GK amber `#f59e0b`, CB navy `#3b82f6`, FB light blue, DM/CM purples, AM violet, wing green, ST red — see `globals.css` `--color-pos-*`.

### AppShell

- Width 220px / collapsed 60px; `localStorage` `sidebar-collapsed`
- Active item: 3px green left border
- Nav: League, My Team, Matchups, Free Agency, Stats, Cups, Trades, Activity (+ Draft if `setup`/`drafting`)

---

## Stitch Prototype

**Project:** [Gaffa — Cream Editorial UI](https://stitch.withgoogle.com/projects/9034509438526576481)  
**Project ID:** `9034509438526576481`

### Mandatory protocol for UI work

1. `list_screens` → find screen by title  
2. `get_screen` → `htmlCode.downloadUrl`  
3. `curl -sL "<url>"` — **do not guess** spacing/colors from memory  

Pitch: grass `#5A8F6A`, stripe bands, white lines; player chips white card + position pill + surname serif 12px.

---

## Layout Architecture

```
/dashboard                    ← Navbar + main padding
/league/[leagueId]/*          ← AppShell (sidebar + content; AppShell owns padding)
  /team, /team/roster
  /matchups, /players, /stats, /tournaments, /trades, /activity, /draft
/admin/scoring-v2             ← V1 vs V2 shadow comparison
```

Do **not** add extra padding in `(dashboard)/layout.tsx` for league routes — double padding.

---

## Do Not Touch Without Explicit Reason

| Path | Why |
|---|---|
| `src/lib/scoring/matchRating.ts` | Single source of truth; backfill + admin review required |
| `src/lib/scoring/matchRatingV1Legacy.ts` | Frozen V1 until promotion PR |
| `supabase/migrations/` | Schema only via new migration files |
| `040_promote_scoring_v2.sql` | Irreversible until reviewed — user sign-off |
| `src/app/api/cron/process-auctions/` | Server-enforced timing |
| 12-position taxonomy | GK…ST including LWB/RWB — no LM/RM slots |
