# Team of the Week and club pitch design

## Scope

Replace League Home's five-row Top Performers list with a league-wide Team of
the Week. Add a read-only pitch view to the club page and make the page's
view, action, filter, and sort controls easier to use on desktop and mobile.

The club page will retire the Gallery view. Its remaining views are Pitch,
Depth chart, and Table.

## Team of the Week

League Home uses the most recently completed gameweek, which is also the
existing source of Top Performers. It fetches every player score for that
gameweek and builds the highest-scoring legal XI across Gaffa's supported
formations.

The selection algorithm must use the same exact-position and secondary-position
eligibility rules as the lineup editor. It must evaluate every legal formation,
choose the XI with the highest total fantasy points, and use a deterministic
tie-breaker so the result does not move between renders. When totals match, it
uses the order of `ALL_FORMATIONS`, then lexical player ID order by tactical
slot. The model retains each selected player's assigned slot, allowing a
secondary-position player to render in the exact slot that made the formation
legal.

The Team of the Week surface contains:

- A vertical, read-only pitch with attack at the top and goal at the bottom.
- Eleven compact player chips showing the tactical slot, player name, Premier
  League club, owner or Free agent, and gameweek score.
- The selected formation and the team total in the header.
- A four-slot bench below the pitch: DEF, MID, ATT, and FLEX. Each bench slot
  takes the highest-scoring unused eligible player using `BENCH_FLEX_MAP`.
  DEF accepts CB/LB/RB/LWB/RWB, MID accepts DM/CM/AM, ATT accepts ST/LW/RW,
  and FLEX accepts any tactical position, including GK. FLEX takes the highest
  scorer left after DEF, MID, and ATT have been filled.

The page shows no Team of the Week section until a completed gameweek has
player-score data. A missing bench candidate renders as an explicit empty slot;
the algorithm never relaxes tactical eligibility to fill the display.

## Club pitch

Pitch is the first club view and is a read-only overview, not another lineup
editor. It has two modes:

- Projected XI is the default. It selects the strongest legal matchday XI from
  players eligible for a lineup. Its projection score combines Futbolpedia
  outlook and structured outlook data when available, reference-season
  performance and position rank, cautiously weighted early-season form,
  availability, and expected minutes. Market value only resolves close calls.
- Saved Lineup displays the editor's current lineup target. If that target has
  no complete saved XI, the view falls back to the most recent valid saved
  lineup rather than presenting an empty state when a saved side exists.

Both modes use one shared, read-only formation board that follows the lineup
editor's established row geometry and player-node grammar. A row preserves
left-to-right tactical order, such as LB, CB, CB, RB, and compact fixed-width
nodes prevent narrow wide players or full-backs from collapsing the row.

The club board has no named DEF/MID/ATT/FLEX bench. Each starter instead owns a
small position-depth stack: the first eligible replacement sits beneath the
starter and more compatible reserves appear as a count. It makes the pitch show
who starts in a position and who covers that position. Academy, injured reserve,
and loaned-out players do not populate projected depth.

The pitch header contains the Projected XI and Saved Lineup mode control and
the displayed formation. Selecting a player chip uses the existing selection
path and updates the inspector rail or mobile detail surface.

Saved lineup data is public enough for a club scouting view because opponents
already need to see the same submitted team in their matchup context. The loader
must reuse the same edit-target and historical fallback rules as the editor and
Squad Peek. It must not add client-side polling.

## Club controls

The club page command bar has three durable page views: Pitch, Depth chart,
and Table. It makes the active view clear through the selected state, while the
shown-player count sits with the data controls rather than between unrelated
controls.

To-do remains an action queue for the club owner only. It keeps its count and
urgent state, but appears as a dedicated action control before filtering and
sorting. Filter and sort retain their existing values and local-storage keys.

Desktop presents view controls, the action queue, and data controls in one
balanced row where space permits. On smaller desktop widths, the controls wrap
as logical groups rather than separating labels from their fields.

## Mobile behavior

Mobile is a first-class layout, with safe-area-aware controls and touch targets
at least 44px high where the user performs an action.

- The page-level view selector scrolls horizontally if required and does not
  shrink labels below readable size.
- The pitch uses the available width and a controlled height. Compact player
  nodes retain a surname, tactical position, and projection indicator without
  horizontal page scroll. Depth stacks remain tied to their starters.
- The Projected XI and Saved Lineup control remains inside the pitch header.
- To-do remains visible as a direct action. Filter and sort open bottom sheets
  with clear selected states and large tap targets instead of cramped native
  selects.
- Depth stacks remain attached to their starters, and subsequent club content
  stacks below the pitch. The inspector uses the existing mobile treatment
  rather than a sticky desktop rail.

## Architecture and data flow

`buildHomeModel` replaces `topPerformers` with a Team of the Week model. It
shares one gameweek-scoped player-stats query with player and ownership data,
then passes a fully resolved display model to the League Home section. The
selection algorithm belongs in a pure helper so it can be unit-tested against
formation and bench edge cases without querying Supabase.

`loadClubView` gains the minimal saved-lineup target needed by the club pitch.
The club-pitch projection and slot assignment are pure derivations from the
loaded squad, outlook, and reference data. The club client persists the selected
page view using the existing local-storage convention. It does not persist the
temporary pitch mode.

The shared read-only formation board serves Club Pitch and Team of the Week.
It extracts the established geometric and node conventions from the editable
lineup surface without importing editing, lock, or submission behavior.

## Accessibility and error handling

Each pitch has an accessible text summary of formation, players, and points.
Player chips are buttons when they select a player and use clear visible focus
states. The mode selector and data-control sheets expose selected state to
assistive technology.

An unavailable saved lineup, incomplete historical scoring data, failed owner
lookup, and formation with no legal XI must all resolve to clear empty states.
They must not leave a blank pitch, throw, or silently fabricate a player or
position. The existing server error behavior for non-critical display queries
continues to use safe empty data.

## Verification

Add unit tests for Team of the Week formation selection, exact-slot secondary
eligibility, deterministic tie-breaking, each bench slot, and empty bench
slots. Add unit tests for the matchday projection score, projected club-XI
selection, same-position depth assignment, and saved-lineup fallback.
Verify League Home and club views at desktop and narrow mobile widths in both
themes, including keyboard navigation and touch-friendly controls. Run `npm
test` and `npm run build` before declaring the work complete.
