# Context from Yesterday's Session

## 1. Cup Competitions Bracket Schedule

You explicitly defined the matchweek schedule for the Cup Knockout Bracket during the design phase:

- **Round of 16 (R16):** Matchweek 9
- **Quarterfinals (QF):** Matchweek 16
- **Semifinals (SF):** Matchweeks 21 & 24 (Two-legged aggregate)
- **Final:** Matchweek 29

*(For context, this was specified in your prompt to the design agent when asking to fix the Cup Competitions bracket structure to fit 4 columns without cutoff).*

---

## 2. Matchups Detail Page — Cream Editorial Overhaul (Implementation Plan)

*This is the full implementation plan we finalized yesterday for the Matchups UI.*

### Overview
Both matchups pages need the cream editorial treatment. The underlying infrastructure (routing, data fetching, side-by-side pitch via `pitchGrid`, bench by slot in `ReadonlyPitch`) is already solid. This is primarily:
- A full visual overhaul to the cream design system
- Three targeted feature additions (featured hero card, GW at a Glance, score-intensity points colors)
- One fix: score banner in detail page must match prototype 1 exactly

### Stitch Prototype Rule — MANDATORY FIRST STEP
Before writing any CSS or JSX, fetch the HTML for both screens:
```
Project: 9034509438526576481

Matchups List screen ID: 0ad6d2d2c8304c6aa01b2b91173063f4
Matchup Detail screen ID: f29ee9a0509b4119b61d54d83d922903
```
For each screen:
1. `get_screen` with the project ID + screen ID
2. Get the `htmlCode.downloadUrl`
3. `curl` the download URL to fetch raw HTML
4. Read the actual CSS class names, layout structure, spacing values, and color hex codes from that HTML
5. Only then write the implementation CSS/JSX

### Design Decisions (source of truth)
**Score Banner (detail page) — match Prototype 1 exactly**
- `FC Meridian vs Real Classico` — large Noto Serif bold title (~1.75rem), left-aligned
- Score row: `47.3` (Noto Serif bold, ~3rem, dark charcoal) `–` `41.8` (same size but muted/grey for loser)
- `FC MERIDIAN WIN` badge: solid #3A6B4A fill, white Inter all-caps, sharp 0px radius, positioned right of scores inline
- `GAME WEEK 24` — small Inter all-caps muted, upper-right

**Points Badge (on pitch chips)** — score-intensity color, NOT position color.
Add to `src/lib/utils/scoreColor.ts` (NEW FILE):
```typescript
export function getScoreIntensityColor(points: number): { bg: string; text: string } {
  if (points >= 18) return { bg: '#2d6a4f', text: '#fff' }; // elite
  if (points >= 12) return { bg: '#3A6B4A', text: '#fff' }; // great
  if (points >= 7)  return { bg: '#8B7355', text: '#fff' }; // solid
  if (points >= 3)  return { bg: '#B5651D', text: '#fff' }; // poor
  if (points >= 0)  return { bg: '#9B2335', text: '#fff' }; // bad
  return                { bg: '#6B1E1E', text: '#fff' }; // negative
}
```

**Matchups List — layout**
- **GW Selector**: `[←] | GW 29 | [→]` — arrow buttons + styled select pill, symmetric vertical separators
- **Hero card (featured matchup)**: separate from the grid — full-width card at top. 3-column flex
- **Grid cards**: 2-column grid below hero
- **GW at a Glance strip**: below grid — 3 editorial stat modules

**Bench (detail page)**
- **Add**: bench total points line. Show `Bench Total: X.X pts` at the end of each team's bench section
- **Style**: Display bench as two full-width horizontal strips with #EDE8DE background below the main pitch

**Dual-Team Pitch Layout (detail page)**
- Pitch card split into two horizontal halves (white halfway line and center circle).
- **Top Half (Home/Team A)**: Faces down. Formation flows from GK at the top to ATT near the halfway line.
- **Bottom Half (Away/Team B)**: Faces up (mirrored). Formation flows from GK at the bottom to ATT near the halfway line.
- **Player Chips**: White rectangles, 0px radius. [Position Badge] [Surname] [Points]. No overlapping, no player photos.

**PLAYER POINTS BREAKDOWN (Ledger/Stats section)**
- **Style**: Ledger-style alternating rows (#F7F3ED / #FDFCF9).
- **Compact by default**: Rows show `[Badge] [Surname] [Points (bold, right-aligned)]`.
- **Toggle**: Add a "Show Details ↓" link (#3A6B4A) to expand detailed stats (e.g., "1G · 1A · 8.5 rating").

---

## 3. Matchups Detail Page — Task Tracker

- `[ ]` 1. `src/lib/utils/scoreColor.ts` — NEW score-intensity color helper
- `[ ]` 2. `src/app/.../matchups/GameweekSelector.tsx` — arrow + styled pill
- `[ ]` 3. `src/app/.../matchups/matchups.module.css` — full cream editorial redesign
- `[ ]` 4. `src/app/.../matchups/LiveMatchupCard.tsx` — hero + grid variants, draw rule fix
- `[ ]` 5. `src/app/.../matchups/page.tsx` — season records, GW stats, featured matchup split
- `[ ]` 6. `src/app/.../matchups/[matchupId]/matchup-detail.module.css` — cream redesign
- `[ ]` 7. `src/app/.../matchups/[matchupId]/page.tsx` — new score banner, bench totals
- `[ ]` 8. `src/components/ReadonlyPitch.tsx` — scoreColor, cream token fixes
- `[ ]` 9. `src/components/pitch.module.css` — bench section cream tokens, pitch radius fix
- `[ ]` 10. `npm run build` — verify 0 errors

---

## 4. Cups Page — Cream Editorial Design Decisions

*This is the exact layout and component structure agreed upon for the Tournaments/Cups page overhaul.*

**Page Structure & Header**
- **Main Area**: `#F7F3ED` parchment background.
- **Top Header**: "CUPS" (small Inter all-caps muted), "Cup Competitions" (Noto Serif bold headline).
- **Tab Pills**: Three sharp-cornered (0px radius) tabs: `[League Cup]` (Active, green `#3A6B4A` background / white text), `[Champions Cup]`, `[Europa Cup]`.
- **Info Bar**: "LEAGUE CUP · 10 TEAMS · FINAL: MATCHWEEK 29" (muted). Right side features a green badge "SEMIFINALS — MW 21+24".

**The Knockout Bracket (Horizontal Layout)**
- **Format**: Wide horizontal grid with 4 columns. Match boxes are `#FDFCF9` with sharp corners.
- **Connectors**: Use thin 1px `#C8C3BC` lines connecting the matches. 
- **Active Path Highlighting**: FC Meridian's winning path (QF1 -> SF1 -> Final) must use `#3A6B4A` green connector lines, and their match boxes should feature a 2px left green border indicator.

**Bracket Columns / Matchweek Data:**
1. **R16 · MW 9**: 2 matches (The Gaffers 2-0 Basement FC; Nord United 1-0 Seville Stars). No byes visible.
2. **QUARTERFINALS · MW 16**: 4 matches (FC Meridian 52.1 vs 39.4 The Gaffers; Real Classico 55.2 vs 38.1 Nord United; Bayern Blaze 48.7 vs 42.3 Atletico Kings; El Clasico FC 44.7 vs 39.8 Porto Royals).
3. **SEMIFINALS · MW 21 + MW 24**: 2 matches (SF1: FC Meridian vs Real Classico, aggregate 47.3-41.8 Leg 1; SF2: Bayern Blaze vs El Clasico FC, Leg 1 pending).
4. **FINAL · MW 29**: 1 Match box centered ("TBD vs TBD").

**Cup Overview Section (Bottom Area)**
- Discard the old "Competitor Deep Dive" and replace it with three data-forward `#FDFCF9` sharp horizontal cards under the bracket:
  1. **CUP SCHEDULE**: A clear table showing R16 (MW 9), QF (MW 16), SF (MW 21+24), Final (MW 29).
  2. **TOP SCORERS**: A leaderboard listing top players (e.g., V. Boniface 34.6, H. Kane 28.9, M. Salah 27.4).
  3. **PREVIOUS WINNER**: Shows past champion (e.g., "Atletico Kings, Season 4") with their total points text.

**Visual Specs for Cups Page**
- **Stitch Screen ID for Cups**: `bed26193ff66477eac7c85deb3da26c1`
- **Strict adherence**: 0px radius entirely. Noto Serif for team names/values, Inter for labels. No icons.

