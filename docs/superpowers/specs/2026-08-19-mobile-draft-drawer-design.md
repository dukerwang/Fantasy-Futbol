# Mobile draft room: board-primary layout with a drawer

## Problem

The draft room's current mobile treatment (`@media (max-width: 900px)` in
`draft.module.css`) doesn't match the desktop experience at all — it hides
the round-by-round board entirely (`.boardPanel { display: none; }`) and
hands the full screen to the sidebar's four tabs. On desktop, the board (who
picked whom, when) is the primary view with the tabbed panel alongside it;
on mobile there's no board at all, just a full-screen tab switcher. That's
not a cramped version of the desktop layout, it's a different app.

Separately, the Players tab's stats table is a fixed 580px-wide table
(`.tableStatsLayout`, Rank/GP/Pts/PPG/Avg/Val) that needs horizontal scroll
on any phone regardless of how much vertical space it's given — putting it
in a drawer instead of a full-screen panel doesn't fix that on its own.

Both problems were confirmed and scoped through the visual companion
(`.superpowers/brainstorm/.../drawer-states.html`,
`.../table-format.html`) — approved directions: board+banner as the primary
mobile view with a drag-to-open bottom drawer for the four tabs, and a card
list replacing the Players stats table on mobile rather than a
horizontally-scrolled version of the same table.

## Non-goals

- No change to the desktop layout (board + static side-by-side panel)
  whatsoever — this is additive, gated entirely behind the existing 900px
  breakpoint.
- No auto-expand of the drawer when it becomes the viewer's turn — confirmed
  explicitly not wanted. The always-visible banner/timer is the only nudge.
- No redesign of the Roster, Queue, or Chat tabs' mobile presentation beyond
  fitting inside the drawer — only the Players stats table was identified as
  needing a mobile-specific format. Don't invent card layouts for tabs
  nobody flagged as a problem.
- No middle "half-open" snap point — two states only (collapsed/expanded),
  per direction confirmed in the visual companion.
- Not extending the drawer to the pre-draft lobby (`PreDraftLobby.tsx`) —
  its own mobile treatment (`preDraftLobby.module.css`) already stacks
  correctly and is out of scope.

## Design

### Where this applies

`MockDraftRoom.tsx` (practice mode) uses the exact same
`boardPanel`/`sidebarPanel`/tab structure and CSS classes as the real
`DraftRoom.tsx` — same `draftStyles` import, same four-tabs-with-inline-JSX
pattern (Players/Roster/Queue/Chat in the real room, Players/Roster/Queue/
Recap in mock). The drawer is built once as a shared piece both rooms use,
not duplicated — consistent with `loadDraftPool.ts`'s existing "keep mock
and real in sync" philosophy.

### Component extraction

Both rooms currently inline all four tabs' JSX directly, gated by
`{sidebarTab === 'x' && (...)}`. To let the same tab content render inside
either the desktop `<aside>` or the new mobile drawer without duplicating
~1000 lines of JSX per room, each tab's content becomes its own component:

- **Players** — the filtering/sorting state (search, position filter,
  minutes filter, `sortKey`/`sortDir`, the `sortedAndFiltered` memo) moves
  into a shared hook, e.g. `usePlayersTabState()`, since desktop and mobile
  need the *same* filtered/sorted list but render it differently. Two
  presentational components consume that hook's output:
  `PlayersTable` (existing table markup, desktop and — per the "keep it
  familiar" option not chosen — not needed on mobile) and a new
  `PlayersCardList` (mobile only, see below).
- **Roster**, **Queue** — extracted as `RosterTabContent` /
  `QueueTabContent`, reused as-is on both desktop and mobile. No redesign;
  their current row layout isn't too wide for a drawer the way the stats
  table is.
- **Chat** — already a separate component (`SidebarChat`); no extraction
  needed, just rendered inside whichever container (aside or drawer) is
  active. The existing `display: sidebarTab === 'chat' ? 'block' : 'none'`
  pattern (keeping it mounted across tab switches, not remounting the
  chat feed/scroll position) carries over unchanged.

### Desktop vs. mobile: one mounted layout, not two

Rather than mounting both the desktop `<aside>` and the mobile drawer
simultaneously and toggling visibility with CSS (the existing pattern for
`.boardPanel`), this needs an actual conditional mount: a `matchMedia
('(max-width: 900px)')` check (matching the existing breakpoint) picks one
layout tree to render, not both. Reasoning: the Players list is virtualized
(`react-window`'s `List`) — double-mounting it (one copy hidden via
`display: none`) risks a hidden virtualizer failing to recalculate its
window correctly if the viewport crosses the breakpoint without a full page
reload (e.g. rotating a tablet, resizing a browser window), and wastes work
mounting a list nobody can see. A brief flash of the desktop layout before
the client-side check resolves on mount is an accepted tradeoff — this is
already a `'use client'`-only room with no SEO/no-JS concern.

### The drawer

New shared component, e.g. `MobileDraftDrawer.tsx`, rendered only inside the
mobile branch above. Two snap points:

- **Collapsed** (default): a slim tab strip pinned to the bottom of
  `.draftRoot` (`position: absolute; bottom: 0`), height matching the
  existing `.sidebarTabs` row. The board (scrollable) and the topBanner fill
  the rest of the screen — this is the mobile equivalent of the desktop's
  board-primary view.
- **Expanded**: the drawer covers most of the screen (leaving the banner and
  a small sliver of the board visible above it, per the approved mockup),
  showing the active tab's content with the tab strip as its header.

Interaction:
- Tapping a tab while collapsed expands the drawer to that tab in one
  motion; tapping a tab while already expanded just switches content.
- The handle drags the sheet between the two snap points — built with
  Framer Motion (`drag="y"`, `dragConstraints`, `onDragEnd` snapping to
  whichever state is closer / matches drag velocity), the same library
  already used elsewhere in this file (`pickVariants`,
  `AnimatePresence`), not a new dependency.
- No backdrop/tap-outside-to-dismiss — the sliver of visible board above the
  drawer isn't a modal scrim, it's just the primary view peeking through.
  Closing is drag-down only.

### Players tab on mobile: card list, not the table

Confirmed direction — replace the table with a card-per-player list:

- Each card: position badge + name + club (or the red `fpl_news` injury
  line, same as desktop's sticky column today) on the left; Rank number,
  PPG, and market value on the right — the three numbers a manager is most
  likely to actually use mid-draft.
- GP and Avg rating (the two columns dropped from the compact view) show on
  tap — the card expands in place to reveal them, rather than a separate
  toggle control. Consistent with `isNewToPrem` today: shows the same "NEW"
  treatment in place of the stat numbers, and the same queue star (★) /
  Draft button actions carry over from the current row, just laid out for
  a card instead of a table row.
- Existing filter controls (search, position filter, minutes filter,
  new-to-Prem checkbox) stay above the list, reflowed for the narrower
  width — no change to what they do, only how they're arranged.
- Sort still defaults to Draft Rank (matching the desktop default set in
  the Draft Rank spec), tappable to change — exact control (dropdown vs.
  segmented control) left to the implementation plan, see below.

### Visual language

Wireframes used generic placeholder styling to validate structure only —
the actual build uses Gaffa's existing tokens throughout: `draft.module.css`
color/spacing custom properties, `PositionBadge` for position chips (not a
new badge implementation), `--color-danger` for the injury line (matching
the Draft Rank spec's desktop treatment), existing font tokens
(`--font-sans`, `--font-condensed`). No new visual system, no colors or
components invented for this feature.

## Open implementation questions

- Exact collapsed/expanded drawer heights (the mockup's proportions are
  indicative, not pixel-final) — settle against real device sizes during
  implementation, not hardcoded here.
- Mobile Players-tab sort control: dropdown vs. segmented control vs.
  something else — a UI-polish choice, not load-bearing enough to block
  design approval.
- Whether `usePlayersTabState()` also absorbs the desktop table's existing
  inline filter/sort state as part of this change, or whether that's left
  alone and only the mobile card list reads from the new hook — worth a
  quick look at `DraftRoom.tsx`'s current state layout before deciding, not
  a design-level fork.
