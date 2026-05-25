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

  const playersToTest = [
    { name: "Amad Diallo", sec: "RWB" },
    { name: "Patrick Dorgu", sec: "LWB" },
    { name: "Bendito Mantato", sec: "LB" },
    { name: "John McGinn", sec: "RWB" },
    { name: "Dominik Szoboszlai", sec: "RB" }
  ];

  console.log("=== VERIFYING LIVE OOP ENGINE OUTPUTS UNDER OPTION B ===");

  for (const item of playersToTest) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name, primary_position')
      .ilike('name', `%${item.name}%`);

    if (!players || players.length === 0) continue;
    const p = players[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let sumPtsPrimary = 0;
    let sumPtsSecLive = 0;

    for (const r of statsRows) {
      const mins = r.stats?.minutes_played ?? 0;
      if (mins === 0) continue;
      gp++;

      // Primary position rating (primaryPosition passed as primPos)
      const prim = calculateMatchRating(r.stats as any, p.primary_position as GranularPosition, refStats, p.primary_position as GranularPosition);
      sumPtsPrimary += prim.fantasyPoints;

      // Secondary position rating (primaryPosition passed as primPos)
      const sec = calculateMatchRating(r.stats as any, item.sec as GranularPosition, refStats, p.primary_position as GranularPosition);
      sumPtsSecLive += sec.fantasyPoints;
    }

    if (gp === 0) continue;

    console.log(`Player: ${p.name}`);
    console.log(`  - Primary (${p.primary_position}): ${(sumPtsPrimary / gp).toFixed(1)} PPG`);
    console.log(`  - Slotted Secondary (${item.sec}) under Option B: ${(sumPtsSecLive / gp).toFixed(1)} PPG`);
    console.log(`--------------------------------------------------`);
  }
})();
