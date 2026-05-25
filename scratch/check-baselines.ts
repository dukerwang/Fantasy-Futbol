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

(async () => {
  const { DEFAULT_REFERENCE_STATS } = await import('../src/lib/scoring/matchRating');

  console.log("=== COMPARING POSITION BASELINE MEDIANS ===");
  const { data: refData } = await sb.from('rating_reference_stats').select('*');
  
  console.log(`Found ${refData?.length ?? 0} rows in rating_reference_stats.`);
  if (refData && refData.length > 0) {
    console.log("Seasons in DB:", [...new Set(refData.map(r => r.season))]);
    console.log("Positions in DB:", [...new Set(refData.map(r => r.position))]);
  }

  // Let's look at either DB or default stats
  const refStats = (refData && refData.length > 0) ? refData : null;

  const positions = ['RB', 'RWB', 'DM', 'CM', 'LB', 'LWB'];
  
  for (const pos of positions) {
    let r: any;
    if (refStats) {
      // Find the one with highest season or any
      r = refStats.find(d => d.position === pos);
      if (r) {
        r = {
          match_impact: { median: r.match_impact_median, stddev: r.match_impact_stddev },
          influence: { median: r.influence_median, stddev: r.influence_stddev },
          creativity: { median: r.creativity_median, stddev: r.creativity_stddev },
          threat: { median: r.threat_median, stddev: r.threat_stddev },
          defensive: { median: r.defensive_median, stddev: r.defensive_stddev },
          goal_involvement: { median: r.goal_involvement_median, stddev: r.goal_involvement_stddev },
        };
      }
    }

    if (!r) {
      r = (DEFAULT_REFERENCE_STATS as any)[pos];
      console.log(`\n--- Baseline for ${pos} (from DEFAULT_REFERENCE_STATS in code) ---`);
    } else {
      console.log(`\n--- Baseline for ${pos} (from DB) ---`);
    }

    if (r) {
      console.log(`  Match Impact (BPS)  : Median=${r.match_impact?.median?.toFixed(2)}, StdDev=${r.match_impact?.stddev?.toFixed(2)}`);
      console.log(`  Influence           : Median=${r.influence?.median?.toFixed(2)}, StdDev=${r.influence?.stddev?.toFixed(2)}`);
      console.log(`  Creativity          : Median=${r.creativity?.median?.toFixed(2)}, StdDev=${r.creativity?.stddev?.toFixed(2)}`);
      console.log(`  Threat              : Median=${r.threat?.median?.toFixed(2)}, StdDev=${r.threat?.stddev?.toFixed(2)}`);
      console.log(`  Defensive           : Median=${r.defensive?.median?.toFixed(2)}, StdDev=${r.defensive?.stddev?.toFixed(2)}`);
      console.log(`  Goal Involvement    : Median=${r.goal_involvement?.median?.toFixed(2)}, StdDev=${r.goal_involvement?.stddev?.toFixed(2)}`);
    }
  }
})();
