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

## Current Status: Cream Editorial UI Overhaul (In Progress)

A major UI overhaul is underway. The app previously used a generic dark theme. It is being converted to a "Cream Editorial" aesthetic — warm parchment tones, serif typography, forest green accents. **This is partially implemented.**

### What Has Been Completed
- ✅ `globals.css` — color tokens remapped from dark to cream (see Design System below)
- ✅ Google Fonts loaded: Noto Serif, Work Sans, Inter
- ✅ `src/components/layout/AppShell.tsx` — new sidebar nav component replacing the old horizontal tab bar
- ✅ `src/components/layout/AppShell.module.css` — sidebar styles
- ✅ `league/[leagueId]/layout.tsx` — now uses AppShell instead of LeagueNav
- ✅ `Navbar.tsx` / `Navbar.module.css` — restyled for light mode
- ✅ Login page dark gradient blob removed (`login.module.css`)
- ✅ Dashboard page padding restored (`dashboard/page.tsx`, `dashboard.module.css`)

### Completed in UI Overhaul Sessions
- ✅ `globals.css` — `--color-bg-elevated` added; all stale dark tokens documented as forbidden
- ✅ `matchups.module.css` + `matchup-detail.module.css` — stale token replacement
- ✅ `tournaments.module.css` + `bracket.module.css` — stale token replacement
- ✅ `transfers.module.css` — dark `#0f1117` modal inputs fixed
- ✅ `trades.module.css`, `GlobalBidModal.module.css`, `LeagueNav.module.css` — undefined token fixes
- ✅ `PlayerDetailCard.module.css` — dark gradient removed
- ✅ `CLAUDE.md` — design system section rewritten with locked token table + forbidden patterns
- ✅ `standings/page.tsx` + `standings/standings.module.css` — **initial implementation done (podium + table), needs visual refinement**

### Completed in UI Overhaul Sessions (continued)
- ✅ **Standings** — podium + table implemented and visually polished
- ✅ **Activity Log** — "The Transfer Gazette" timeline, Live Auctions sidebar widget (capped at 4 rows), Transfer Budget widget
- ✅ **Free Agency / Player Market** — tabbed layout (Player Market + Active Auctions), cream editorial player cards, Recent Auctions sidebar, redesigned bid modal with bid history, client-side search + position filters (including LM/RM)

### What Still Needs Work (Priority Order)
1. **League Home** (`league/[leagueId]/page.tsx`) — landing page after selecting a league; likely standings summary + recent matchup + upcoming fixture
2. **Matchups** (`matchups/page.tsx`, `matchups/matchups.module.css`) — Stitch prototype: matchup cards with GW selector
3. **Cups / Tournaments** (`tournaments/page.tsx`, `tournaments.module.css`) — bracket / cup round UI
4. **Trades** (`trades/TradesClient.tsx`, `trades.module.css`) — Stitch prototype: tabbed trade UI
5. **Shared UI subcomponents** — player cards (used across team, matchups, stats), any other reusable components that still carry dark-mode or placeholder styles
6. Final sweep: any remaining hardcoded hex values across all module CSS files

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

**Forbidden patterns — never use these:**
- Stale tokens: `--bg-surface`, `--bg-elevated`, `--border-color`, `--text-primary`, `--text-secondary`, `--primary-accent`
- Dark hex values: `#0d1117`, `#0a0c10`, `#111318`, `#161a22`, `#0f1117`, `#1c2130`

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

## Do Not Touch
- `src/lib/scoring/matchRating.ts` — sigmoid scoring engine
- `supabase/functions/sync-ratings/` — Edge Function
- Any API routes under `src/app/api/`
- `supabase/migrations/` — database schema
- The 12-position system (GK, CB, LB, RB, DM, CM, LM, RM, AM, LW, RW, ST) must be preserved everywhere