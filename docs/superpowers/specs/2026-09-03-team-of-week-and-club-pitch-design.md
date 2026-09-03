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

- Projected XI is the default. It selects the strongest legal XI from players
  eligible for a lineup, using the existing overall squad score. It considers
  every supported formation and displays the highest-scoring legal result.
- Saved lineup displays the club's upcoming saved lineup and its DEF, MID, ATT,
  and FLEX bench. When no future saved lineup exists, its tab states that there
  is no saved lineup and leaves Projected XI available.

The pitch header contains the Projected XI and Saved lineup mode control. It
also displays the projected or saved formation. Selecting a player chip uses
the existing selection path and updates the inspector rail or mobile detail
surface.

Position-grouped reserve strips follow the pitch. They show eligible lineup
players who are not in the displayed XI, preserving the existing depth-chart
role of making cover visible. Players who cannot be fielded, such as Academy
and injured-reserve players, remain in the other club views and do not populate
the projected XI.

Saved lineup data is public enough for a club scouting view because opponents
already need to see the same submitted team in their matchup context. The loader
must request only the next relevant matchup and must not add client-side polling.

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
- The pitch uses the available width and a controlled height. Player chips
  retain a name, tactical position, and points without horizontal page scroll.
- The Projected XI and Saved lineup control remains inside the pitch header.
- To-do remains visible as a direct action. Filter and sort open bottom sheets
  with clear selected states and large tap targets instead of cramped native
  selects.
- Bench and reserve strips stack below the pitch. The inspector uses the
  existing mobile treatment rather than a sticky desktop rail.

## Architecture and data flow

`buildHomeModel` replaces `topPerformers` with a Team of the Week model. It
shares one gameweek-scoped player-stats query with player and ownership data,
then passes a fully resolved display model to the League Home section. The
selection algorithm belongs in a pure helper so it can be unit-tested against
formation and bench edge cases without querying Supabase.

`loadClubView` gains the minimal upcoming-lineup data needed by the club pitch.
The club-pitch projection and slot assignment are pure client derivations from
the already loaded squad entries. The club client persists the selected page
view using the existing local-storage convention. It does not persist the
temporary pitch mode unless a later product decision requires that behavior.

The pitch rendering primitives should be shared where practical, but the club
view stays read-only and must not import editing, lock, or submission behavior
from the team lineup editor.

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
slots. Add unit tests for projected club-XI selection and saved-lineup fallback.
Verify League Home and club views at desktop and narrow mobile widths in both
themes, including keyboard navigation and touch-friendly controls. Run `npm
test` and `npm run build` before declaring the work complete.
