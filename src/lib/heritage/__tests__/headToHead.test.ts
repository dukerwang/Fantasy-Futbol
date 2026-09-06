import { describe, it, expect } from 'vitest';
import { headToHead, allRivalries, overallRecord, winRate } from '../headToHead';
import { outcomeFor, DRAW_THRESHOLD, type Result } from '../results';

const A = 'team-a';
const B = 'team-b';
const C = 'team-c';

function league(season: string, gw: number, a: number, b: number, opts: Partial<Result> = {}): Result {
  return {
    season,
    competition: 'league',
    competitionLabel: 'League',
    stage: `Gameweek ${gw}`,
    gameweek: gw,
    teamAId: A,
    teamBId: B,
    scoreA: a,
    scoreB: b,
    winnerId: null,
    legs: [{ a, b }],
    provisional: false,
    ...opts,
  };
}

function cup(season: string, stage: string, a: number, b: number, winnerId: string | null, opts: Partial<Result> = {}): Result {
  return {
    season,
    competition: 'primary_cup',
    competitionLabel: 'Champions Cup',
    stage,
    gameweek: null,
    teamAId: A,
    teamBId: B,
    scoreA: a,
    scoreB: b,
    winnerId,
    legs: [{ a, b }],
    provisional: false,
    ...opts,
  };
}

describe('outcomeFor', () => {
  it('treats a league margin inside the draw band as a draw for both sides', () => {
    const r = league('2026-27', 1, 100, 100 + DRAW_THRESHOLD - 0.1);
    expect(outcomeFor(r, A)).toBe('draw');
    expect(outcomeFor(r, B)).toBe('draw');
  });

  it('resolves a league margin exactly on the threshold as a result', () => {
    const r = league('2026-27', 1, 110, 100);
    expect(outcomeFor(r, A)).toBe('win');
    expect(outcomeFor(r, B)).toBe('loss');
  });

  it('never draws a cup tie, even level, and trusts the stored winner', () => {
    // Level on points; the bracket resolved it on seed, so B advanced.
    const r = cup('2026-27', 'Semi-final', 90, 90, B);
    expect(outcomeFor(r, A)).toBe('loss');
    expect(outcomeFor(r, B)).toBe('win');
  });

  it('falls back to the scoreline for a cup tie with no recorded winner', () => {
    const r = cup('2026-27', 'Quarter-final', 101, 99, null);
    expect(outcomeFor(r, A)).toBe('win');
    expect(outcomeFor(r, B)).toBe('loss');
  });
});

describe('headToHead', () => {
  const all: Result[] = [
    league('2027-28', 30, 120, 60),                 // A wins big
    league('2027-28', 12, 95, 99),                  // draw (margin 4)
    cup('2027-28', 'Final', 80, 105, B),            // A loses the final
    league('2026-27', 20, 70, 130),                 // A loses heavily
  ];

  it('splits the record by competition and reconciles with the total', () => {
    const h = headToHead(all, A, B);
    expect(h.played).toBe(4);
    expect([h.won, h.drawn, h.lost]).toEqual([1, 1, 2]);
    expect([h.league.played, h.league.won, h.league.drawn, h.league.lost]).toEqual([3, 1, 1, 1]);
    expect([h.cups.played, h.cups.won, h.cups.lost]).toEqual([1, 0, 1]);
    expect(h.league.played + h.cups.played).toBe(h.played);
  });

  it('is symmetric: the mirror record swaps wins and losses', () => {
    const a = headToHead(all, A, B);
    const b = headToHead(all, B, A);
    expect(b.won).toBe(a.lost);
    expect(b.lost).toBe(a.won);
    expect(b.drawn).toBe(a.drawn);
    expect(b.pointsFor).toBe(a.pointsAgainst);
  });

  it('picks the biggest win and heaviest defeat by margin, not by score', () => {
    const h = headToHead(all, A, B);
    expect(h.biggestWin?.gameweek).toBe(30);       // +60
    expect(h.heaviestDefeat?.gameweek).toBe(20);   // -60 beats the final's -25
  });

  it('counts the current streak from the newest meeting', () => {
    // Newest first: win, draw, ... so the run is a single win.
    const h = headToHead(all, A, B);
    expect(h.streak).toEqual({ outcome: 'win', length: 1 });

    const twoLosses = [
      league('2027-28', 31, 60, 120),
      league('2027-28', 30, 61, 121),
      league('2027-28', 29, 130, 60),
    ];
    expect(headToHead(twoLosses, A, B).streak).toEqual({ outcome: 'loss', length: 2 });
  });

  it('excludes a provisional fixture from the record', () => {
    const withLive = [...all, league('2028-29', 3, 200, 10, { provisional: true })];
    const h = headToHead(withLive, A, B);
    expect(h.played).toBe(4);
    expect(h.biggestWin?.gameweek).toBe(30);
  });

  it('counts a two-legged tie once, on aggregate', () => {
    const tie = cup('2027-28', 'Semi-final', 110, 100, A, {
      legs: [{ a: 40, b: 70 }, { a: 70, b: 30 }],
    });
    const h = headToHead([tie], A, B);
    expect(h.played).toBe(1);
    expect(h.won).toBe(1);
    expect(h.pointsFor).toBe(110);
  });

  it('returns an empty record for clubs that have never met', () => {
    const h = headToHead(all, A, C);
    expect(h.played).toBe(0);
    expect(h.streak).toBeNull();
    expect(h.biggestWin).toBeNull();
  });
});

describe('allRivalries', () => {
  const all: Result[] = [
    league('2027-28', 1, 100, 80),
    league('2027-28', 2, 100, 80, { teamBId: C }),
    league('2027-28', 3, 100, 80, { teamBId: C }),
    league('2027-28', 4, 100, 80, { teamBId: C, provisional: true }),
  ];

  it('orders by meetings played, so the rivalry leads', () => {
    const rs = allRivalries(all, A);
    expect(rs.map((r) => r.opponentId)).toEqual([C, B]);
    expect(rs[0].played).toBe(2);   // the provisional one is not counted
  });

  it('omits opponents whose only meeting is provisional', () => {
    const rs = allRivalries([league('2027-28', 9, 1, 2, { provisional: true })], A);
    expect(rs).toEqual([]);
  });
});

describe('overallRecord', () => {
  it('spans every competition and ignores other clubs’ fixtures', () => {
    const all: Result[] = [
      league('2027-28', 1, 120, 60),
      cup('2027-28', 'Final', 60, 120, B),
      league('2027-28', 2, 90, 80, { teamAId: B, teamBId: C }),
    ];
    const t = overallRecord(all, A);
    expect(t.played).toBe(2);
    expect(t.won).toBe(1);
    expect(t.lost).toBe(1);
    expect(winRate(t)).toBe(0.5);
  });

  it('reports a zero win rate rather than dividing by zero', () => {
    expect(winRate(overallRecord([], A))).toBe(0);
  });
});
