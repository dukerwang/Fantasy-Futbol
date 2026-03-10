import { NextResponse } from 'next/server';
import { calculateMatchRating } from '@/lib/scoring/engine';
import { GranularPosition, RawStats } from '@/types';

function makeStats(overrides: Partial<RawStats>): RawStats {
  return {
    minutes_played: 90,
    goals: 0,
    assists: 0,
    shots_total: 0,
    shots_on_target: 0,
    passes_total: 40,
    passes_accurate: 35,
    pass_completion_pct: 87.5,
    key_passes: 0,
    big_chances_created: 0,
    dribbles_attempted: 0,
    dribbles_successful: 0,
    tackles_total: 0,
    tackles_won: 0,
    interceptions: 0,
    clearances: 0,
    blocks: 0,
    saves: 0,
    goals_conceded: 0,
    penalty_saves: 0,
    yellow_cards: 0,
    red_cards: 0,
    own_goals: 0,
    penalties_missed: 0,
    clean_sheet: false,
    bps: 10,
    influence: 10,
    creativity: 10,
    threat: 10,
    ict_index: 3.0,
    expected_goals: 0,
    expected_assists: 0,
    expected_goals_conceded: 0,
    fpl_tackles: 0,
    fpl_cbi: 0,
    fpl_recoveries: 0,
    ...overrides
  };
}

export async function GET() {
    const results = [];

    // 1. Hat Trick Striker
    const stStats = makeStats({ goals: 3, bps: 75, influence: 80, creativity: 15, threat: 110, expected_goals: 1.5 });
    results.push({ name: 'Hat-Trick Striker (Haaland)', res: calculateMatchRating(stStats, 'ST') });

    // 2. Average CB
    const cbStats = makeStats({ clean_sheet: true, goals_conceded: 0, expected_goals_conceded: 0.5, bps: 22, influence: 20, fpl_tackles: 2, fpl_cbi: 5, fpl_recoveries: 4 });
    results.push({ name: 'Average CB Clean Sheet', res: calculateMatchRating(cbStats, 'CB') });

    // 3. AM with 2 Assists
    const amStats = makeStats({ assists: 2, bps: 45, influence: 55, creativity: 85, threat: 25, expected_assists: 0.8, key_passes: 5 });
    results.push({ name: 'Playmaker AM 2 Assists (KDB)', res: calculateMatchRating(amStats, 'AM') });

    // 4. Bad GK
    const gkStats = makeStats({ goals_conceded: 4, expected_goals_conceded: 1.2, saves: 1, bps: 5, influence: 5 });
    results.push({ name: 'Terrible GK (Conceded 4)', res: calculateMatchRating(gkStats, 'GK') });

    // 5. Short Sub
    const subStats = makeStats({ minutes_played: 20, bps: 3, influence: 2, creativity: 2, threat: 0 });
    results.push({ name: 'Short Sub 20 mins', res: calculateMatchRating(subStats, 'ST') });

    return NextResponse.json(results);
}
