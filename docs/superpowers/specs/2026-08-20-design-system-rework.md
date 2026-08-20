# Gaffa Design System Rework

**Date:** 2026-08-20
**Status:** Approved direction, pending implementation
**Prototype:** https://claude.ai/code/artifact/061c38fa-d8a9-4a41-a5da-1a2328abc3dc

## Goal

Move Gaffa from "solid but bare-bones passion project" to production-grade visual quality. The main problems identified:

1. Not enough color across the app
2. The eyebrow + page title + `.g-panel` (white card on cream background) pattern looks unsophisticated
3. The beige topbar (#EDE8DE) lacks brand identity
4. Pages redesigned through Claude Design prototyping (League Home, Transfer Market, clubs/rosters) look noticeably better than pages that were just restyled — the gap is structural, not decorative

## Evidence: what works vs what doesn't

**Pages the user likes** (League Home, Transfer Market, Stats): content sits directly on the page. Color comes from domain data (position badges, status accents, club crests). Structural variety through multi-column layouts, inline stats, and section headings with content flowing beneath them. Small cards used only for distinct tappable entry points.

**Pages the user dislikes** (Standings, Manager Hub): everything wrapped in `.g-panel` — the white card floating on cream. Formulaic eyebrow -> title -> panel. Monotonous single-column layout.

## Changes by layer

### 1. Chrome (topbar)

- New dedicated token: `--color-topbar: #1A5C3A` (medium Gaffa green)
- This does NOT replace `--color-bg-secondary` (#EDE8DE), which stays for table headers, inputs, and insets. The topbar gets its own variable.
- All topbar text, icons, and borders switch to white / white-alpha
  - Balance chip: white text, `rgba(255,255,255,.3)` border
  - Nav links: `rgba(255,255,255,.7)` default, `#fff` hover/active
  - Active nav state: `rgba(255,255,255,.12)` background
  - Icon buttons: `rgba(255,255,255,.2)` border, `rgba(255,255,255,.7)` color
  - Avatar: `rgba(255,255,255,.15)` background
- The green topbar creates a strong visual ceiling for every page, which is why content below can sit flatter without needing panel containers for structure

**File:** `src/components/layout/TopBar.module.css` — change `background: var(--color-bg-secondary)` to `background: var(--color-topbar)`; override all text/icon colors within the component.

**Token:** Add `--color-topbar: #1A5C3A` to `:root` block in `src/app/globals.css`.

### 2. Surfaces

- `.g-panel` stops being a page-level wrapper. Content sits on `--color-bg-primary` (#F7F3ED) directly.
- `.g-panel` stays in the system for small, distinct, interactive units: the three action cards on Transfer Market, the "You play" card on League Home, the "10th of 10" status block. These are bounded objects, not page containers.
- Shadow stays reserved for things that literally float: modals, popovers, the player detail card, dropdown menus.
- No new surface tokens needed.

### 3. Section structure

- Mastheads close with an ink rule: `border-bottom: 2px solid var(--color-text-primary)`. Already the pattern on League Home and Transfer Market.
- Inline stats on the right side of the masthead (your rank, matchweek, player count, etc.) — already the pattern on liked pages.
- Within content areas, sections separated by hairlines (`1px solid var(--color-border)`), not by wrapping in separate panels.
- Table headers get a cream stripe: `background: var(--color-bg-secondary)` on `thead th`. Gives the header visual weight without a container around the table.

### 4. Color sources

No new decorative color. Color comes from domain data:

- **Club crests**: shown everywhere teams are listed (standings rows, matchup headers, sidebar opponent). Already present; ensure consistent use and sizing.
- **Position badges**: the colored circles on the stats page extend to any context with individual players (roster, matchup lineups, squad management).
- **Form indicators** (dots/bars), **medal colors** (gold/silver/bronze on ranks), **own-row green tint**: all already exist.
- The green topbar adds a permanent band of brand color to every page.

### 5. Typography

- The eyebrow -> title -> subtitle rhythm tightens. Less padding between elements. The ink rule closes the masthead closer to the title.
- No font changes. Newsreader, Hanken Grotesk, Archivo Narrow, JetBrains Mono all stay.
- The eyebrow gives context (league name, season) and is fine — the problem was the eyebrow + title + gap + panel combo.

### 6. Dark theme

Maps 1:1 (user is skeptical here — evaluate after implementation):

- Green topbar stays green (possibly `#1FA35F`, the existing dark accent, which is brighter for dark backgrounds)
- White field (#F7F3ED) -> charcoal (#1A1F2E)
- Cream structure (#EDE8DE) -> lighter charcoal (#232838)
- Hairlines -> dark-theme border tokens (already exist)
- Domain colors (position, club, performance ramp) -> already have dark variants

## Per-page impact

### Pages that need changes

| Page | Current pattern | Change needed |
|------|----------------|---------------|
| **Standings** | Panel-wrapped podium + table | Remove panel, podium/table sit flat, cream table header stripe, medal-colored rank numbers |
| **Matchups** | Likely panel-wrapped | Remove panel wrapper, matchup scores/cards sit flat with hairlines |
| **Manager Hub** | League cards as panels | Cards are interactive entry points so panels may be OK; evaluate page grammar |
| **Fixtures** | Likely panel-wrapped | Same fix: remove panel, flat content with hairlines |
| **Squad/Roster** | Need to check | Same principle |

### Pages already done (no structural changes needed)

| Page | Status |
|------|--------|
| **League Home** | Already flat, uses ink rules and hairlines |
| **Transfer Market/Auctions/Listings/Free Agency/Deals** | All already flat |
| **Stats** | Already flat, has position badges |

### All pages (topbar change affects everything)

The topbar change is global — every page gets the green bar. This also means checking that:
- Any element that currently uses `--color-bg-secondary` expecting it to match the topbar needs to be updated
- The topbar's new white text needs AA contrast verification against `#1A5C3A` (white on #1A5C3A is ~6.2:1, passes)

## Implementation order

1. **Topbar + token** — the global change. Add `--color-topbar`, update TopBar component. Check both themes.
2. **Standings** — the worst offender. Remove panel, apply cream header, medal colors.
3. **Matchups** — similar treatment.
4. **Fixtures** — similar treatment.
5. **Manager Hub** — evaluate whether cards should stay or go flat.
6. **Squad/Roster** — check and fix if needed.
7. **Dark theme audit** — after all structural changes, verify dark theme mapping.

## What is NOT changing

- Fonts (Newsreader, Hanken Grotesk, Archivo Narrow, JetBrains Mono)
- The cream editorial identity (warm color family)
- Position color system (12 tactical positions)
- Performance ramp colors
- The liked pages' structure (League Home, Transfer Market, Stats)
- `.g-panel` as a component (it stays for small interactive cards)
- The overall page layout pattern from liked pages (masthead with inline stats, content flowing below)
