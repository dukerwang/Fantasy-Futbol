import { PremiumPlayerCard } from 'gaffa';
import type { Player, RatingBreakdownItem } from '../../src/types';

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    id: 'p-1',
    fpl_id: 1,
    api_football_id: null,
    web_name: 'Saka',
    name: 'Bukayo Saka',
    full_name: 'Bukayo Saka',
    date_of_birth: '2001-09-05',
    nationality: 'England',
    pl_team: 'Arsenal',
    pl_team_id: null,
    primary_position: 'RW',
    secondary_positions: ['AM'],
    market_value: 120,
    market_value_updated_at: null,
    adp: null,
    projected_points: null,
    photo_url: null,
    height_cm: 178,
    fpl_status: 'a',
    fpl_news: null,
    total_points: 142.4,
    form: 8.1,
    form_rating: 8.1,
    ppg: 6.8,
    is_active: true,
    transfermarkt_id: null,
    overall_rank: 12,
    position_ranks: [
      { position: 'RW', rank: 3 },
      { position: 'AM', rank: 9 },
    ],
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

const BREAKDOWN: RatingBreakdownItem[] = [
  { key: 'threat', component: 'Threat', weight: 0.3, score: 0.82, weighted: 0.246, detail: '4 shots, 2 on target' },
  { key: 'creativity', component: 'Creativity', weight: 0.25, score: 0.71, weighted: 0.178, detail: '2 key passes, 1 assist' },
  { key: 'goal_involvement', component: 'Goal Involvement', weight: 0.2, score: 0.9, weighted: 0.18, detail: '1 goal, 1 assist' },
  { key: 'influence', component: 'Influence', weight: 0.15, score: 0.6, weighted: 0.09, detail: '78 touches' },
];

export function Default() {
  return (
    <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
      <PremiumPlayerCard
        player={makePlayer()}
        recentForm={8.1}
        matchRating={8.4}
        ratingBreakdown={BREAKDOWN}
      />
    </div>
  );
}

export function Striker() {
  return (
    <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
      <PremiumPlayerCard
        player={makePlayer({
          name: 'Erling Haaland',
          full_name: 'Erling Haaland',
          pl_team: 'Man City',
          primary_position: 'ST',
          secondary_positions: [],
          nationality: 'Norway',
          market_value: 150,
          total_points: 189.2,
          ppg: 8.9,
          overall_rank: 1,
          position_ranks: [{ position: 'ST', rank: 1 }],
        })}
        recentForm={9.2}
        matchRating={9.1}
        ratingBreakdown={BREAKDOWN}
      />
    </div>
  );
}
