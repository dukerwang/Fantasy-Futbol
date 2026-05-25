import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
import type { GranularPosition } from '@/types';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^"|"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

(async () => {
  // Load fixture GC lookup
  const fixtureGC: Record<string, number> = {};
  for (let gw = 1; gw <= 35; gw++) {
    try {
      const res = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${gw}`);
      if (!res.ok) continue;
      const fixtures = await res.json() as any[];
      for (const f of fixtures) {
        if (f.team_h_score != null && f.team_a_score != null) {
          fixtureGC[`${gw}_${f.team_h}`] = f.team_a_score;
          fixtureGC[`${gw}_${f.team_a}`] = f.team_h_score;
        }
      }
    } catch (e) {}
  }

  // Load DB ref stats
  const { data: refData } = await sb.from('rating_reference_stats').select('*').eq('season', '2025/26');
  const refStats: any = {};
  if (refData?.length) {
    for (const r of refData) {
      refStats[r.position] = {
        match_impact:     { median: r.match_impact_median,     stddev: r.match_impact_stddev },
        influence:        { median: r.influence_median,        stddev: r.influence_stddev },
        creativity:       { median: r.creativity_median,       stddev: r.creativity_stddev },
        threat:           { median: r.threat_median,           stddev: r.threat_stddev },
        defensive:        { median: r.defensive_median,        stddev: r.defensive_stddev },
        goal_involvement: { median: r.goal_involvement_median, stddev: r.goal_involvement_stddev },
        finishing:        { median: r.finishing_median,        stddev: r.finishing_stddev },
        save_score:       { median: r.save_score_median,       stddev: r.save_score_stddev },
      };
    }
  } else {
    Object.assign(refStats, DEFAULT_REFERENCE_STATS);
  }

  const targets = ['Reece James', 'Pedro Porro', 'Daniel Muñoz', 'Trent Alexander', 'Kieran Trippier', 'Diogo Dalot', 'Jurriën Timber'];

  // Define the variations we want to test
  const variations = [
    {
      name: '1. Standard V2 (BPS 0.30, Def 0.15, Cre 0.15, Inf 0.05, GI 0.10; Flex: Def/Cre)',
      weights: { match_impact: 0.30, influence: 0.05, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
      flexComponents: ['defensive', 'creativity']
    },
    {
      name: '2. Variation A (BPS 0.25, Def 0.15, Cre 0.20, Inf 0.05, GI 0.10; Flex: Def/Cre)',
      weights: { match_impact: 0.25, influence: 0.05, creativity: 0.20, threat: 0.00, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
      flexComponents: ['defensive', 'creativity']
    },
    {
      name: '3. Variation B (BPS 0.25, Def 0.20, Cre 0.20, Inf 0.00, GI 0.10; Flex: Def/Cre)',
      weights: { match_impact: 0.25, influence: 0.00, creativity: 0.20, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
      flexComponents: ['defensive', 'creativity']
    },
    {
      name: '4. Variation C (Standard Weights; Flex: Def/Cre/GI)',
      weights: { match_impact: 0.30, influence: 0.05, creativity: 0.15, threat: 0.00, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
      flexComponents: ['defensive', 'creativity', 'goal_involvement']
    },
    {
      name: '5. The Rolls-Royce Option (BPS 0.25, Def 0.15, Cre 0.20, GI 0.10; Flex: Def/Cre/GI)',
      weights: { match_impact: 0.25, influence: 0.05, creativity: 0.20, threat: 0.00, defensive: 0.15, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
      flexComponents: ['defensive', 'creativity', 'goal_involvement']
    },
    {
      name: '6. Traditional Fullback Option (BPS 0.30, Def 0.20, Cre 0.10, GI 0.10; Flex: Def only)',
      weights: { match_impact: 0.30, influence: 0.05, creativity: 0.10, threat: 0.00, defensive: 0.20, goal_involvement: 0.10, finishing: 0.00, save_score: 0.00 },
      flexComponents: ['defensive']
    }
  ];

  const { calculateMatchRating, POSITION_WEIGHTS, FLEX_CONFIG } = require('../src/lib/scoring/matchRating');

  for (const name of targets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position,pl_team_id').ilike('name', `%${name}%`);
    if (!found?.length) { console.log(`${name}: NOT FOUND`); continue; }
    const p = found[0];

    const { data: statsRows } = await sb.from('player_stats').select('stats,gameweek').eq('player_id', p.id).not('stats','is',null);
    if (!statsRows?.length) { console.log(`${name}: NO STATS`); continue; }

    const validGames = statsRows.filter(r => {
      const s = r.stats as any;
      return s && s.minutes_played >= 60;
    });

    console.log(`\n======================================================================`);
    console.log(`${p.name} (${p.primary_position}) — ${validGames.length} full games (>= 60 mins)`);
    console.log(`======================================================================`);

    for (const v of variations) {
      // Apply variation config to the live engine
      POSITION_WEIGHTS.LB = v.weights;
      POSITION_WEIGHTS.RB = v.weights;
      FLEX_CONFIG.LB = { flex: 0.25, components: v.flexComponents as any[] };
      FLEX_CONFIG.RB = { flex: 0.25, components: v.flexComponents as any[] };

      let totalPts = 0, totalRat = 0;
      for (const r of validGames) {
        const s = r.stats as any;
        const enriched = { ...s };
        const fixtureGcVal = fixtureGC[`${r.gameweek}_${p.pl_team_id}`];
        if (s.goals_conceded == null && fixtureGcVal !== undefined) {
          enriched.goals_conceded = fixtureGcVal;
        }

        const res = calculateMatchRating(enriched, p.primary_position as GranularPosition, refStats, p.primary_position as GranularPosition);
        totalPts += res.fantasyPoints;
        totalRat += res.rating;
      }
      console.log(`  ${v.name.padEnd(80)} | PPG: ${(totalPts / validGames.length).toFixed(2)} | Avg Rating: ${(totalRat / validGames.length).toFixed(2)}`);
    }
  }
})();
