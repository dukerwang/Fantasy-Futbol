import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?(\s*)$/);
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

  // Load live weights from matchRating
  const { calculateMatchRating, DEFAULT_REFERENCE_STATS, POSITION_WEIGHTS, FLEX_CONFIG } = await import('../src/lib/scoring/matchRating');

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

  // Player name → [calcPosition, label override]
  const targets: [string, string, string][] = [
    ['Reece James',    'RB',  'RB'],
    ['Pedro Porro',    'RB',  'RB'],
    ['Jurriën Timber', 'RB',  'as RB'],
    ['Jurriën Timber', 'RWB', 'as RWB (primary)'],
    ['Daniel Muñoz',   'RB',  'RB'],
    ['Kieran Trippier','RB',  'RB'],
    ['Diogo Dalot',    'RB',  'RB'],
  ];

  console.log('\n=== LIVE WEIGHTS ===');
  console.log('RB  weights:', JSON.stringify(POSITION_WEIGHTS.RB));
  console.log('RB  flex:   ', JSON.stringify(FLEX_CONFIG.RB));
  console.log('RWB weights:', JSON.stringify(POSITION_WEIGHTS.RWB));
  console.log('RWB flex:   ', JSON.stringify(FLEX_CONFIG.RWB));
  console.log('');

  const seen = new Map<string, any>();

  for (const [name, calcPos, label] of targets) {
    let p = seen.get(name);
    if (!p) {
      const { data: found } = await sb.from('players').select('id,name,primary_position,pl_team_id').ilike('name', `%${name}%`);
      if (!found?.length) { console.log(`${name}: NOT FOUND`); continue; }
      p = found[0];
      seen.set(name, p);
    }

    const { data: statsRows } = await sb.from('player_stats').select('stats,gameweek').eq('player_id', p.id).not('stats','is',null);
    if (!statsRows?.length) { console.log(`${name}: NO STATS`); continue; }

    const validGames = statsRows.filter((r: any) => {
      const s = r.stats as any;
      return s && s.minutes_played >= 45;
    });

    let totalPts = 0, totalRat = 0;
    for (const r of validGames) {
      const s = r.stats as any;
      const enriched = { ...s };
      const gcVal = fixtureGC[`${r.gameweek}_${p.pl_team_id}`];
      if (s.goals_conceded == null && gcVal !== undefined) enriched.goals_conceded = gcVal;

      const res = calculateMatchRating(enriched, calcPos as any, refStats, calcPos as any);
      totalPts += res.fantasyPoints;
      totalRat += res.rating;
    }

    const ppg = (totalPts / validGames.length).toFixed(2);
    const rat = (totalRat / validGames.length).toFixed(2);
    console.log(`${p.name.padEnd(20)} [${label.padEnd(18)}] | ${validGames.length} games (45+) | PPG: ${ppg.padStart(5)} | Rating: ${rat}`);
  }
})();
