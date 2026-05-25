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
  // Let's query some top CBs
  const cbNames = ["Saliba", "Van Dijk", "Gabriel Magalhaes", "Ruben Dias", "Konate"];
  
  console.log("=== CB WEIGHT ANALYSIS IN V2 ENGINE ===");

  for (const name of cbNames) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name, primary_position')
      .ilike('name', `%${name}%`);

    if (!players || players.length === 0) continue;
    const p = players[0];

    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) continue;

    let gp = 0;
    let sumRating = 0;
    let sumPts = 0;
    const componentAverages: Record<string, number> = {};
    const weightAverages: Record<string, number> = {};
    const contributionAverages: Record<string, number> = {};

    for (const r of statsRows) {
      const mins = r.stats?.minutes_played ?? 0;
      if (mins === 0) continue;
      gp++;

      const rating = calculateMatchRating(r.stats as any, 'CB', DEFAULT_REFERENCE_STATS, p.primary_position as GranularPosition);
      sumRating += rating.rating;
      sumPts += rating.fantasyPoints;

      for (const b of rating.breakdown) {
        componentAverages[b.component] = (componentAverages[b.component] ?? 0) + b.score;
        weightAverages[b.component] = (weightAverages[b.component] ?? 0) + b.weight;
        contributionAverages[b.component] = (contributionAverages[b.component] ?? 0) + b.weighted;
      }
    }

    if (gp === 0) continue;

    console.log(`\nPlayer: ${p.name} (Appearances: ${gp})`);
    console.log(`  Avg Rating: ${(sumRating / gp).toFixed(2)}, PPG: ${(sumPts / gp).toFixed(1)}`);
    console.log(`  Component Contributions:`);
    for (const comp of Object.keys(componentAverages)) {
      const cScore = componentAverages[comp] / gp;
      const cWeight = weightAverages[comp] / gp;
      const cContrib = contributionAverages[comp] / gp;
      console.log(`    - ${comp}: Score = ${cScore.toFixed(3)}, Weight = ${cWeight.toFixed(2)}, Contrib = ${cContrib.toFixed(3)}`);
    }
    console.log(`--------------------------------------------------`);
  }
})();
