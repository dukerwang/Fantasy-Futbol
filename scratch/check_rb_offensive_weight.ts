import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { calculateMatchRating } from '../src/lib/scoring/matchRating.ts';
import { loadReferenceStats } from '../src/lib/scoring/matchups.ts';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split('\n')
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()])
);

const admin = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

async function run() {
  const refStats = await loadReferenceStats(admin, '2025-26');

  // Let's test a hypothetical RB match
  // Case 1: RB with high creativity (3 key passes, high crossing), 0G, 0A, 1 GC, 0 CS
  const highCreativityRB = {
    minutes_played: 90,
    goals: 0,
    assists: 0,
    bps: 22,
    influence: 20.0,
    creativity: 45.0, // High creativity
    threat: 12.0,
    clean_sheet: false,
    goals_conceded: 1,
    expected_goals: 0.05,
    expected_assists: 0.35,
    expected_goals_conceded: 1.2,
    fpl_tackles: 2,
    fpl_cbi: 4,
    fpl_recoveries: 6,
    fpl_def_contrib: 12,
  };

  const resRB = calculateMatchRating(highCreativityRB, 'RB', refStats);
  const resRWB = calculateMatchRating(highCreativityRB, 'RWB', refStats);

  console.log('=== CASE 1: High Creativity RB (45.0 Creativity, 0G, 0A, 1 GC) ===');
  console.log('Scored as RB:  Rating', resRB.rating, '| Points', resRB.fantasyPoints, '| Max flex:', resRB.maxComponent);
  console.log('RB breakdown:');
  for (const b of resRB.breakdown) {
    console.log(`  ${b.component.padEnd(18)} score=${b.score.toFixed(3)} weight=${b.weight.toFixed(2)} weighted=${b.weighted.toFixed(3)} detail=${b.detail}`);
  }

  console.log('\nScored as RWB: Rating', resRWB.rating, '| Points', resRWB.fantasyPoints, '| Max flex:', resRWB.maxComponent);
  for (const b of resRWB.breakdown) {
    console.log(`  ${b.component.padEnd(18)} score=${b.score.toFixed(3)} weight=${b.weight.toFixed(2)} weighted=${b.weighted.toFixed(3)} detail=${b.detail}`);
  }

  // Case 2: RB with an assist (0G, 1A, 1 GC, 0 CS, 35 Creativity)
  const assistRB = {
    minutes_played: 90,
    goals: 0,
    assists: 1,
    bps: 28,
    influence: 30.0,
    creativity: 35.0,
    threat: 8.0,
    clean_sheet: false,
    goals_conceded: 1,
    expected_goals: 0.02,
    expected_assists: 0.45,
    expected_goals_conceded: 1.1,
    fpl_tackles: 2,
    fpl_cbi: 3,
    fpl_recoveries: 5,
    fpl_def_contrib: 10,
  };

  const resAssistRB = calculateMatchRating(assistRB, 'RB', refStats);
  console.log('\n=== CASE 2: Attacking Return RB (1 Assist, 35.0 Creativity, 1 GC) ===');
  console.log('Scored as RB: Rating', resAssistRB.rating, '| Points', resAssistRB.fantasyPoints, '| Max flex:', resAssistRB.maxComponent);
  for (const b of resAssistRB.breakdown) {
    console.log(`  ${b.component.padEnd(18)} score=${b.score.toFixed(3)} weight=${b.weight.toFixed(2)} weighted=${b.weighted.toFixed(3)} detail=${b.detail}`);
  }
}

run().catch(console.error);
