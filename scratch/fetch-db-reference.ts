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
  const { loadReferenceStats } = await import('../src/lib/scoring/matchups');

  console.log("=== DB REFERENCE STATS FOR 2025-26 ===");
  const ref = await loadReferenceStats(sb as any, '2025-26');
  
  const positions = ['RB', 'RWB', 'DM', 'CM', 'LB', 'LWB'];
  
  for (const pos of positions) {
    const r = ref[pos];
    if (!r) {
      console.log(`❌ Position ${pos} not found in loaded reference stats!`);
      continue;
    }

    console.log(`\n--- Loaded ${pos} Reference Medians ---`);
    console.log(`  Match Impact (BPS)  : Median=${r.match_impact?.median?.toFixed(2)}, StdDev=${r.match_impact?.stddev?.toFixed(2)}`);
    console.log(`  Influence           : Median=${r.influence?.median?.toFixed(2)}, StdDev=${r.influence?.stddev?.toFixed(2)}`);
    console.log(`  Creativity          : Median=${r.creativity?.median?.toFixed(2)}, StdDev=${r.creativity?.stddev?.toFixed(2)}`);
    console.log(`  Threat              : Median=${r.threat?.median?.toFixed(2)}, StdDev=${r.threat?.stddev?.toFixed(2)}`);
    console.log(`  Defensive           : Median=${r.defensive?.median?.toFixed(2)}, StdDev=${r.defensive?.stddev?.toFixed(2)}`);
    console.log(`  Goal Involvement    : Median=${r.goal_involvement?.median?.toFixed(2)}, StdDev=${r.goal_involvement?.stddev?.toFixed(2)}`);
  }
})();
