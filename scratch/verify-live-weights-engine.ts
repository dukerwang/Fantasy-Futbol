import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
import type { GranularPosition } from '@/types';

// Load env
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        process.env[match[1]] = (match[2] || '').replace(/^"|"$/g, "");
      }
    }
  }
} catch (e) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
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

  // 1. Verify Saliba
  console.log("=== VERIFYING LIVE CB WEIGHTS ===");
  const cbs = ["William Saliba"];
  for (const name of cbs) {
    const { data: players } = await supabase.from('players').select('id, name, primary_position').ilike('name', `%${name}%`).eq('primary_position', 'CB');
    if (!players || players.length === 0) continue;
    const p = players[0];
    const { data: statsRows } = await supabase.from('player_stats').select('stats').eq('player_id', p.id).not('stats', 'is', null);
    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0, pts = 0, rat = 0;
    for (const r of statsRows) {
      if (r.stats?.minutes_played === 0) continue;
      gp++;
      const res = calculateMatchRating(r.stats as any, 'CB', refStats, 'CB');
      pts += res.fantasyPoints;
      rat += res.rating;
    }
    console.log(`Player: ${p.name}`);
    console.log(`  - Live CB Weights: Avg Rating = ${(rat / gp).toFixed(2)}, PPG = ${(pts / gp).toFixed(1)}`);
  }

  // 2. Verify Strikers
  console.log("\n=== VERIFYING LIVE ST WEIGHTS ===");
  const strikers = ["Erling Haaland", "João Pedro", "Hugo Ekitiké"];
  for (const name of strikers) {
    const { data: players } = await supabase.from('players').select('id, name, primary_position').ilike('name', `%${name}%`).eq('primary_position', 'ST');
    if (!players || players.length === 0) continue;
    const p = players[0];
    const { data: statsRows } = await supabase.from('player_stats').select('stats').eq('player_id', p.id).not('stats', 'is', null);
    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0, pts = 0, rat = 0;
    for (const r of statsRows) {
      if (r.stats?.minutes_played === 0) continue;
      gp++;
      const res = calculateMatchRating(r.stats as any, 'ST', refStats, 'ST');
      pts += res.fantasyPoints;
      rat += res.rating;
    }
    console.log(`Player: ${p.name}`);
    console.log(`  - Live ST Weights: Avg Rating = ${(rat / gp).toFixed(2)}, PPG = ${(pts / gp).toFixed(1)}`);
  }
})();
