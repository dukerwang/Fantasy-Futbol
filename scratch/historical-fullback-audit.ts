import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';

try {
  const env = fs.readFileSync(path.resolve(process.cwd(), '.env.local'), 'utf-8');
  for (const line of env.split('\n')) {
    const m = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
    if (m) process.env[m[1]] = (m[2] || '').replace(/^\"|\"$/g, '');
  }
} catch (e) {}

const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

const COMMITS = [
  { hash: 'HEAD', label: 'Current HEAD' },
  { hash: '0d0d573', label: '0d0d573: CB/ST Weight Rebalance' },
  { hash: '5290fbf', label: '5290fbf: Option B OOP Balancing' },
  { hash: 'eaee118', label: 'eaee118: Remove Minute Penalty / Fullback Def focus' },
  { hash: '463e3f6', label: '463e3f6: Curve Adjust threshold 4.5' },
  { hash: '385d746', label: '385d746: Adjust FP scaling' },
  { hash: '2b15da1', label: '2b15da1: Sigmoid K=1.3 / exp=1.5' },
  { hash: 'd8483f8', label: 'd8483f8: Steepen curve exp=2.0' },
  { hash: '675ebe2', label: '675ebe2: Decouple rating and FP scale' }
];

(async () => {
  // Load database reference stats for season 2025-26 once
  const { data: refData } = await sb.from('rating_reference_stats').select('position_group, component, median, stddev').eq('season', '2025-26');
  
  // Find player stats
  const { data: jamesPlayer } = await sb.from('players').select('id,primary_position').ilike('name', '%Reece James%');
  const { data: porroPlayer } = await sb.from('players').select('id,primary_position').ilike('name', '%Pedro Porro%');
  
  const jamesId = jamesPlayer![0].id;
  const porroId = porroPlayer![0].id;

  const { data: jamesStats } = await sb.from('player_stats').select('stats,gameweek').eq('player_id', jamesId).not('stats','is',null);
  const { data: porroStats } = await sb.from('player_stats').select('stats,gameweek').eq('player_id', porroId).not('stats','is',null);

  // We will save the current matchRating.ts file
  const originalCode = fs.readFileSync('src/lib/scoring/matchRating.ts', 'utf8');

  console.log(`Historical Audit of Reece James vs Pedro Porro PPG:`);
  console.log(`Commit / Change                                  | Reece James PPG | Pedro Porro PPG | Swapped?`);
  console.log(`-------------------------------------------------|-----------------|-----------------|----------`);

  try {
    for (const c of COMMITS) {
      // Checkout the matchRating.ts file from that commit to a temp location or directly
      try {
        execSync(`git checkout ${c.hash} -- src/lib/scoring/matchRating.ts`);
      } catch (err) {
        console.log(`Failed to checkout ${c.hash}`);
        continue;
      }

      // Re-require / import the matchRating module
      const matchRatingPath = path.resolve(process.cwd(), 'src/lib/scoring/matchRating.ts');
      const resolved = require.resolve(matchRatingPath);
      delete require.cache[resolved];
      
      const { calculateMatchRating, DEFAULT_REFERENCE_STATS } = require('../src/lib/scoring/matchRating');

      // Parse refStats for this run
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

      // Reece James
      let jamesGp = 0, jamesSum = 0;
      for (const r of jamesStats ?? []) {
        const s = r.stats as any;
        if (!s || s.minutes_played === 0) continue;
        jamesGp++;
        const res = calculateMatchRating(s, 'RB', refStats, 'RB');
        jamesSum += res.fantasyPoints;
      }
      const jamesPPG = jamesSum / jamesGp;

      // Pedro Porro
      let porroGp = 0, porroSum = 0;
      for (const r of porroStats ?? []) {
        const s = r.stats as any;
        if (!s || s.minutes_played === 0) continue;
        porroGp++;
        const res = calculateMatchRating(s, 'RB', refStats, 'RB');
        porroSum += res.fantasyPoints;
      }
      const porroPPG = porroSum / porroGp;

      const swapped = porroPPG > jamesPPG ? 'YES' : 'NO';

      console.log(
        `${c.label.padEnd(48)} | ` +
        `${jamesPPG.toFixed(2).padStart(15)} | ` +
        `${porroPPG.toFixed(2).padStart(15)} | ` +
        `${swapped.padStart(8)}`
      );
    }
  } finally {
    // Restore the file to original state
    fs.writeFileSync('src/lib/scoring/matchRating.ts', originalCode, 'utf8');
    // Clear cache again
    const matchRatingPath = path.resolve(process.cwd(), 'src/lib/scoring/matchRating.ts');
    delete require.cache[require.resolve(matchRatingPath)];
  }
})();
