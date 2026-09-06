# Heritage — design

Status: BUILT (2026-09-04). Live at `/league/[leagueId]/heritage`.
Canvas: https://claude.ai/code/artifact/19675f80-72d3-4163-bc3f-f28cb87e1c2d

Heritage replaces `/history` with a hub covering the league's record and each
club's record against every other. Named by Duke, 2026-09-04.

## What it is

Five surfaces behind one tab bar (League Home's `.heroTab` device), sitting on
the page masthead rule:

**Overview** — the landing. The reigning champion as a bounded hero, its trophies
standing on the studio sweep. Beneath it the **honours board**: every club as a
row ordered by silverware, its trophies drawn as pips, the viewer's row tinted
`--color-green-50` with a bolder name. Then a head-to-head table of the viewer's
record against each rival, and a rail carrying the viewer's own club and the
live season.

**Head-to-Head** — one pairing. A fixture header (two crests, the record
between), points for and against, the league/cup split, biggest win and heaviest
defeat each way, both cabinets side by side, and every meeting ever played.

**Seasons** — season by season: podium, cup winners, and that season's
**Title-Winning XI** (most-used player in each slot of the champion's most-used
formation) plus the rest of the squad with appearances and points.

**Record Book** — all-time superlatives grouped Scoring / Runs / Silverware.
Each record shows the holder's crest, the context, and the 2nd and 3rd best, so
a record reads as something someone is chasing.

**Trophy Cabinets** — replaces `/clubs/[teamId]/honours`.

## Decisions taken

- **Manager-first, but two subjects with equal billing.** The league's record
  (Seasons, Record Book) and the club's record (Head-to-Head, Cabinets) are
  different subjects; the tab bar holds both rather than burying one.
- **Live from gameweek one.** Everything unions completed `matchups` with
  `season_matchups_archive`. The alphas are in their first season, so a hub
  reading archives alone would ship blank.
- **Cups count**, and cup ties get archived (below).
- **Title-Winning XI is derived** from archived per-gameweek lineups, plus the
  full squad list. It therefore only renders for a completed season.
- **Trophies split by surface.** Pips (silhouette only) on list surfaces; full
  metal objects only on the studio sweep from `honours.module.css`. A dark green
  back panel was tried there before and rejected as reading like a chalkboard.

## What shipped

1. **Cup ties now survive the reset.** Migration `156_cup_matchups_archive.sql`
   adds `season_cup_matchups_archive` (applied), and `archiveCupMatchups()` in
   `seasonReset.ts` runs at step 2.5, before `resetTournaments()` cascades the
   ties away. Rows are denormalised because the archive outlives its source.
2. `src/lib/heritage/results.ts` — the four-way union (live league, archived
   league, live bracket, archived bracket). The live-bracket query uses
   `!inner` on both join hops because `tournament_matchups` carries no
   `league_id`; verified against the real database before building on it.
3. `headToHead.ts`, `records.ts`, `honoursBoard.ts`, `seasonXI.ts` — pure
   reductions plus two loaders. 37 tests in `src/lib/heritage/__tests__/`.
4. Five routes: Overview, Head-to-Head (index and pairing), Seasons,
   Record Book, Trophy Cabinets — all on League Home's grammar.
5. `clubs/[teamId]/honours/` and `history/` are deleted. The TopBar entry,
   the club masthead trophy strip and the season-reset notification all point
   at Heritage.

## Decisions taken while building

- **A two-legged tie is one meeting on aggregate** for head-to-head, but is
  read leg by leg for scoring records — an aggregate is not a single
  performance.
- **Provisional fixtures are excluded from every record.** A head-to-head that
  moved under the reader mid-gameweek would be worse than one that lags.
- **Runs are measured on league fixtures only.** A run is a run of matchweeks,
  and cup ties have no gameweek.
- **A record lists each club at most once**, so one club cannot fill its own
  podium, and a record nobody holds is omitted rather than shown empty.
- **The Title-Winning XI gives a repeated slot to different players** (two CBs
  are two people), and counts a utility player once under his most-used slot
  but with all of his starts.

## Open

- The champion hero's sweep is the largest single surface commitment on the
  landing and is the first thing to argue with now that it is real.
- The Title-Winning XI can only render for a season with archived lineups, so
  it is blank for the season in progress. That is inherent, not a gap.
- Nothing has exercised the cup paths against real data yet: the alphas' 17
  ties per league are all still `pending`.
