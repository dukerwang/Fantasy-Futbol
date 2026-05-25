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

  const { data: statsRows } = await supabase
    .from('player_stats')
    .select('gameweek, stats')
    .eq('player_id', p.id)
    .not('stats', 'is', null)
    .order('gameweek', { ascending: true });

  if (!statsRows || statsRows.length === 0) {
    console.error("No stats found for Bruno Fernandes");
    return;
  }

  const refData = await supabase.from('rating_reference_stats').select('*').eq('season', '2025/26');
  const refStats: any = {};
  if (refData.data && refData.data.length > 0) {
    for (const r of refData.data) {
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

  console.log(`GW  | Mins | G | A | Cre | Thr | BPS | V2 Rating | V2 Points`);
  console.log(`----------------------------------------------------------------`);
  for (const r of statsRows) {
    const mins = r.stats?.minutes_played ?? 0;
    if (mins === 0) continue;

    const ratingObj = calculateMatchRating(r.stats as any, p.primary_position as GranularPosition, refStats, p.primary_position as GranularPosition);
    const g = r.stats.goals ?? 0;
    const a = r.stats.assists ?? 0;
    const cre = r.stats.creativity ?? 0;
    const thr = r.stats.threat ?? 0;
    const bps = r.stats.bps ?? 0;

    console.log(
      `${String(r.gameweek).padEnd(3)} | ` +
      `${String(mins).padEnd(4)} | ` +
      `${g} | ` +
      `${a} | ` +
      `${String(Math.round(cre)).padEnd(3)} | ` +
      `${String(Math.round(thr)).padEnd(3)} | ` +
      `${String(bps).padEnd(3)} | ` +
      `${ratingObj.rating.toFixed(1).padEnd(9)} | ` +
      `${ratingObj.fantasyPoints.toFixed(1)}`
    );
  }
})();
