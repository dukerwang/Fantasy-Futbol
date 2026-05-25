import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const OLD_REFERENCE_STATS: any = {
    GK:  { match_impact: { median: 12.00, stddev: 10.44 }, influence: { median: 21.20, stddev: 12.83 }, creativity: { median: 0.00, stddev: 2.18 }, threat: { median: 0.00, stddev: 2.38 }, defensive: { median: 0.50, stddev: 9.02 }, goal_involvement: { median: 0.00, stddev: 0.35 }, finishing: { median: 0.00, stddev: 0.04 }, save_score: { median: 4.00, stddev: 3.94 } },
    CB:  { match_impact: { median: 10.00, stddev: 10.12 }, influence: { median: 20.20, stddev: 12.28 }, creativity: { median: 1.40, stddev: 6.72 }, threat: { median: 2.00, stddev: 10.33 }, defensive: { median: 5.60, stddev: 9.37 }, goal_involvement: { median: 0.00, stddev: 1.55 }, finishing: { median: -0.010, stddev: 0.22 }, save_score: { median: 0.00, stddev: 1.00 } },
    LB:  { match_impact: { median: 11.00, stddev: 10.43 }, influence: { median: 16.00, stddev: 10.60 }, creativity: { median: 7.90, stddev: 12.48 }, threat: { median: 4.00, stddev: 9.55 }, defensive: { median: 8.60, stddev: 9.64 }, goal_involvement: { median: 0.00, stddev: 1.62 }, finishing: { median: -0.028, stddev: 0.20 }, save_score: { median: 0.00, stddev: 1.00 } },
    RB:  { match_impact: { median: 11.00, stddev: 10.14 }, influence: { median: 15.30, stddev: 12.11 }, creativity: { median: 6.80, stddev: 12.08 }, threat: { median: 2.00, stddev: 7.87 }, defensive: { median: 9.95, stddev: 10.07 }, goal_involvement: { median: 0.00, stddev: 1.72 }, finishing: { median: -0.018, stddev: 0.22 }, save_score: { median: 0.00, stddev: 1.00 } },
    LWB: { match_impact: { median: 9.00, stddev: 10.29 }, influence: { median: 14.60, stddev: 11.00 }, creativity: { median: 11.15, stddev: 13.75 }, threat: { median: 4.00, stddev: 9.54 }, defensive: { median: 8.85, stddev: 9.87 }, goal_involvement: { median: 0.00, stddev: 1.67 }, finishing: { median: -0.025, stddev: 0.21 }, save_score: { median: 0.00, stddev: 1.00 } },
    RWB: { match_impact: { median: 10.00, stddev: 10.02 }, influence: { median: 14.00, stddev: 11.72 }, creativity: { median: 11.20, stddev: 13.66 }, threat: { median: 2.00, stddev: 8.86 }, defensive: { median: 8.75, stddev: 9.94 }, goal_involvement: { median: 0.00, stddev: 1.92 }, finishing: { median: -0.020, stddev: 0.25 }, save_score: { median: 0.00, stddev: 1.00 } },
    DM:  { match_impact: { median: 14.00, stddev: 6.84 }, influence: { median: 13.40, stddev: 13.15 }, creativity: { median: 10.35, stddev: 13.71 }, threat: { median: 2.00, stddev: 9.82 }, defensive: { median: 10.90, stddev: 10.08 }, goal_involvement: { median: 0.00, stddev: 2.08 }, finishing: { median: -0.025, stddev: 0.28 }, save_score: { median: 0.00, stddev: 1.00 } },
    CM:  { match_impact: { median: 13.00, stddev: 6.83 }, influence: { median: 11.80, stddev: 14.36 }, creativity: { median: 14.80, stddev: 16.49 }, threat: { median: 6.00, stddev: 11.54 }, defensive: { median: 7.85, stddev: 7.37 }, goal_involvement: { median: 0.00, stddev: 2.45 }, finishing: { median: -0.045, stddev: 0.32 }, save_score: { median: 0.00, stddev: 1.00 } },
    AM:  { match_impact: { median: 12.00, stddev: 7.63 }, influence: { median: 11.20, stddev: 19.34 }, creativity: { median: 17.10, stddev: 18.95 }, threat: { median: 12.00, stddev: 15.09 }, defensive: { median: 6.10, stddev: 5.94 }, goal_involvement: { median: 0.00, stddev: 3.41 }, finishing: { median: -0.065, stddev: 0.45 }, save_score: { median: 0.00, stddev: 1.00 } },
    LW:  { match_impact: { median: 9.00, stddev: 7.49 }, influence: { median: 8.80, stddev: 16.47 }, creativity: { median: 14.40, stddev: 15.37 }, threat: { median: 12.00, stddev: 16.02 }, defensive: { median: 5.68, stddev: 5.60 }, goal_involvement: { median: 0.00, stddev: 2.85 }, finishing: { median: -0.070, stddev: 0.38 }, save_score: { median: 0.00, stddev: 1.00 } },
    RW:  { match_impact: { median: 10.00, stddev: 6.95 }, influence: { median: 10.60, stddev: 16.30 }, creativity: { median: 15.80, stddev: 16.17 }, threat: { median: 17.00, stddev: 15.91 }, defensive: { median: 5.73, stddev: 5.54 }, goal_involvement: { median: 0.00, stddev: 3.01 }, finishing: { median: -0.060, stddev: 0.40 }, save_score: { median: 0.00, stddev: 1.00 } },
    ST:  { match_impact: { median: 7.00, stddev: 9.26 }, influence: { median: 7.20, stddev: 20.66 }, creativity: { median: 6.10, stddev: 9.43 }, threat: { median: 19.00, stddev: 21.80 }, defensive: { median: 3.95, stddev: 5.35 }, goal_involvement: { median: 0.00, stddev: 3.76 }, finishing: { median: -0.040, stddev: 0.47 }, save_score: { median: 0.00, stddev: 1.00 } },
};

(async () => {
  const { calculateMatchRating, DEFAULT_REFERENCE_STATS } = await import('../src/lib/scoring/matchRating');
  const { loadReferenceStats } = await import('../src/lib/scoring/matchups');

  const { data: players } = await sb.from('players')
    .select('id, name, primary_position, secondary_positions')
    .ilike('name', '%Szoboszlai%');

  const p = players![0];
  const refStatsDB = await loadReferenceStats(sb as any, '2025-26');

  const { data: statsRows } = await sb.from('player_stats')
    .select('gameweek, stats')
    .eq('player_id', p.id);

  let playedCount = 0;
  let sumOldRef = 0;
  let sumDbRef = 0;

  for (const r of statsRows || []) {
    const s = r.stats as any;
    if (!s || s.minutes_played === 0) continue;
    playedCount++;

    const oldScore = calculateMatchRating(s, 'AM', OLD_REFERENCE_STATS, p.primary_position).fantasyPoints;
    const dbScore = calculateMatchRating(s, 'AM', refStatsDB, p.primary_position).fantasyPoints;

    sumOldRef += oldScore;
    sumDbRef += dbScore;
  }

  console.log(`Played Games: ${playedCount}`);
  console.log(`PPG under OLD baselines in code: ${(sumOldRef / playedCount).toFixed(2)}`);
  console.log(`PPG under NEW baselines in DB  : ${(sumDbRef / playedCount).toFixed(2)}`);
})();
