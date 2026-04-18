# Fantasy Futbol — Cursor Context

## Read First
Before anything else, read `CLAUDE.md` and `GEMINI.md` in the project root.
- `CLAUDE.md` — execution rules, stack, database schema, coding standards
- `GEMINI.md` — architectural philosophy, game mechanics, planning principles

## Role of This Agent
**This agent (Cursor/Claude) is the Antigravity substitute.** In this project's workflow, Antigravity (Gemini) is the planning layer — it produces detailed implementation plans that Claude Code executes. When working in Cursor, this agent fills that planning role.

**Default behavior: plan first, implement second.**
- When the user asks "how should we do X" or describes a feature → produce a concrete plan (file paths, component names, data shapes, edge cases) as you would hand it to Claude Code
- Only write code when explicitly asked to implement, or when the task is a clear, small execution task (e.g. a token fix, a CSS tweak, a config change)
- If a task is large (new page, new feature, significant refactor) → switch to Plan mode, draft the plan, wait for approval before touching files

## Cursor-Specific Rules
- Never commit or push without running `npm run build` first
- If context files conflict, `CLAUDE.md` and `GEMINI.md` take precedence

---

## 4-Phase Roadmap
1. ~~**Phase 1: Automation (Precision Finish)**~~ ✅ **COMPLETE** — Matchweeks resolve immediately when FPL marks a GW as `finished`. Resolution check embedded in the live stats sync; additional daily cron windows at 18:00/19:00 UTC added. Worst-case gap reduced from 48 hours to ~1 hour.
2. ~~**Phase 2: Tactical Depth (Taxi Squad)**~~ ✅ **COMPLETE** — `'taxi'` added to `roster_status` enum; `taxi_size` (default 3) and `taxi_age_limit` (default 21) added to `leagues`. New `POST /api/teams/[teamId]/taxi` route handles `move_to_taxi` (U21 enforcement, slot limit) and `activate` (promote to bench). Lineup and IR routes patched to exclude taxi players. Taxi squad starts empty after draft; managers fill post-draft via FAAB for U21 players.
3. **Phase 3: Visual Completion & Dark Mode** - Finalizing the Draft, Stats, Dashboard, and the My Team page in the Cream Editorial style, including a Dark Mode toggle. The Taxi Squad portion of My Team depends on Phase 2 — that section cannot be built until Phase 2 is complete.
4. **Phase 4: Market Expansion (Loans & Selling)** - Implementing temporary trades (Loans) and Intra-League Auctions (Selling players).

---

## Current Status: Cream Editorial UI Overhaul (In Progress)

A major UI overhaul is underway. The app previously used a generic dark theme. It is being converted to a "Cream Editorial" aesthetic — warm parchment tones, serif typography, forest green accents. **This is partially implemented.**

### What Has Been Completed
- ✅ `globals.css` — color tokens remapped from dark to cream; `--color-bg-elevated` added
- ✅ Google Fonts loaded: Noto Serif, Work Sans, Inter
- ✅ `src/components/layout/AppShell.tsx` — new sidebar nav component replacing the old horizontal tab bar
- ✅ `src/components/layout/AppShell.module.css` — sidebar styles
- ✅ `league/[leagueId]/layout.tsx` — now uses AppShell instead of LeagueNav
- ✅ `Navbar.tsx` / `Navbar.module.css` — restyled for light mode
- ✅ Login page dark gradient blob removed (`login.module.css`)
- ✅ Dashboard page padding restored (`dashboard/page.tsx`, `dashboard.module.css`)
- ✅ `matchups.module.css` + `matchup-detail.module.css` — stale token replacement
- ✅ `tournaments.module.css` + `bracket.module.css` — stale token replacement
- ✅ `transfers.module.css` — dark `#0f1117` modal inputs fixed
- ✅ `trades.module.css`, `GlobalBidModal.module.css`, `LeagueNav.module.css` — undefined token fixes
- ✅ `PlayerDetailCard.module.css` — dark gradient removed
- ✅ **League Home** — dashboard layout fully implemented
- ✅ **Trades** — 4-tab trade management system done
- ✅ **Standings** (`standings/page.tsx`, `standings.module.css`) — podium + table with form dots, cream editorial styling
- ✅ **Activity Log** — activity feed and live auction grouping refined
- ✅ **Matchups** — head-to-head pitch layout and score badges finished

#### **Phase 3: Visual Completion (In Progress)**
- **Dashboard** (League selection) — *Still in legacy dark theme*
- **Stats** (Detailed filters/tables) — *Functional but needs editorial polish*
- **Draft Room** — *Functionally complex, needs visual overhaul*
- **Fixtures** — *Legacy layout*
- **My Team** (Taxi Squad integration) — *Backend complete (Phase 2). Needs UI: taxi section, move/promote buttons, U21 filter on player browser*
- **Dark Mode Toggle** — *Requirement for accessibility and aesthetic choice*
- **Shared UI sweep** — Final sweep of hardcoded hex values and consistent card headers.

### League Home — Key Implementation Notes
- Matchup hero: Priority 1=live, 2=upcoming (FPL bootstrap-static fetch with `{ next: { revalidate: 3600 } }` — cached 1hr), 3=completed
- Top performers: `player_stats` JOIN `players` JOIN `roster_entries!inner` → most recent completed GW, ordered by `fantasy_points` DESC, limit 5
- Transfer Gazette: condensed `transactions` table (limit 5) — same source as Activity Log, NOT editorial articles
- Stitch prototype: screen `9397d59caa074cc382d3eaad4cebac9e` on project `9034509438526576481`

### Trades — Key Implementation Notes
- League Feed tab: ALL `accepted` trades in the league (including user's own — they also appear in My Trades history)
- Add to Block modal: check `src/app/api/teams/[teamId]/trade-block/route.ts` for exact HTTP method before implementing fetch
- Stitch prototype: screen `0be4d38bf3d7466ba8eaa25b5b936e12` on project `9034509438526576481`

---

## Design System

### Color Tokens (current locked values in `globals.css`)
```css
--color-bg-primary: #F7F3ED;       /* Content area — clean off-white */
--color-bg-secondary: #EDE8DE;     /* Sidebar, topbar — warm cream (darker anchor) */
--color-bg-card: #FDFCF9;          /* Card surfaces — near white */
--color-bg-card-hover: #EDE8E0;    /* Hover/pressed state */
--color-bg-elevated: #EDE8DE;      /* Inset surfaces: inputs, secondary buttons */
--color-border: #C8C3BC;           /* Standard borders */
--color-border-subtle: #D9D4CD;    /* Subtle separators */
--color-accent-green: #3A6B4A;     /* PRIMARY accent — forest green */
--color-accent-blue: #3A6B4A;      /* Alias for green (legacy) */
--color-text-primary: #1C1C1C;     /* Near-black charcoal */
--color-text-secondary: #4A4A4A;   /* Secondary text */
--color-text-muted: #9A9488;       /* Timestamps, labels */
--font-serif: 'Noto Serif', Georgia, serif;
--font-sans: 'Inter', -apple-system, sans-serif;
```

- Use CSS variables for all color values.
- Positional accent colors: `var(--color-pos-gk)`, `var(--color-pos-st)`, etc.

### Typography Convention
- **Page titles / headlines**: `font-family: var(--font-serif)`, bold
- **Nav labels, body copy**: Work Sans (loaded via Google Fonts, falls back to `var(--font-sans)`)
- **Data labels (ALL CAPS, tracked)**: Inter (loaded via Google Fonts, falls back to `var(--font-sans)`)

### Position Badge Colors (DO NOT CHANGE)
```css
--color-pos-gk: #f59e0b;    /* Amber */
--color-pos-cb: #3b82f6;    /* Navy blue */
--color-pos-fb: #60a5fa;    /* Light blue */
--color-pos-dm: #8b5cf6;    /* Purple */
--color-pos-cm: #a78bfa;    /* Light purple */
--color-pos-am: #c084fc;    /* Violet */
--color-pos-lw: #22c55e;    /* Green */
--color-pos-rw: #16a34a;    /* Dark green */
--color-pos-st: #ef4444;    /* Red */
```

### Sidebar (AppShell)
- Expanded: `--sidebar-width: 220px`
- Collapsed: `--sidebar-width-collapsed: 60px`
- State persisted in localStorage (`sidebar-collapsed`)
- Active nav item: 3px left border in `var(--color-accent-green)`, green-tinted bg
- Nav links: League, My Team, Matchups, Free Agency, Stats, Cups, Trades, Activity (+ Draft Channel if league status is setup/drafting)

---

## Stitch Prototype Reference

The Stitch design prototype lives at:
**https://stitch.withgoogle.com/projects/9034509438526576481**

Key design decisions validated there:
- Sidebar nav with collapsible toggle
- Cream content area + slightly darker warm sand sidebar
- Noto Serif bold for page headlines
- Position badge pill colors (GK amber, DEF navy, MID purple, ATT green, ST red)
- Football pitch: bright grass green (`#5A8F6A`) with horizontal stripe bands and white line markings
- No AI-generated player photos
- Player chips on pitch: white card, position badge, surname in Noto Serif 12px, club code, points badge
- Bench/Reserves/Taxi Squad in right sidebar column on My Team page

---

## Stitch Prototype Rule
When implementing any UI page that has a Stitch prototype, you MUST:
1. Call `list_screens` on project 9034509438526576481 to find the screen
2. Call `get_screen` to get the `htmlCode.downloadUrl`
3. `curl` the download URL to fetch the raw HTML
4. Read the actual CSS classes, layout structure, and values from the HTML — do not guess or paraphrase
Only then may you write any CSS or JSX.

## Layout Architecture

```
/dashboard              ← DashboardLayout (Navbar + <main> wrapper with padding)
  /dashboard            ← Dashboard page (league selection, "Welcome back")
  /league/[leagueId]/*  ← LeagueLayout (AppShell: sidebar + content area)
    /                   ← League dashboard (standings + matchups)
    /team               ← My Team (pitch, lineup, bench, reserves, taxi)
    /matchups           ← Matchups
    /players            ← Free Agency / transfers
    /stats              ← League stats
    /tournaments        ← Cup competitions
    /trades             ← Trade proposals
    /activity           ← Activity log
    /draft              ← Draft room (only visible when league status = setup/drafting)
```

**Critical:** `AppShell` provides its own content padding. Do NOT add extra padding at the `(dashboard)/layout.tsx` level — that would double-pad all league pages.

---

## Do Not Touch Without Explicit Reason
- `src/lib/scoring/matchRating.ts` — sigmoid scoring engine; any change must be mirrored in `supabase/functions/sync-ratings/index.ts`
- `supabase/functions/sync-ratings/` — Edge Function mirror of the scoring engine
- `supabase/migrations/` — never alter DB schema directly; all changes go through migration files
- `src/app/api/cron/process-auctions/` — auction processing logic; timing is server-enforced
- The 12-position system (GK, CB, LB, RB, DM, CM, LM, RM, AM, LW, RW, ST) must be preserved everywhere