import { createClient } from '@supabase/supabase-js';
import fs from 'fs';
import path from 'path';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../src/lib/scoring/matchRating';
import { calculateTeamScore } from '../src/lib/scoring/matchups';
import { normalizeMatchupLineup } from '../src/lib/lineups/normalizeMatchupLineup';
import type { GranularPosition, ReferenceStats } from '@/types';

// Load env
try {
  const envPath = path.resolve(process.cwd(), '.env.local');
  if (fs.existsSync(envPath)) {
    const envFile = fs.readFileSync(envPath, 'utf-8');
    for (const line of envFile.split('\n')) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)?\s*$/);
      if (match) {
        process.env[match[1]] = (match[2] || '').replace(/^"|"$/g, '');
      }
    }
  }
} catch (e) {}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function main() {
  console.log("=== STARTING FULL PAGINATED DIRECT DATABASE BACKFILL FOR SCORING V2 ===");
  
  // 1. Fetch all players
  console.log("Loading players...");
  const { data: players } = await supabase
    .from('players')
    .select('id, primary_position, secondary_positions, pl_team_id');
  if (!players) {
    console.error("Could not load players.");
    return;
  }
  console.log(`Loaded ${players.length} players.`);
  const playerById = new Map<string, any>();
  for (const p of players) {
    playerById.set(p.id, p);
  }

  // 2. Fetch rating reference stats for season 2025/26
  console.log("Loading reference stats for season 2025-26...");
  const { data: refData } = await supabase
    .from('rating_reference_stats')
    .select('*')
    .eq('season', '2025/26');
  
  const refStats: Record<string, ReferenceStats> = {} as any;
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
  console.log("Reference stats loaded.");

  // 3. Loop over all 38 gameweeks
  for (let gw = 1; gw <= 38; gw++) {
    console.log(`\n--- PROCESSING GAMEWEEK ${gw} ---`);

    // Fetch player_stats rows for this GW (paginated)
    const statsRows: any[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const { data } = await supabase
        .from('player_stats')
        .select('id, player_id, stats')
        .eq('gameweek', gw)
        .not('stats', 'is', null)
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      
      if (!data || data.length === 0) break;
      statsRows.push(...data);
      if (data.length < PAGE_SIZE) break;
      page++;
    }

    if (statsRows.length === 0) {
      console.log(`No player stats found for GW ${gw}.`);
    } else {
      console.log(`Found ${statsRows.length} player_stats rows for GW ${gw}. Recalculating V2 scoring...`);
      
      let updatedStatsCount = 0;
      const CHUNK_SIZE = 100;
      for (let i = 0; i < statsRows.length; i += CHUNK_SIZE) {
        const chunk = statsRows.slice(i, i + CHUNK_SIZE);
        await Promise.all(chunk.map(async (row: any) => {
          const p = playerById.get(row.player_id);
          if (!p) return;

          const rawStats = row.stats as any;
          if (rawStats.minutes_played === 0) {
            await supabase
              .from('player_stats')
              .update({
                fantasy_points: 0,
                match_rating: 0
              })
              .eq('id', row.id);
            updatedStatsCount++;
            return;
          }

          const v2 = calculateMatchRating(
            rawStats,
            p.primary_position as GranularPosition,
            refStats,
            p.primary_position as GranularPosition
          );

          const { error } = await supabase
            .from('player_stats')
            .update({
              fantasy_points: v2.fantasyPoints,
              match_rating: v2.rating
            })
            .eq('id', row.id);

          if (error) {
            console.error(`  Error updating player_stats row ${row.id}:`, error.message);
          } else {
            updatedStatsCount++;
          }
        }));
      }
      console.log(`Successfully updated ${updatedStatsCount} player_stats rows for GW ${gw}.`);
    }

    // Fetch matchups for this GW
    const { data: matchups, error: mErr } = await supabase
      .from('matchups')
      .select('id, lineup_a, lineup_b, team_a_id, team_b_id')
      .eq('gameweek', gw);

    if (mErr) {
      console.error(`Error fetching matchups for GW ${gw}:`, mErr.message);
      continue;
    }

    if (!matchups || matchups.length === 0) {
      console.log(`No matchups found for GW ${gw}.`);
      continue;
    }

    console.log(`Updating ${matchups.length} matchups for GW ${gw}...`);

    // Prepare map of players in matchups for this GW
    const playerIds = new Set<string>();
    for (const m of matchups) {
      (m.lineup_a as any)?.starters?.forEach((s: any) => playerIds.add(s.player_id));
      (m.lineup_a as any)?.bench?.forEach((b: any) => playerIds.add(b.player_id));
      (m.lineup_b as any)?.starters?.forEach((s: any) => playerIds.add(s.player_id));
      (m.lineup_b as any)?.bench?.forEach((b: any) => playerIds.add(b.player_id));
    }

    if (playerIds.size === 0) continue;

    // Fetch the fresh points we just updated
    const { data: gwStatsRows } = await supabase
      .from('player_stats')
      .select('player_id, fantasy_points, stats')
      .eq('gameweek', gw)
      .in('player_id', Array.from(playerIds));

    const playerRecord = new Map();
    for (const r of gwStatsRows ?? []) {
      const stats = r.stats ?? null;
      const fixtureMins = stats?.minutes_played ?? 0;
      const pts = Number(r.fantasy_points) || 0;
      const fix = { minutes: fixtureMins, fantasyPoints: pts, stats };
      const ex = playerRecord.get(r.player_id);
      if (!ex) {
        playerRecord.set(r.player_id, { fixtures: [fix] });
      } else {
        playerRecord.set(r.player_id, { fixtures: [...ex.fixtures, fix] });
      }
    }

    const playerPositions = new Map();
    const playerPlTeamId = new Map();
    for (const pid of playerIds) {
      const p = playerById.get(pid);
      if (!p) continue;
      playerPositions.set(pid, [p.primary_position, ...(p.secondary_positions ?? [])]);
      if (p.pl_team_id) {
        playerPlTeamId.set(pid, p.pl_team_id);
      }
    }

    let updatedMatchupsCount = 0;
    await Promise.all(matchups.map(async (m: any) => {
      const lineupA = normalizeMatchupLineup(m.lineup_a as any);
      const lineupB = normalizeMatchupLineup(m.lineup_b as any);

      const scoreA = calculateTeamScore(
        lineupA, playerRecord, playerPositions, playerPlTeamId, refStats as any, true, new Set()
      );
      const scoreB = calculateTeamScore(
        lineupB, playerRecord, playerPositions, playerPlTeamId, refStats as any, true, new Set()
      );
      const gap = Math.abs(scoreA - scoreB);
      const winnerId = gap > 10 ? (scoreA > scoreB ? m.team_a_id : m.team_b_id) : null;

      const { error } = await supabase
        .from('matchups')
        .update({
          score_a: scoreA,
          score_b: scoreB,
          winner_team_id: winnerId
        })
        .eq('id', m.id);

      if (error) {
        console.error(`    Error updating matchup row ${m.id}:`, error.message);
      } else {
        updatedMatchupsCount++;
      }
    }));
    console.log(`Successfully updated ${updatedMatchupsCount} matchups for GW ${gw}.`);
  }

  console.log("\nRecalculating database standings triggers...");
  await supabase.rpc('update_player_fantasy_scores');
  await supabase.rpc('update_player_form_ratings');

  console.log("\n=== FULL DIRECT DATABASE BACKFILL COMPLETE ===");
}

main().catch(console.error);
