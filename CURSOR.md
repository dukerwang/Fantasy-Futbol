# Fantasy Futbol — Cursor Context

## Read First
Before anything else, read `CLAUDE.md` and `GEMINI.md` in the project root.
- `CLAUDE.md` — execution rules, stack, database schema, coding standards
- `GEMINI.md` — architectural philosophy, game mechanics, planning principles

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

### What Still Needs Work
Individual **page-level** CSS files were built for the old dark theme. They use the CSS variables correctly (so colors adapt), but some pages may look mismatched or need typographic/layout polish to match the new aesthetic. Priority order:

1. **My Team page** (`team/my-team.module.css`, `PitchUI.tsx`) — pitch looks too dark green, player chips need the position badge treatment
2. **Players / Free Agency** (`players/TransferMarketClient.tsx`) — cards need light-mode refinement  
3. **Matchups** (`matchups/page.tsx`) — score display styling
4. **Activity log** (`activity/page.tsx`) — transaction feed styling
5. **Standings** (`standings/page.tsx`) — table styling
6. Any remaining hardcoded dark hex values in module CSS files (search for `#0d1117`, `#0a0c10`, `#111318`, `#161a22`)

---

## Design System

### Color Tokens (current values in `globals.css`)
```css
--color-bg-primary: #F0EBE1;       /* Main content area — warm cream */
--color-bg-secondary: #EDE7DC;     /* Sidebar, nav bar */
--color-bg-card: #F7F3EE;          /* Card surfaces */
--color-bg-card-hover: #E6DFD4;    /* Hover state */
--color-border: #C8C2B6;           /* Standard borders */
--color-border-subtle: #DDD6CA;    /* Subtle separators */
--color-accent-blue: #3A6B4A;      /* PRIMARY CTA — forest green (not blue) */
--color-accent-green: #3A6B4A;     /* Same green */
--color-text-primary: #1C1C1C;     /* Near-black charcoal */
--color-text-secondary: #4A4A4A;   /* Secondary text */
--color-text-muted: #9A9488;       /* Timestamps, labels */
--font-serif: 'Noto Serif', Georgia, serif;
```

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