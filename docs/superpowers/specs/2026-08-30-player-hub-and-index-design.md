# Player hub and players index

**Date:** 2026-08-30
**Status:** DESIGN APPROVED — 2026-08-30 (Duke). Implementation not started.
**Prototype:** `scratch/hub-design/*.dc.html` (source of truth for the port) —
published canvas at https://claude.ai/code/artifact/0b688287-bd8b-40f8-abe9-346812d9c486
**Depends on:** `2026-08-30-outlook-facets-and-grounding-design.md` (the facet
sidecar). The index filters and the card tags are that spec's output; nothing
here ships before it does.

---

## 1. Problem

`src/app/(dashboard)/league/[leagueId]/stats/` is a ranking surface: one flat
sortable table, ten numeric columns, position/club/minutes filters. It answers
"who scored the most". It cannot answer any of the questions a manager actually
opens it with — who is worth acquiring, who is about to lose his place, who is
mispriced, what kind of footballer is this.

The player drill-down is `PlayerDetailsModal` → `PremiumPlayerCard`, reached
from fifteen surfaces. There is no player page, so nothing about a player is
linkable, and there is nowhere for the Futbolpedia outlook to live.

---

## 2. The spine: two layers, never blended

Every surface in this spec is organised by one distinction.

**Football layer** — who this footballer is. Real-world sources only: the
outlook prose, the facets, minutes and starts, xG/xA, set-piece order, injury
and transfer state. True whether or not you play Gaffa, and portable back to
Futbolpedia unchanged.

**League layer** — what he is worth in your league. Gaffa's scoring engine:
points, PPG, match rating, `output_profile`, ownership, market value, matchup
and auction state.

The layers are separated by typographic register rather than decoration,
reusing distinctions `globals.css` already encodes: the football layer is
`--font-serif` and flowing prose; the league layer is `--font-condensed` labels
over `--font-mono` figures on a recessed card. Each panel carries a one-line
rubric naming which layer it is.

This is not presentational. `2026-08-26-futbolpedia-outlook-design.md` §2.1 bans
using league points or match ratings as evidence of football quality, and the
failure mode is a real one — a centre-back who scores well under Gaffa's
positional baselines being described as an elite footballer. Keeping the layers
structurally apart makes that error visible instead of subtle.

**Charts may cross the layers** (the Explorer plots xGI/90 against PPG) because
the axes are labelled. The rule is never "don't compare"; it is "don't let
league scoring pass silently as a football judgment".

---

## 3. Information architecture

Player-centric. One index, one player page, filters rather than separate club
or position sections.

```
/league/[leagueId]/players              index — three views, one toggle
/league/[leagueId]/players/[playerId]   the hub
```

The index replaces today's `stats/` route. Keep `stats/` as a redirect —
it is linked from elsewhere in the app and from shared links.

### 3.1 The modal stays

`PlayerCardProvider` is mounted in the dashboard layout and `openPlayerCard()`
is called from fifteen surfaces (draft room, auction board, pitch, matchups,
trades, every transfers view). Removing it would touch all fifteen and make the
product worse — mid-draft you want a peek, not a navigation.

So: **the modal is the quick look, the hub is the deep view.** The modal gains a
"Full profile →" link to the hub. Both read from the same components so the
layer split holds in both, and `PremiumPlayerCard` (1,065 lines) is where that
work lands.

---

## 4. Index — three views

One toggle, top right: **Cards · Table · Explorer**. Cards is the default.
Search, position, club and minutes filters persist across all three.

### 4.1 Facet filter bar (all views)

Below the existing tools row, on `--color-bg-card-alt`, three groups of toggle
pills drawn from the facet sidecar:

| Group | Values |
|---|---|
| Involvement | Primary outlet · Secondary threat · Limited · Peripheral |
| Minutes role | Nailed · Likely starter · Rotation risk · Fringe |
| Watch for | Exit risk · Injury doubt · Transfer talk |

"Watch for" is new capability, not a restatement of the numbers: it is the only
way in the app to ask "show me who is about to leave".

These three are a **curated subset** of the sidecar, not all of it. The facet
spec defines more (`career_phase`, `set_pieces`, `dynasty_value`, `style`);
faceting on all of them would rebuild the noise the closed vocabulary was meant
to remove. `career_phase` is the strongest candidate for a fourth group and is
worth adding once real data shows how the pool distributes. The prototype's
table artboard still shows Career phase in the third slot — the built version
standardises on the three groups above across all views.

Single-select per group, click again to clear. Active pill is
`--color-tint-accent` ground with **primary ink** — a tinted ground takes
primary ink only, never the tint's own hue.

### 4.2 Cards — the default

The reason this is the default: a table row can only say what a player scored.
Four of the ten players in the prototype are worthless on points alone, and only
the prose says why — Martinelli fully fit but omitted amid advanced Al-Hilal
talks, Tosin out of Chelsea's plans, Estêvão nineteen behind a crowded front
line. That is the collaboration's whole value, and the default view should lead
with it.

Card anatomy, top to bottom:

1. 3px rule in the player's position colour (the spectrum vocabulary, per-card)
2. Portrait with club crest · position chip · age · name (serif) · club
3. **The scouting sentence** — one clause from the outlook, serif, 2–3 lines
4. Situation flag, only when one applies — exit risk (`--color-tint-danger`) or
   injury doubt (`--color-tint-warning`), dot plus label
5. Two facet tags
6. League strip on a recessed ground: Points · Rating · Value · owner

Four across on desktop, responsive down. Cards link to the hub.

**The card is the hub in miniature** and carries the same layer split, so the
two surfaces stay legible as one system.

### 4.3 Table

Today's table, unchanged in its ten columns and sort behaviour, plus one Scout
column showing two facet tags. This is the alternate for anyone who wants to
rank by a number, and nothing that works today stops working.

### 4.4 Explorer

A scatter of the whole pool, both axes pickable from eight metrics:

| Layer | Metrics |
|---|---|
| League | PPG · Total points · Average rating |
| Market | Market value (€m) |
| Football | xGI per 90 · Minutes played · Goals + assists · Age |

- Default pair is **market value (X) against PPG (Y)** — it reads as
  value-for-money without instruction, and the top-left quadrant is the bargain
  bin. Floor-versus-ceiling was rejected as a default: too abstract to land on.
- Value plots on a **log scale**; the pool spans €0.20m to €220m and Haaland
  flattens everyone else on a linear axis. Scale is a per-metric property.
- Median crosshairs on both axes, with the median value labelled, and quadrant
  labels generated from the axis names so they stay correct for any pair.
- Dot size is minutes played; colour is position group; the legend filters.
- Click a point to inspect that player across every metric.

**Period caveat:** market value is current while output is season-to-date, so
any pair mixing them is out of period. For the default pair that mismatch is the
question being asked, but the built version must label the period on both axes.

---

## 5. The hub

Full-width identity band, then a two-column body.

**Identity** — portrait with crest, position chips (primary plus secondary),
name in serif at 42px, club, age, nationality, and an availability pill read
**live** from `fpl_status` / `chance_of_playing_next_round`. Availability is
never taken from the outlook: it changes daily and an outlook lives thirty days.

**Left column — football layer**

- *Scouting report*: facet chips, the outlook paragraph, and a source line
  carrying confidence and evidence gaps. Header shows "Futbolpedia · <date>".
  The date pin is required, not decorative — see §7.
- *Real-world form*: minutes and starts, goals against xG, assists against xA,
  xGI/90 with a **position-relative percentile bar**, and set-piece order from
  FPL (`penalties_order`, `direct_freekicks_order`,
  `corners_and_indirect_freekicks_order`).

**Right column — league layer**

A ledger on a recessed card: season points, PPG, average rating,
`output_profile`, then ownership (manager, how acquired, how many rostered in
the league), then the week (fixture, lineup slot). Closes with a line stating
that league figures never feed the scouting report.

---

## 6. Data dependencies

Nothing here can be built before the facet work lands. Specifically:

| Surface needs | Comes from |
|---|---|
| Facet filter pills, card tags, hub chips | facet sidecar (`2026-08-30-outlook-facets…`) |
| "Watch for" filter | `pl_mobility`, `risk_flags` |
| Set-piece row | new FPL fields in `syncPlayers.ts` |
| xGI/90 percentile bar | `player_stats`, computed position-relative |
| `output_profile` | Gaffa points, computed league-side, **not** in the sidecar |
| Card scouting sentence | `player_outlooks.outlook`, first or second sentence |

The regulars pool is 432 players and 74 currently hold an outlook, so **a card
grid over the full pool has holes until the regen completes.** A card with no
outlook must degrade to identity plus league strip, not render an empty well.

---

## 7. Constraints that are easy to violate

- **Snapshot pinning.** Alpha leagues are live and a published score never
  changes retroactively. Any AI prose beside live numbers carries its generation
  date. One current outlook says Curtis Jones moved to Inter Milan while
  `players.pl_team` still reads Liverpool — that is the failure mode, and the
  contradiction gate in the facet spec is the guard.
- **Cross-season windows must join `player_season_clubs`.** A rolling window
  early in a season spans two seasons and possibly two clubs; `players.pl_team`
  is today's club and would misattribute the older half.
- **Provisional gameweeks.** The most recent point in any chart may be
  pre-lockdown; it needs marking, or a chart silently re-renders after
  publication.
- **Both themes.** Cards, Explorer and all three mobile screens are prototyped
  light-only. The card
  situation flags — the red exit band especially — are unverified on navy and
  must be checked before merge.
- **Tinted grounds take primary ink.** Three highlight states got this wrong in
  the first prototype pass.
- **No fantasy points in the football layer.** Not in card copy, not in the
  scouting report, not in a facet.

---

## 8. Mobile

**Decided 2026-08-30 (Duke):** *"i need everything to also be compatible and
operational on mobile also, almost like it was designed with mobile too. think
apple-design."*

Mobile is not a reflow of the desktop layout. Three surfaces need different
structure, not narrower columns. Prototyped as `*Mobile.dc.html` at 390×844.

**Chrome is a translucent material, not a strip.** `backdrop-filter` blur with
content scrolling under it, and a scroll-edge gradient where content meets the
chrome — never a 1px divider. Falls back to a solid surface under
`prefers-reduced-transparency`.

**The filter bar is rebuilt, not shrunk.** Three stacked pill rows consume ~150px
of an 844px screen. On mobile they collapse to one horizontally-scrolling rail: a
Filters button carrying an active count, then the applied filters as dismissible
chips. The full facet set opens in a sheet.

**Table is the weakest view on a phone** — `min-width: 760px` means horizontal
scroll no matter what. That is acceptable precisely because it is the alternate;
it also independently justifies cards as the default.

**Explorer has no hover to fall back on.** Tap selects; a bottom sheet carries
the detail and the link to the hub. Dot touch targets are 34px around a 7–13px
painted circle — the paint is decoration, the target is the button. A dense
scatter is otherwise unhittable with a thumb.

**The hub stacks in reading order**: identity → scouting report → real-world form
→ league ledger. This settles open question 1 by force — on a phone the league
rail must become a section, so the desktop version should match rather than
diverge.

**Non-negotiables**

- 44px minimum on every interactive target.
- No drawn status bar, keyboard, or home indicator. That space belongs to the OS;
  painting it reads as doubled up.
- Type tracking is size-specific: large titles at `-0.035em` and ~1.02 leading,
  body near `0` at 1.5–1.62. Never one tracking value across the ramp.
- Spacing in `rem`/`em` so a larger system text size scales the layout with it.
- `prefers-reduced-motion` replaces springs and slides with short cross-fades.

**Motion is specified but not prototyped.** The artboards are static, so the part
that decides whether this feels right is implementation work: 1:1 sheet dragging
that tracks the finger, velocity handoff into a spring on release, momentum
projection for the snap target, rubber-banding at rail boundaries, and
interruptible animations that start from the live on-screen value. Default spring
is critically damped (bounce 0, ~0.3–0.4s); bounce only where a flick preceded
the motion.

## 9. Out of scope

- Scouting Trends (rolling form charts, fixture difficulty) — its own spec,
  after this ships.
- Rating explainers — the bridge panel on the hub. Slot reserved, no content.
- Mobile-specific layouts beyond responsive reflow.
- Removing `PlayerDetailsModal` (§3.1).

---

## 10. Phasing

The three views are separable and should not land as one change.

1. **Route, hub, and the modal link.** The player page plus "Full profile →".
   Delivers the outlook somewhere real, and is the piece everything else
   references.
2. **Index: cards and table.** The new default plus the facet bar, with the
   existing table preserved behind the toggle.
3. **Explorer.** Genuinely independent — pure computation over `player_stats`,
   no dependency on the outlook pipeline at all. It could ship before either of
   the others if the regen slips.

## 11. Open questions

1. **Does the league rail earn a full column on the hub**, or should it compress
   to a strip under the identity band and give the football layer full width?
2. **Keep, shorten or drop the panel rubrics** ("what kind of footballer he
   is"). They are the clearest guard against layer confusion and may read as
   over-explaining once the page is familiar.
3. **Fixture and lineup rows in the league rail** — added on assumption; pull
   them if the hub should stay about the player rather than the week.
4. **Card density.** Four across at desktop; unverified whether three reads
   better once real portraits replace placeholders.

---

## 12. Success criteria

- A manager can answer "who should I bid on" without sorting a column.
- Every surface makes it unambiguous whether a claim is football or league.
- Nothing that works on today's stats page stops working.
- Both themes pass WCAG AA.
- A player with no outlook still renders correctly everywhere.
