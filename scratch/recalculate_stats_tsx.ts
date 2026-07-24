/**
 * Recalculate player_stats.fantasy_points for all 2025-26 rows using the 
 * production matchRating engine, with the correct player positions from DB.
 *
 * Run: npx tsx scratch/recalculate_stats_tsx.ts
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createClient } from '@supabase/supabase-js';
import { calculateMatchRating } from '../src/lib/scoring/matchRating';
import { loadReferenceStats } from '../src/lib/scoring/matchups';
import type { GranularPosition, RawStats } from '../src/types';

// Load env manually from .env.local
const env: Record<string, string> = {};
try {
  const envFile = readFileSync(join(process.cwd(), '.env.local'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
  }
} catch {}

const SUPABASE_URL = env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL!;
const SUPABASE_KEY = env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchAll<T>(table: string, select: string, filters: Record<string, any> = {}): Promise<T[]> {
  let all: T[] = [];
  let from = 0;
  while (true) {
    let q = supabase.from(table).select(select).range(from, from + 999);
    for (const [k, v] of Object.entries(filters)) q = (q as any).eq(k, v);
    const { data, error } = await q;
    if (error) throw error;
    if (!data?.length) break;
    all = all.concat(data as T[]);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

async function main() {
  console.log('=== RECALCULATING player_stats.fantasy_points (Production Engine) ===\n');

  // 1. Load players with correct positions
  const allPlayers = await fetchAll<{ id: string; name: string; primary_position: string; }>('players', 'id, name, primary_position');
  const playerPos = new Map(allPlayers.map(p => [p.id, p.primary_position as GranularPosition]));
  console.log(`Players loaded: ${allPlayers.length}`);

  // 2. Load reference stats
  const { data: refSeason } = await supabase
    .from('rating_reference_stats')
    .select('season')
    .order('season', { ascending: false })
    .limit(1)
    .single();
  const refStats = await loadReferenceStats(supabase as any, refSeason?.season ?? '2025-26');
  console.log(`Reference stats loaded for season: ${refSeason?.season}`);

  // 3. Load ALL 2025-26 player_stats
  type StatRow = { id: string; player_id: string; gameweek: number; fantasy_points: number | null; stats: RawStats | null };
  const allStats = await fetchAll<StatRow>('player_stats', 'id, player_id, gameweek, fantasy_points, stats', { season: '2025-26' });
  console.log(`player_stats rows: ${allStats.length}\n`);

  // 4. Recalculate fantasy_points for every row
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;

  // Batch updates for efficiency
  const updates: { id: string; fantasy_points: number; match_rating: number }[] = [];

  for (const row of allStats) {
    const position = playerPos.get(row.player_id);
    if (!position || !row.stats) { skipped++; continue; }

    const mins = Number(row.stats?.minutes_played ?? 0);
    
    const result = calculateMatchRating(row.stats, position, refStats as any);
    const newPts = result.fantasyPoints;
    const oldPts = Number(row.fantasy_points ?? 0);

    if (Math.abs(newPts - oldPts) > 0.01) {
      updates.push({ id: row.id, fantasy_points: newPts, match_rating: result.rating });
    } else {
      unchanged++;
    }
  }

  console.log(`Rows to update: ${updates.length}, unchanged: ${unchanged}, skipped: ${skipped}`);

  // Apply updates in batches of 100
  const BATCH_SIZE = 100;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    await Promise.all(batch.map(u =>
      supabase.from('player_stats').update({ 
        fantasy_points: u.fantasy_points, 
        match_rating: u.match_rating 
      }).eq('id', u.id)
    ));
    updated += batch.length;
    if (i % 1000 === 0) process.stdout.write(`  Updated ${updated}/${updates.length}...\r`);
  }
  console.log(`\nUpdated ${updated} rows.`);

  // 5. Spot check
  console.log('\n=== SPOT CHECKS ===');
  const checks = [
    { name: 'Bruno Fernandes', id: '4d7489a9-79e5-43b5-a654-a37ccaa61067', canonPts: 792.51, canonPpg: 22.6 },
    { name: 'Bryan Mbeumo', id: 'f5333e64-a954-46bb-9d20-f4e5784a6b68', canonPts: 404.31, canonPpg: 12.3 },
    { name: 'Lewis Hall', id: '26d4c44c-a94f-4c61-a5f9-d2f075533c54', canonPts: 216.78, canonPpg: 8.0 },
    { name: 'Gabriel Martinelli', id: '0a3c471a-ce3c-47a7-a2df-28d51a274f05', canonPts: 150.51, canonPpg: 5.9 },
  ];
  for (const c of checks) {
    const rows = allStats.filter(r => r.player_id === c.id);
    const withMins = rows.filter(r => Number(r.stats?.minutes_played ?? 0) > 0);
    // Use updated values where available
    const pts = withMins.reduce((s, r) => {
      const u = updates.find(u => u.id === r.id);
      return s + (u ? u.fantasy_points : Number(r.fantasy_points ?? 0));
    }, 0);
    const ppg = withMins.length > 0 ? pts / withMins.length : 0;
    const ok = Math.abs(pts - c.canonPts) < 10 ? '✅' : '⚠️';
    console.log(`${ok} ${c.name}: gp=${withMins.length}, pts=${pts.toFixed(2)} (${c.canonPts}), ppg=${ppg.toFixed(2)} (${c.canonPpg})`);
  }

  // 6. Trigger aggregate recalculation
  console.log('\nTriggering aggregate RPCs...');
  await (supabase as any).rpc('update_player_fantasy_scores', { p_season: '2025-26' });
  await (supabase as any).rpc('update_player_form_ratings', { p_season: '2025-26' });
  console.log('Done!');
}

main().catch(console.error);
