import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS, getPositionGroup } from '../src/lib/scoring/matchRating';
import type { GranularPosition } from '@/types';

// Load env
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        process.env[match[1]] = (match[2] || '').replace(/^"|"$/g, "");
      }
    }
  }
} catch (e) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

(async () => {
  console.log("=== RESEARCHING MIDFIELDERS & WINGERS V2 SCORING ===");

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
    // DMs
    { name: "Moisés Caicedo", pos: "DM" },
    { name: "Declan Rice", pos: "DM" },
    { name: "Rodri", pos: "DM" },
    // CMs
    { name: "Alexis Mac Allister", pos: "CM" },
    { name: "Kobbie Mainoo", pos: "CM" },
    { name: "Mateo Kovacic", pos: "CM" },
    // AMs
    { name: "Bruno Fernandes", pos: "AM" },
    { name: "Martin Ødegaard", pos: "AM" },
    { name: "Cole Palmer", pos: "AM" },
    { name: "James Maddison", pos: "AM" },
    // Wingers
    { name: "Mohamed Salah", pos: "RW" },
    { name: "Bukayo Saka", pos: "RW" },
    { name: "Son Heung-min", pos: "LW" },
    { name: "Luis Díaz", pos: "LW" }
  ];

  for (const item of playersToTest) {
    const { data: players } = await supabase
      .from('players')
      .select('id, name, primary_position')
      .ilike('name', `%${item.name}%`)
      .eq('primary_position', item.pos);

    if (!players || players.length === 0) {
      console.log(`Player "${item.name}" (${item.pos}) not found.`);
      continue;
    }

    const p = players[0];
    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('stats')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) {
      console.log(`No stats rows found for ${p.name}`);
      continue;
    }

    let gp = 0;
    let totalPoints = 0;
    let totalRating = 0;
    const componentScores: Record<string, number> = {};
    const componentWeights: Record<string, number> = {};

    for (const r of statsRows) {
      const stats = r.stats as any;
      if (!stats || stats.minutes_played === 0) continue;
      gp++;

      const res = calculateMatchRating(stats, p.primary_position as GranularPosition, refStats, p.primary_position as GranularPosition);
      totalPoints += res.fantasyPoints;
      totalRating += res.rating;

      for (const b of res.breakdown) {
        componentScores[b.component] = (componentScores[b.component] ?? 0) + b.score;
        componentWeights[b.component] = (componentWeights[b.component] ?? 0) + b.weight;
      }
    }

    if (gp === 0) continue;

    const avgPpg = totalPoints / gp;
    const avgRating = totalRating / gp;

    console.log(`==================================================`);
    console.log(`Player: ${p.name} | Position: ${p.primary_position} | Games: ${gp}`);
    console.log(`Average Display Rating: ${avgRating.toFixed(2)} | PPG: ${avgPpg.toFixed(1)}`);
    console.log(`Component Breakdown (Average Normalized Score / Average Final Weight):`);
    
    for (const key of Object.keys(componentScores)) {
      const avgScore = componentScores[key] / gp;
      const avgWeight = componentWeights[key] / gp;
      console.log(`  - ${key.padEnd(20)}: Score = ${avgScore.toFixed(3)} | Weight = ${avgWeight.toFixed(2)} (Contrib = ${(avgScore * avgWeight).toFixed(3)})`);
    }
  }

  console.log(`==================================================`);
})();
