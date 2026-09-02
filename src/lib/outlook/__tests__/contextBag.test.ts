import { describe, expect, it } from 'vitest';
import { buildOutlookContextBag } from '../contextBag';
import type { Player } from '@/types';

function player(overrides: Partial<Player>): Player {
  return {
    id: 'p1',
    fpl_id: 1,
    api_football_id: null,
    web_name: 'Tarkowski',
    name: 'James Tarkowski',
    full_name: 'James Tarkowski',
    date_of_birth: '1992-11-19',
    nationality: 'England',
    pl_team: 'Everton',
    pl_team_id: 1,
    primary_position: 'CB',
    secondary_positions: [],
    market_value: 12,
    market_value_updated_at: null,
    adp: null,
    projected_points: null,
    photo_url: null,
    height_cm: 185,
    fpl_status: 'a',
    fpl_news: null,
    total_points: 120,
    form: null,
    form_rating: 7.1,
    ppg: 6.5,
    is_active: true,
    transfermarkt_id: null,
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

describe('buildOutlookContextBag', () => {
  it('maps availability from fpl_status', () => {
    expect(buildOutlookContextBag(player({ fpl_status: 'a' }), { currentSeason: '2026-27' }).availability).toBe('available');
    expect(buildOutlookContextBag(player({ fpl_status: 'i' }), { currentSeason: '2026-27' }).availability).toBe('injured');
    expect(buildOutlookContextBag(player({ fpl_status: 'd' }), { currentSeason: '2026-27' }).availability).toBe('doubtful');
    expect(buildOutlookContextBag(player({ fpl_status: 's' }), { currentSeason: '2026-27' }).availability).toBe('suspended');
    expect(buildOutlookContextBag(player({ fpl_status: 'u' }), { currentSeason: '2026-27' }).availability).toBe('unavailable');
  });

  it('computes age and academy eligibility', () => {
    const bag = buildOutlookContextBag(
      player({ date_of_birth: '2005-06-01' }),
      { simulationDate: '2026-08-26', currentSeason: '2026-27' },
    );
    expect(bag.age).toBe(21);
    expect(bag.academy_eligible).toBe(true);
  });

  it('handles null date of birth', () => {
    const bag = buildOutlookContextBag(player({ date_of_birth: null }), { currentSeason: '2026-27' });
    expect(bag.age).toBeNull();
    expect(bag.academy_eligible).toBe(false);
  });

  it('includes secondary positions and new-to-prem flag', () => {
    const bag = buildOutlookContextBag(
      player({ secondary_positions: ['DM'], isNewToPrem: true }),
      { currentSeason: '2026-27' },
    );
    expect(bag.secondary_positions).toEqual(['DM']);
    expect(bag.is_new_to_prem).toBe(true);
    expect(bag.pl_tenure).toBe('new_to_prem');
  });

  it('does not include fantasy scoring fields', () => {
    const bag = buildOutlookContextBag(player({}), { currentSeason: '2026-27' });
    expect(bag).not.toHaveProperty('total_points');
    expect(bag).not.toHaveProperty('form');
    expect(bag).not.toHaveProperty('form_rating');
    expect(bag).not.toHaveProperty('ppg');
  });
});
