import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
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
  console.log("=== STARTING SURGICAL SCORING V2 BACKFILL ===");

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

  const targetNames = [
    "William Saliba",
    "Erling Haaland",
    "João Pedro",
    "Ollie Watkins",
    "Alexander Isak",
    "Dominic Solanke",
    "Igor Thiago",
    "Hugo Ekitiké",
    "Virgil van Dijk"
  ];

  for (const name of targetNames) {
    console.log(`Processing player: ${name}...`);
    
    // Add position filtering to select the correct striker/defender
    const isDefender = name === "William Saliba" || name === "Virgil van Dijk";
    const pos = isDefender ? "CB" : "ST";
    
    const { data: players } = await supabase
      .from('players')
      .select('id, name, primary_position')
      .ilike('name', `%${name}%`)
      .eq('primary_position', pos);

    if (!players || players.length === 0) {
      console.log(`  Player "${name}" not found.`);
      continue;
    }

    const p = players[0];
    const { data: statsRows } = await supabase
      .from('player_stats')
      .select('id, stats, gameweek')
      .eq('player_id', p.id)
      .not('stats', 'is', null);

    if (!statsRows || statsRows.length === 0) {
      console.log(`  No stats rows found for ${p.name}`);
      continue;
    }

    console.log(`  Found ${statsRows.length} matches. Recalculating V2 scoring...`);
    let updatedCount = 0;

    await Promise.all(statsRows.map(async (row) => {
      const rawStats = row.stats as any;
      if (rawStats.minutes_played === 0) return;

      const v2 = calculateMatchRating(
        rawStats,
        p.primary_position as GranularPosition,
        refStats,
        p.primary_position as GranularPosition
      );

      const { error } = await supabase
        .from('player_stats')
        .update({
          fantasy_points_v2: v2.fantasyPoints,
          match_rating_v2: v2.rating
        })
        .eq('id', row.id);

      if (error) {
        console.error(`    Error updating row ${row.id}:`, error.message);
      } else {
        updatedCount++;
      }
    }));

    console.log(`  Successfully updated ${updatedCount} rows for ${p.name}.`);
  }

  console.log("=== SURGICAL BACKFILL COMPLETE ===");
})();
