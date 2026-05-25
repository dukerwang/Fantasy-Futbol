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
  const { calculateMatchRating, DEFAULT_REFERENCE_STATS, POSITION_WEIGHTS, FLEX_CONFIG } = await import('../src/lib/scoring/matchRating');

  // Print weight comparison table
  const rb  = POSITION_WEIGHTS.RB;
  const rwb = POSITION_WEIGHTS.RWB;
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║              FULLBACK (RB/LB) vs WINGBACK (RWB/LWB)             ║');
  console.log('╠══════════════╦══════════════╦══════════════╦════════════════════╣');
  console.log('║ Component    ║  Fullback RB ║  Wingback RWB║ Difference         ║');
  console.log('╠══════════════╬══════════════╬══════════════╬════════════════════╣');
  const comps = ['match_impact','influence','creativity','threat','defensive','goal_involvement'] as const;
  for (const c of comps) {
    const rbv  = rb[c];
    const rwbv = rwb[c];
    const diff = rbv - rwbv;
    const diffStr = diff === 0 ? 'same' : (diff > 0 ? `+${diff.toFixed(2)} (FB higher)` : `${diff.toFixed(2)} (WB higher)`);
    console.log(`║ ${c.padEnd(12)} ║     ${String(rbv.toFixed(2)).padEnd(8)} ║     ${String(rwbv.toFixed(2)).padEnd(8)} ║ ${diffStr.padEnd(18)} ║`);
  }
  console.log('╠══════════════╬══════════════╬══════════════╬════════════════════╣');
  console.log(`║ Flex pool    ║     0.25     ║     0.25     ║ same               ║`);
  console.log(`║ Flex goes to ║ ${FLEX_CONFIG.RB.components.join('/').padEnd(12)} ║ ${FLEX_CONFIG.RWB.components.join('/').padEnd(12)} ║                    ║`);
  console.log('╚══════════════╩══════════════╩══════════════╩════════════════════╝');

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

  const targets = ['Jurriën Timber', 'Pedro Porro', 'Wan-Bissaka'];

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║          PLAYER SCORES: Fullback (RB) vs Wingback (RWB)         ║');
  console.log('╠══════════════════════╦══════════════╦══════════════╦════════════╣');
  console.log('║ Player               ║  As RB (FB)  ║  As RWB (WB) ║  Δ PPG     ║');
  console.log('╠══════════════════════╬══════════════╬══════════════╬════════════╣');

  for (const name of targets) {
    const { data: found } = await sb.from('players').select('id,name,primary_position,pl_team_id').ilike('name', `%${name}%`);
    if (!found?.length) { console.log(`║ ${name.padEnd(20)} ║ NOT FOUND                                ║`); continue; }
    const p = found[0];

    const { data: statsRows } = await sb.from('player_stats').select('stats,gameweek').eq('player_id', p.id).not('stats','is',null);
    if (!statsRows?.length) { console.log(`║ ${p.name.padEnd(20)} ║ NO STATS                                 ║`); continue; }

    const games = statsRows.filter((r: any) => (r.stats as any)?.minutes_played >= 45);

    let rbPts = 0, rwbPts = 0;
    for (const r of games) {
      const s = r.stats as any;
      const enriched = { ...s };
      const gcVal = fixtureGC[`${r.gameweek}_${p.pl_team_id}`];
      if (s.goals_conceded == null && gcVal !== undefined) enriched.goals_conceded = gcVal;

      rbPts  += calculateMatchRating(enriched, 'RB',  refStats, 'RB').fantasyPoints;
      rwbPts += calculateMatchRating(enriched, 'RWB', refStats, 'RWB').fantasyPoints;
    }

    const rbPPG  = (rbPts  / games.length).toFixed(2);
    const rwbPPG = (rwbPts / games.length).toFixed(2);
    const delta  = (rwbPts / games.length) - (rbPts / games.length);
    const deltaStr = `${delta >= 0 ? '+' : ''}${delta.toFixed(2)}`;

    console.log(`║ ${p.name.padEnd(20)} ║   ${rbPPG.padEnd(10)} ║   ${rwbPPG.padEnd(10)} ║  ${deltaStr.padEnd(8)}║`);
  }
  console.log('╚══════════════════════╩══════════════╩══════════════╩════════════╝');
  console.log(`  (${targets.length} players, 45+ min games only)\n`);
})();
