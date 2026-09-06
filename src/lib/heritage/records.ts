/**
 * src/lib/heritage/records.ts
 *
 * The record book: all-time superlatives with the clubs chasing them.
 *
 * Every record carries a top three rather than a single holder, because a
 * record book is only interesting when you can see who is close. Pure, like
 * headToHead — it reduces the Result[] that `loadAllResults` produced.
 *
 * Records about silverware (most titles, most finals) are not here: those come
 * from the honours archive, not from results. See honoursBoard.ts.
 */

import { outcomeFor, type Result } from './results';

export interface RecordEntry {
  teamId: string;
  /** The figure, already rounded for display. */
  value: number;
  /** Where it happened — a season, a gameweek, an opponent. */
  context: string;
}

export interface RecordBookEntry {
  key: string;
  /** The record's name, title case (docs/UI_RULES.md rule 1). */
  label: string;
  group: 'Scoring' | 'Runs';
  /** Highest first, or lowest first for the records where low is the feat. */
  entries: RecordEntry[];
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** One side of one fixture, which is the unit most scoring records measure. */
interface Side {
  teamId: string;
  opponentId: string;
  score: number;
  against: number;
  season: string;
  stage: string;
  competition: string;
  outcome: 'win' | 'draw' | 'loss';
}

function sides(all: Result[]): Side[] {
  const out: Side[] = [];
  for (const r of all) {
    if (r.provisional) continue;
    // A two-legged tie's aggregate is not a single performance, so scoring
    // records read the legs. A single-leg tie and a league fixture have
    // exactly one leg, so this is the same row for them.
    for (const leg of r.legs) {
      out.push({
        teamId: r.teamAId, opponentId: r.teamBId,
        score: leg.a, against: leg.b,
        season: r.season, stage: r.stage, competition: r.competitionLabel,
        outcome: outcomeFor(r, r.teamAId),
      });
      out.push({
        teamId: r.teamBId, opponentId: r.teamAId,
        score: leg.b, against: leg.a,
        season: r.season, stage: r.stage, competition: r.competitionLabel,
        outcome: outcomeFor(r, r.teamBId),
      });
    }
  }
  return out;
}

/**
 * Top `n` by `value`, at most one entry per club — a record book lists the
 * chasing clubs, not one club's three best nights.
 */
function top(
  items: { teamId: string; value: number; context: string }[],
  n: number,
  lowestFirst = false,
): RecordEntry[] {
  const sorted = [...items].sort((a, b) => (lowestFirst ? a.value - b.value : b.value - a.value));
  const seen = new Set<string>();
  const out: RecordEntry[] = [];
  for (const i of sorted) {
    if (seen.has(i.teamId)) continue;
    seen.add(i.teamId);
    out.push({ teamId: i.teamId, value: round1(i.value), context: i.context });
    if (out.length === n) break;
  }
  return out;
}

/**
 * The longest run of gameweeks matching `pred`, per club, over that club's
 * fixtures in chronological order. Cup ties have no gameweek, so runs are
 * measured on league fixtures only — a run is a run of matchweeks.
 */
function longestRun(
  all: Result[],
  pred: (o: 'win' | 'draw' | 'loss') => boolean,
): { teamId: string; value: number; context: string }[] {
  const byTeam = new Map<string, Result[]>();
  for (const r of all) {
    if (r.provisional || r.competition !== 'league') continue;
    for (const id of [r.teamAId, r.teamBId]) {
      if (!byTeam.has(id)) byTeam.set(id, []);
      byTeam.get(id)!.push(r);
    }
  }

  const out: { teamId: string; value: number; context: string }[] = [];
  for (const [teamId, rs] of byTeam) {
    const chron = [...rs].sort((a, b) =>
      a.season.localeCompare(b.season) || (a.gameweek ?? 0) - (b.gameweek ?? 0));

    let best = 0;
    let bestCtx = '';
    let run = 0;
    let startedAt: Result | null = null;

    for (const r of chron) {
      if (pred(outcomeFor(r, teamId))) {
        run += 1;
        if (run === 1) startedAt = r;
        if (run > best) {
          best = run;
          bestCtx = startedAt && startedAt.season === r.season
            ? `Gameweeks ${startedAt.gameweek} to ${r.gameweek}, ${r.season}`
            : `${startedAt?.season} to ${r.season}`;
        }
      } else {
        run = 0;
        startedAt = null;
      }
    }
    if (best > 0) out.push({ teamId, value: best, context: bestCtx });
  }
  return out;
}

/** Every record the book carries, in reading order. */
export function buildRecordBook(all: Result[]): RecordBookEntry[] {
  const s = sides(all);

  const seasonTotals = new Map<string, number>();
  for (const side of s) {
    const k = `${side.teamId}::${side.season}`;
    seasonTotals.set(k, (seasonTotals.get(k) ?? 0) + side.score);
  }

  const book: RecordBookEntry[] = [
    {
      key: 'highest-score',
      label: 'Highest Gameweek Score',
      group: 'Scoring',
      entries: top(s.map((x) => ({
        teamId: x.teamId, value: x.score, context: `${x.stage}, ${x.season}`,
      })), 3),
    },
    {
      key: 'biggest-margin',
      label: 'Biggest Winning Margin',
      group: 'Scoring',
      entries: top(s.filter((x) => x.score > x.against).map((x) => ({
        teamId: x.teamId,
        value: x.score - x.against,
        context: `${round1(x.score)}–${round1(x.against)} · ${x.stage}, ${x.season}`,
      })), 3),
    },
    {
      key: 'highest-season',
      label: 'Highest Season Total',
      group: 'Scoring',
      entries: top([...seasonTotals].map(([k, v]) => ({
        teamId: k.split('::')[0], value: v, context: k.split('::')[1],
      })), 3),
    },
    {
      key: 'lowest-winning-score',
      label: 'Lowest Winning Score',
      group: 'Scoring',
      entries: top(s.filter((x) => x.outcome === 'win').map((x) => ({
        teamId: x.teamId, value: x.score, context: `${x.stage}, ${x.season}`,
      })), 3, true),
    },
    {
      key: 'longest-unbeaten',
      label: 'Longest Unbeaten Run',
      group: 'Runs',
      entries: top(longestRun(all, (o) => o !== 'loss'), 3),
    },
    {
      key: 'longest-winless',
      label: 'Longest Run Without a Win',
      group: 'Runs',
      entries: top(longestRun(all, (o) => o !== 'win'), 3),
    },
  ];

  // A record nobody holds yet is not shown at all — an empty row reads as a
  // bug, and in a league’s first weeks most of these have no holder.
  return book.filter((r) => r.entries.length > 0);
}
