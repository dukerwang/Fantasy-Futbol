import { describe, it, expect } from 'vitest';
import { buildRecordBook } from '../records';
import type { Result } from '../results';

const A = 'a', B = 'b', C = 'c';

function league(season: string, gw: number, teamAId: string, a: number, teamBId: string, b: number, provisional = false): Result {
  return {
    season, competition: 'league', competitionLabel: 'League',
    stage: `Gameweek ${gw}`, gameweek: gw,
    teamAId, teamBId, scoreA: a, scoreB: b,
    winnerId: null, legs: [{ a, b }], provisional,
  };
}

const find = (rs: ReturnType<typeof buildRecordBook>, key: string) =>
  rs.find((r) => r.key === key)!;

describe('buildRecordBook', () => {
  const all: Result[] = [
    league('2026-27', 1, A, 150.8, B, 60.2),
    league('2026-27', 2, A, 140.0, C, 70.0),
    league('2026-27', 3, B, 120.0, C, 61.0),
    // C's narrow win. The margin has to clear the 10-point draw band or this
    // is not a win at all — 65.5 to 60.0 would be a draw.
    league('2026-27', 4, C, 65.5, A, 54.0),
  ];

  it('ranks the highest single score with the chasing clubs', () => {
    const r = find(buildRecordBook(all), 'highest-score');
    expect(r.entries[0]).toMatchObject({ teamId: A, value: 150.8 });
    expect(r.entries[0].context).toBe('Gameweek 1, 2026-27');
    expect(r.entries.map((e) => e.teamId)).toEqual([A, B, C]);
  });

  it('lists each club at most once, so one club cannot fill the podium', () => {
    const r = find(buildRecordBook(all), 'highest-score');
    expect(new Set(r.entries.map((e) => e.teamId)).size).toBe(r.entries.length);
    // A's 140.0 is the second-highest score outright but must not take 2nd.
    expect(r.entries[1].teamId).toBe(B);
  });

  it('measures the biggest margin, not the biggest score', () => {
    const r = find(buildRecordBook(all), 'biggest-margin');
    expect(r.entries[0]).toMatchObject({ teamId: A, value: 90.6 });
  });

  it('sorts the lowest winning score upward', () => {
    const r = find(buildRecordBook(all), 'lowest-winning-score');
    expect(r.entries[0]).toMatchObject({ teamId: C, value: 65.5 });
  });

  it('totals a season across every fixture a club played', () => {
    const r = find(buildRecordBook(all), 'highest-season');
    // A: 150.8 + 140.0 + 54.0
    expect(r.entries[0]).toMatchObject({ teamId: A, value: 344.8, context: "2026-27" });
  });

  it('ignores provisional fixtures entirely', () => {
    const withLive = [...all, league('2026-27', 5, B, 999, C, 1, true)];
    const r = find(buildRecordBook(withLive), 'highest-score');
    expect(r.entries[0].value).toBe(150.8);
  });

  it('reads a two-legged tie leg by leg, never as an aggregate', () => {
    const tie: Result = {
      season: '2026-27', competition: 'primary_cup', competitionLabel: 'Champions Cup',
      stage: 'Semi-final', gameweek: null,
      teamAId: A, teamBId: B, scoreA: 160, scoreB: 40,
      winnerId: A, legs: [{ a: 80, b: 20 }, { a: 80, b: 20 }], provisional: false,
    };
    const r = find(buildRecordBook([tie]), 'highest-score');
    // 160 aggregate must not appear as a single-gameweek record.
    expect(r.entries[0].value).toBe(80);
  });

  describe('runs', () => {
    it('counts an unbeaten run through draws and across the whole span', () => {
      const rs: Result[] = [
        league('2026-27', 1, A, 100, B, 60),    // win
        league('2026-27', 2, A, 100, B, 95),    // draw (inside the band)
        league('2026-27', 3, A, 100, B, 60),    // win
        league('2026-27', 4, A, 50, B, 120),    // loss ends it
        league('2026-27', 5, A, 100, B, 60),    // win
      ];
      const r = find(buildRecordBook(rs), 'longest-unbeaten');
      const a = r.entries.find((e) => e.teamId === A)!;
      expect(a.value).toBe(3);
      expect(a.context).toBe('Gameweeks 1 to 3, 2026-27');
    });

    it('counts a winless run through draws too', () => {
      const rs: Result[] = [
        league('2026-27', 1, A, 60, B, 100),
        league('2026-27', 2, A, 95, B, 100),   // draw
        league('2026-27', 3, A, 60, B, 100),
      ];
      const a = find(buildRecordBook(rs), 'longest-winless').entries.find((e) => e.teamId === A)!;
      expect(a.value).toBe(3);
    });

    it('measures runs on league fixtures only', () => {
      const cupWin: Result = {
        season: '2026-27', competition: 'primary_cup', competitionLabel: 'Champions Cup',
        stage: 'Final', gameweek: null, teamAId: A, teamBId: B,
        scoreA: 100, scoreB: 10, winnerId: A, legs: [{ a: 100, b: 10 }], provisional: false,
      };
      const rs = [league('2026-27', 1, A, 100, B, 60), cupWin];
      const a = find(buildRecordBook(rs), 'longest-unbeaten').entries.find((e) => e.teamId === A)!;
      expect(a.value).toBe(1);
    });
  });

  it('omits a record nobody holds rather than showing an empty one', () => {
    // Nobody has won, so there is no lowest winning score and no unbeaten run.
    const draws = [league('2026-27', 1, A, 100, B, 100)];
    const keys = buildRecordBook(draws).map((r) => r.key);
    expect(keys).not.toContain('lowest-winning-score');
    expect(keys).toContain('longest-unbeaten');
  });

  it('returns nothing at all for a league that has played nothing', () => {
    expect(buildRecordBook([])).toEqual([]);
  });
});
