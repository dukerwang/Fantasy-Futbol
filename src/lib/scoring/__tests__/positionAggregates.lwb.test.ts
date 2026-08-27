import { describe, it, expect } from 'vitest';
import { DEFAULT_REFERENCE_STATS } from '../matchRating';
import {
  MEANINGFUL_MINUTES,
  buildPositionAggregates,
  rankPositionAggregates,
} from '../positionAggregates';
import type { RawStats } from '@/types';

const baseStats: RawStats = {
  minutes_played: 90,
  goals: 0,
  assists: 1,
  shots_on_target: 0,
  key_passes: 1,
  tackles_total: 2,
  tackles_won: 1,
  saves: 0,
  goals_conceded: 1,
  penalty_saves: 0,
  yellow_cards: 0,
  red_cards: 0,
  own_goals: 0,
  penalties_missed: 0,
  clean_sheet: false,
  bps: 20,
  influence: 30,
  creativity: 20,
  threat: 10,
  expected_goals: 0.05,
  expected_assists: 0.2,
  fpl_def_contrib: 8,
};

describe('positionAggregates wingbacks', () => {
  it('keeps LWB/RWB keys instead of collapsing to LW/RW', () => {
    const players = new Map([
      ['p1', { id: 'p1', primary_position: 'LB', secondary_positions: ['LWB', 'RB'] }],
      ['p2', { id: 'p2', primary_position: 'LWB', secondary_positions: ['LB'] }],
      ['p3', { id: 'p3', primary_position: 'RB', secondary_positions: ['RWB'] }],
    ]);
    const rows = [
      { player_id: 'p1', match_rating: 7, fantasy_points: 12, stats: baseStats },
      { player_id: 'p2', match_rating: 7, fantasy_points: 12, stats: baseStats },
      { player_id: 'p3', match_rating: 7, fantasy_points: 12, stats: baseStats },
    ];

    const agg = buildPositionAggregates(rows, players, DEFAULT_REFERENCE_STATS, MEANINGFUL_MINUTES);
    expect(Object.keys(agg.p1).sort()).toEqual(['LB', 'LWB', 'RB']);
    expect(Object.keys(agg.p2).sort()).toEqual(['LB', 'LWB']);
    expect(Object.keys(agg.p3).sort()).toEqual(['RB', 'RWB']);

    const ranks = rankPositionAggregates(agg);
    expect(ranks.get('p1')!.map((r) => r.position).sort()).toEqual(['LB', 'LWB', 'RB']);
    expect(ranks.get('p2')!.map((r) => r.position).sort()).toEqual(['LB', 'LWB']);
    expect(ranks.get('p3')!.map((r) => r.position).sort()).toEqual(['RB', 'RWB']);
  });
});
