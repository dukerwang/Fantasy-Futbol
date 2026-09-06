/**
 * src/lib/heritage/headToHead.ts
 *
 * One club's record against another, and against everyone.
 *
 * Everything here is pure: it takes the Result[] that `loadAllResults` produced
 * and reduces it. No database, so it is directly testable and a page pays for
 * one fetch rather than one per rival.
 *
 * A two-legged cup tie counts as ONE meeting, decided on aggregate — that is
 * what `loadAllResults` hands over, and it is how football counts a tie.
 */

import { outcomeFor, type Competition, type Result } from './results';

export interface Tally {
  played: number;
  won: number;
  drawn: number;
  lost: number;
  pointsFor: number;
  pointsAgainst: number;
}

export interface HeadToHead extends Tally {
  teamId: string;
  opponentId: string;
  /** The same tally split by where it was played. */
  league: Tally;
  cups: Tally;
  /** Best and worst by margin, from `teamId`'s side. Null before any meeting. */
  biggestWin: Result | null;
  heaviestDefeat: Result | null;
  /** Newest first. */
  meetings: Result[];
  /** Current run, e.g. { outcome: 'win', length: 2 }. Null before any meeting. */
  streak: { outcome: 'win' | 'draw' | 'loss'; length: number } | null;
}

const empty = (): Tally => ({
  played: 0, won: 0, drawn: 0, lost: 0, pointsFor: 0, pointsAgainst: 0,
});

function add(t: Tally, r: Result, teamId: string) {
  const isA = r.teamAId === teamId;
  const mine = isA ? r.scoreA : r.scoreB;
  const theirs = isA ? r.scoreB : r.scoreA;
  t.played += 1;
  t.pointsFor += mine;
  t.pointsAgainst += theirs;
  const o = outcomeFor(r, teamId);
  if (o === 'win') t.won += 1;
  else if (o === 'draw') t.drawn += 1;
  else t.lost += 1;
}

const margin = (r: Result, teamId: string) =>
  (r.teamAId === teamId ? r.scoreA - r.scoreB : r.scoreB - r.scoreA);

/**
 * `teamId`'s record against `opponentId`.
 *
 * Provisional results are excluded: a fixture still being scored is not yet
 * part of the record, and letting one in would make a head-to-head change
 * under the reader mid-gameweek.
 */
export function headToHead(
  all: Result[],
  teamId: string,
  opponentId: string,
): HeadToHead {
  const meetings = all.filter((r) =>
    !r.provisional &&
    ((r.teamAId === teamId && r.teamBId === opponentId) ||
     (r.teamBId === teamId && r.teamAId === opponentId)));

  const total = empty();
  const league = empty();
  const cups = empty();
  let biggestWin: Result | null = null;
  let heaviestDefeat: Result | null = null;

  for (const r of meetings) {
    add(total, r, teamId);
    add(r.competition === 'league' ? league : cups, r, teamId);

    const m = margin(r, teamId);
    if (m > 0 && (!biggestWin || m > margin(biggestWin, teamId))) biggestWin = r;
    if (m < 0 && (!heaviestDefeat || m < margin(heaviestDefeat, teamId))) heaviestDefeat = r;
  }

  // `meetings` is newest first, so the streak runs forward from index 0.
  let streak: HeadToHead['streak'] = null;
  if (meetings.length) {
    const first = outcomeFor(meetings[0], teamId);
    let n = 0;
    for (const r of meetings) {
      if (outcomeFor(r, teamId) !== first) break;
      n += 1;
    }
    streak = { outcome: first, length: n };
  }

  return { teamId, opponentId, ...total, league, cups, biggestWin, heaviestDefeat, meetings, streak };
}

/**
 * `teamId` against every other club that has ever faced it, most-played first.
 * The order is deliberate: the club you have played most is the rivalry, and
 * ordering by win rate would put the club you have beaten up on top instead.
 */
export function allRivalries(all: Result[], teamId: string): HeadToHead[] {
  const opponents = new Set<string>();
  for (const r of all) {
    if (r.teamAId === teamId) opponents.add(r.teamBId);
    else if (r.teamBId === teamId) opponents.add(r.teamAId);
  }
  return [...opponents]
    .map((o) => headToHead(all, teamId, o))
    .filter((h) => h.played > 0)
    .sort((a, b) => b.played - a.played || b.won - a.won);
}

/** A club's all-time record across everything. */
export function overallRecord(all: Result[], teamId: string): Tally {
  const t = empty();
  for (const r of all) {
    if (r.provisional) continue;
    if (r.teamAId !== teamId && r.teamBId !== teamId) continue;
    add(t, r, teamId);
  }
  return t;
}

export const winRate = (t: Tally) => (t.played ? t.won / t.played : 0);

/** Results for one competition, for the season room and the cabinets. */
export const inCompetition = (all: Result[], c: Competition) =>
  all.filter((r) => r.competition === c);
