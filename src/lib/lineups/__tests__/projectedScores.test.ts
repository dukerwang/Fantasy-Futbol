import { describe, expect, it } from 'vitest';
import type { SquadEntry } from '@/lib/teams/loadClubView';
import { projectedScores } from '@/app/(dashboard)/league/[leagueId]/team/roster/clubDerive';

function squadEntry(
  id: string,
  overrides: Partial<SquadEntry['player']> = {},
  projection: Partial<SquadEntry['projection']> = {},
): SquadEntry {
  return {
    id: `entry-${id}`,
    playerId: id,
    status: 'active',
    acquisitionType: 'draft',
    acquisitionValue: null,
    acquiredAt: '2026-07-01T00:00:00.000Z',
    isPendingDrop: false,
    listing: null,
    form: [0, 0],
    projection: { quality: 'solid', minutesRole: 'rotation_risk', riskFlags: [], recentAppearances: 2, ...projection },
    player: {
      id,
      name: id,
      full_name: id,
      web_name: id,
      primary_position: 'ST',
      secondary_positions: [],
      pl_team: 'Arsenal',
      fpl_status: 'a',
      projected_points: 100,
      total_points: 0,
      ppg: 0,
      market_value: 50,
      overall_rank: 100,
      position_ranks: [{ position: 'ST', rank: 100 }],
      ...overrides,
    } as SquadEntry['player'],
  };
}

describe('projectedScores', () => {
  it('does not let two early gameweeks outweigh a stronger matchday projection', () => {
    const projected = squadEntry(
      'projected',
      { market_value: 80, overall_rank: 10 },
      { minutesRole: 'nailed', quality: 'elite', recentAppearances: 2 },
    );
    const earlyPointsLeader = squadEntry(
      'early-points',
      { market_value: 12, overall_rank: 250, total_points: 30, ppg: 15 },
      { minutesRole: 'fringe', quality: 'squad', recentAppearances: 2 },
    );

    const scores = projectedScores([projected, earlyPointsLeader]);

    expect(scores[projected.id]).toBeGreaterThan(scores[earlyPointsLeader.id]);
  });

  it('substantially discounts an unavailable player', () => {
    const available = squadEntry('available', { fpl_status: 'a' });
    const unavailable = squadEntry('unavailable', { fpl_status: 'u' });

    const scores = projectedScores([available, unavailable]);

    expect(scores[available.id]).toBeGreaterThan(scores[unavailable.id]);
  });
});
