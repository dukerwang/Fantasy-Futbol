/**
 * Regulars pool for Futbolpedia outlook batch generation.
 *
 * Thresholds (tuned for ~250–350 PL players):
 *   - market_value >= €8m
 *   - total_points >= 15 (meaningful season involvement)
 *   - >= 5 appearances in current season (player_stats rows with minutes > 0)
 *   - on any league roster (active/bench/ir/taxi/loan)
 *
 * Union of the above, active PL players only.
 */
import type { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';
import { fetchAllPages } from '@/lib/supabase/pagination';

export const REGULARS_THRESHOLDS = {
  minMarketValueEurM: 8,
  minTotalPoints: 15,
  minAppearances: 5,
} as const;

async function loadRosteredPlayerIds(admin: SupabaseClient): Promise<Set<string>> {
  const data = await fetchAllPages<{ player_id: string }>((from, to) =>
    admin.from('roster_entries').select('player_id').not('player_id', 'is', null).range(from, to),
  );
  return new Set(data.map((r) => r.player_id));
}

async function loadAppearanceCounts(
  admin: SupabaseClient,
  season: string,
): Promise<Map<string, number>> {
  // Paginated: PostgREST truncates at 1,000 rows without saying so, and
  // player_stats passes that a few gameweeks into every season (2026-27 was
  // already at 1,235 by GW2). Unpaginated, this silently dropped the
  // appearance signal for most of the pool.
  const data = await fetchAllPages<{ player_id: string; stats: { minutes_played?: number } | null }>(
    (from, to) =>
      admin.from('player_stats').select('player_id, stats').eq('season', season).range(from, to),
  );

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    const stats = row.stats as { minutes_played?: number } | null;
    const mins = Number(stats?.minutes_played ?? 0);
    if (mins <= 0) continue;
    const id = row.player_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}

export async function loadRegularPlayerIds(
  admin: SupabaseClient,
  limit?: number,
): Promise<string[]> {
  const season = await getCurrentFplSeason();
  const [rostered, appearanceCounts] = await Promise.all([
    loadRosteredPlayerIds(admin),
    loadAppearanceCounts(admin, season),
  ]);

  const players = await fetchAllPages<{
    id: string;
    market_value: number | null;
    total_points: number | null;
    is_active: boolean;
  }>((from, to) =>
    admin
      .from('players')
      .select('id, market_value, total_points, is_active')
      .eq('is_active', true)
      .range(from, to),
  );

  const ids: string[] = [];
  for (const p of players ?? []) {
    const id = p.id as string;
    const marketValue = Number(p.market_value ?? 0);
    const totalPoints = Number(p.total_points ?? 0);
    const appearances = appearanceCounts.get(id) ?? 0;

    const isRegular =
      rostered.has(id) ||
      marketValue >= REGULARS_THRESHOLDS.minMarketValueEurM ||
      totalPoints >= REGULARS_THRESHOLDS.minTotalPoints ||
      appearances >= REGULARS_THRESHOLDS.minAppearances;

    if (isRegular) ids.push(id);
  }

  ids.sort();
  return limit ? ids.slice(0, limit) : ids;
}
