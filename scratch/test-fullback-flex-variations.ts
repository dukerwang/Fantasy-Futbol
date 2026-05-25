import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
import type { GranularPosition, RatingComponent } from '@/types';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

// We will simulate calculateMatchRating with different FLEX_CONFIG and POSITION_WEIGHTS
import * as matchRatingModule from '../src/lib/scoring/matchRating';

function runSimulation(
  statsRows: any[],
  pos: GranularPosition,
  refStats: any,
  flexComponents: RatingComponent[],
  positionWeights: Record<RatingComponent, number>
) {
  let gp = 0;
  let sumPts = 0;

  for (const r of statsRows) {
    const s = r.stats as any;
    if (!s || s.minutes_played === 0) continue;
    gp++;

    // Calculate score manually following the matchRating.ts logic but with custom weights
    // Step 1: Normalize
    // We can call the module's internal computeComponentScores via some bypass or just calculate
    // We can call calculateMatchRating directly by patching the module, or since we want high fidelity,
    // we can temporarily override the exported FLEX_CONFIG and POSITION_WEIGHTS in memory!
    
    // Let's do that! Override matchRatingModule exports
    const originalFlex = matchRatingModule.FLEX_CONFIG[pos];
    const originalWeights = matchRatingModule.POSITION_WEIGHTS[pos];
    
    matchRatingModule.FLEX_CONFIG[pos] = { flex: 0.25, components: flexComponents };
    matchRatingModule.POSITION_WEIGHTS[pos] = positionWeights;

    try {
      const res = calculateMatchRating(s, pos, refStats, pos);
      sumPts += res.fantasyPoints;
    } finally {
      // Restore
      matchRatingModule.FLEX_CONFIG[pos] = originalFlex;
      matchRatingModule.POSITION_WEIGHTS[pos] = originalWeights;
    }
  }

  return sumPts / gp;
}

(async () => {
  // Load database reference stats for season 2025-26
  const { data: refData } = await sb.from('rating_reference_stats').select('position_group, component, median, stddev').eq('season', '2025-26');
  const refStats: any = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
  if (refData && refData.length > 0) {
    for (const row of refData) {
      const pos = row.position_group;
      const comp = row.component;
      if (refStats[pos] && refStats[pos][comp]) {
        refStats[pos][comp] = { median: Number(row.median), stddev: Number(row.stddev) };
      }
    }
  }

  const targets = ['Reece James', 'Pedro Porro', 'Daniel Muñoz'];
  const playersData: any[] = [];

  for (const name of targets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position').ilike('name', '%' + name.replace('Muñoz', 'Mun') + '%');
    if (!found || found.length === 0) continue;
    const p = found[0];

    const { data: statsRows } = await sb
      .from('player_stats')
      .select('gameweek, stats')
      .eq('player_id', p.id)
      .not('stats','is',null);

    playersData.push({ player: p, stats: statsRows });
  }

  // Configuration options to test
  const VARIATIONS = [
    {
      name: '1. Current HEAD (Flex: creativity, match_impact, defensive)',
      flexComponents: ['creativity', 'match_impact', 'defensive'] as RatingComponent[],
      weights: { match_impact: 0.25, influence: 0.15, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }
    },
    {
      name: '2. Remove creativity from Flex (Flex: match_impact, defensive)',
      flexComponents: ['match_impact', 'defensive'] as RatingComponent[],
      weights: { match_impact: 0.25, influence: 0.15, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }
    },
    {
      name: '3. Aligned with CB flex (Flex: defensive, match_impact, goal_involvement)',
      flexComponents: ['defensive', 'match_impact', 'goal_involvement'] as RatingComponent[],
      weights: { match_impact: 0.25, influence: 0.15, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }
    },
    {
      name: '4. Attacking wingback style (Flex: creativity, goal_involvement - like RWB)',
      flexComponents: ['creativity', 'goal_involvement'] as RatingComponent[],
      weights: { match_impact: 0.25, influence: 0.15, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }
    },
    {
      name: '5. Lower base creativity weight (base creativity 0.15 -> 0.05, match_impact 0.25 -> 0.35)',
      flexComponents: ['creativity', 'match_impact', 'defensive'] as RatingComponent[],
      weights: { match_impact: 0.35, influence: 0.15, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }
    },
    {
      name: '6. Lower base creativity & no creativity flex (weights as #5, Flex as #2)',
      flexComponents: ['match_impact', 'defensive'] as RatingComponent[],
      weights: { match_impact: 0.35, influence: 0.15, creativity: 0.05, threat: 0.00, defensive: 0.15, goal_involvement: 0.05, finishing: 0.00, save_score: 0.00 }
    }
  ];

  for (const v of VARIATIONS) {
    console.log(`\n==================================================`);
    console.log(v.name);
    console.log(`--------------------------------------------------`);
    for (const { player, stats } of playersData) {
      const ppg = runSimulation(stats, 'RB', refStats, v.flexComponents, v.weights);
      console.log(`  ${player.name.padEnd(15)}: ${ppg.toFixed(2)} PPG`);
    }
  }
})();
