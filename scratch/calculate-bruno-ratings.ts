import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
import type { GranularPosition } from '@/types';

// Custom env loader
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        const key = match[1];
        let value = match[2] || '';
        if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
        process.env[key] = value;
      }
    }
  }
} catch (e) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  const { data: players } = await supabase
    .from('players')
    .select('id, name, primary_position')
    .eq('name', 'Bruno Fernandes');

  if (!players || players.length === 0) {
    console.error("Could not find Bruno Fernandes");
    return;
  }
  const p = players[0];

  const { data: refData } = await supabase
    .from('rating_reference_stats')
    .select('*')
    .eq('season', '2025/26');
  
  const refStats: any = {};
  if (refData && refData.length > 0) {
    for (const r of refData) {
      refStats[r.position] = {
        match_impact: { median: r.match_impact_median, stddev: r.match_impact_stddev },
        influence: { median: r.influence_median, stddev: r.influence_stddev },
        creativity: { median: r.creativity_median, stddev: r.creativity_stddev },
        threat: { median: r.threat_median, stddev: r.threat_stddev },
        defensive: { median: r.defensive_median, stddev: r.defensive_stddev },
        goal_involvement: { median: r.goal_involvement_median, stddev: r.goal_involvement_stddev },
        finishing: { median: r.finishing_median, stddev: r.finishing_stddev },
        save_score: { median: r.save_score_median, stddev: r.save_score_stddev },
      };
    }
  } else {
    Object.assign(refStats, DEFAULT_REFERENCE_STATS);
  }

  const { data: statsRows } = await supabase
    .from('player_stats')
    .select('stats')
    .eq('player_id', p.id)
    .not('stats', 'is', null);

  if (!statsRows || statsRows.length === 0) {
    console.error("No stats found for Bruno Fernandes");
    return;
  }

  console.log(`Analyzing ${statsRows.length} appearances for Bruno Fernandes:`);

  const calibrations = [
    { name: 'Current (3.5 + 6.0 * composite)', multiplier: 6.0, base: 3.5 },
    { name: 'Slightly Compressed (3.5 + 5.5 * composite)', multiplier: 5.5, base: 3.5 },
    { name: 'More Compressed (3.5 + 5.0 * composite)', multiplier: 5.0, base: 3.5 },
    { name: 'SofaScore-like (3.0 + 6.0 * composite)', multiplier: 6.0, base: 3.0 },
    { name: 'SofaScore-like compressed (3.0 + 5.5 * composite)', multiplier: 5.5, base: 3.0 },
  ];

  for (const cal of calibrations) {
    let totalRating = 0;
    let games = 0;
    let over9 = 0;
    let over8 = 0;

    for (const r of statsRows) {
      const mins = r.stats?.minutes_played ?? 0;
      if (mins === 0) continue;
      games++;

      const ratingObj = calculateMatchRating(r.stats as any, p.primary_position as GranularPosition, refStats, p.primary_position as GranularPosition);
      
      // Calculate rating with custom calibration
      // Step 2 is composite. Let's find it.
      // Since calculateMatchRating returns rating, we can reconstruct the composite:
      // rating = 3.5 + 6.0 * composite => composite = (rating - 3.5) / 6.0
      // Note: calculateMatchRating returns rating rounded to 1 decimal place, or we can compute it properly.
      // But we can also compute composite directly by doing step 1 & 2:
      // Let's recalculate composite:
      const compScores: any = {};
      const components = (calculateMatchRating as any).name; // we'll just parse the original rating
      const composite = (ratingObj.rating - 3.5) / 6.0;
      const customRating = Math.max(1.0, Math.min(10.0, cal.base + cal.multiplier * composite));
      const rounded = Math.round(customRating * 10) / 10;

      totalRating += rounded;
      if (rounded >= 9.0) over9++;
      if (rounded >= 8.0) over8++;
    }

    const avg = totalRating / games;
    console.log(`\nCalibration: ${cal.name}`);
    console.log(`  Average Match Rating: ${avg.toFixed(2)}`);
    console.log(`  Games >= 9.0: ${over9} (${((over9 / games) * 100).toFixed(1)}%)`);
    console.log(`  Games >= 8.0: ${over8} (${((over8 / games) * 100).toFixed(1)}%)`);
  }
})();
