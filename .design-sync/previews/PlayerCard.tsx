import { PlayerCard } from 'gaffa';
import type { Player } from '../../src/types';

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
    created_at: '',
    updated_at: '',
    ...overrides,
  };
}

export function Default() {
  return <div style={{ padding: 16, width: 640 }}><PlayerCard player={makePlayer()} /></div>;
}

export function Compact() {
  return (
    <div style={{ padding: 16, width: 640 }}>
      <PlayerCard player={makePlayer()} isCompact />
    </div>
  );
}

export function DoubtfulWithBidAction() {
  return (
    <div style={{ padding: 16, width: 640 }}>
      <PlayerCard
        player={makePlayer({
          name: 'Erling Haaland',
          full_name: 'Erling Haaland',
          pl_team: 'Man City',
          primary_position: 'ST',
          secondary_positions: [],
          fpl_status: 'd',
          market_value: 150,
          total_points: 189.2,
          ppg: 8.9,
        })}
        status="active"
        action={{ type: 'bid' }}
      />
    </div>
  );
}

export function BenchWithDropAction() {
  return (
    <div style={{ padding: 16, width: 640 }}>
      <PlayerCard
        player={makePlayer({
          name: 'Kai Havertz',
          full_name: 'Kai Havertz',
          pl_team: 'Arsenal',
          primary_position: 'AM',
          secondary_positions: ['ST'],
          market_value: 65,
          total_points: 88.5,
          ppg: 4.2,
        })}
        status="bench"
        action={{ type: 'drop' }}
      />
    </div>
  );
}
