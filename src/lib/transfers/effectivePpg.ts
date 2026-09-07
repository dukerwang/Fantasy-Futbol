/**
 * Effective PPG — the blended points-per-game figure the transfer UI shows
 * beside a player, used to sanity-check whether an asking price is sane.
 *
 * Lifted verbatim (behaviour-identical) out of
 * `src/app/(dashboard)/league/[leagueId]/trades/page.tsx`, where it sat as a
 * 120-line closure inside a React server component. It is business logic with
 * its own rules about reliability weighting and preseason proxies, and both the
 * hub route and the free-agents route need it, so it lives here now.
 *
 * The model, in short:
 *   - 10+ appearances this season  -> 60% last-10 form, 40% season average.
 *   - 1-9 appearances              -> blend this season against a reliability-
 *                                     weighted prior season, weighted N/10.
 *   - 0 appearances                -> prior season alone, or a market-value
 *                                     proxy for a player with no history.
 *
 * Reliability is minutes/1500 capped at 1, pulling a thin sample toward 4.0
 * rather than trusting two good cameos. The floor is 3.0 throughout: this
 * number is displayed, and a sub-3 PPG would read as noise.
 */

import type { createAdminClient } from '@/lib/supabase/admin';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface PpgSample {
  points: number;
  minutes: number;
}

/** Market-value proxy for a player with no recorded history at all. */
function proxyFromMarketValue(marketValue: number): number {
  if (marketValue >= 80) return 10.0;
  if (marketValue >= 40) return 8.0;
  if (marketValue >= 20) return 6.0;
  if (marketValue >= 10) return 4.5;
  return 3.0;
}

/** Prior-season PPG pulled toward 4.0 in proportion to how few minutes back it. */
function reliabilityAdjustedPrior(prevStats: PpgSample[]): number {
  const minutes = prevStats.reduce((sum, m) => sum + m.minutes, 0);
  const ppg = prevStats.reduce((sum, m) => sum + m.points, 0) / prevStats.length;
  const reliability = Math.min(1.0, minutes / 1500);
  return reliability * ppg + (1 - reliability) * 4.0;
}

export function calculateEffectivePpg(
  currStats: PpgSample[],
  prevStats: PpgSample[],
  marketValue: number,
): number {
  const N = currStats.length;
  let effective: number;

  if (N >= 10) {
    // Mid-season: form-weighted.
    const seasonPpg = currStats.reduce((sum, m) => sum + m.points, 0) / N;
    const recent = currStats.slice(0, 10);
    const recentPpg = recent.reduce((sum, m) => sum + m.points, 0) / recent.length;
    effective = 0.6 * recentPpg + 0.4 * seasonPpg;
  } else if (N >= 1) {
    // Early season: blend against history, trusting this season more as N grows.
    const thisSeasonPpg = currStats.reduce((sum, m) => sum + m.points, 0) / N;
    if (prevStats.length > 0) {
      const weightThis = N / 10;
      effective = weightThis * thisSeasonPpg + (1 - weightThis) * reliabilityAdjustedPrior(prevStats);
    } else {
      const weightActual = Math.min(1.0, N / 5);
      effective = weightActual * thisSeasonPpg + (1 - weightActual) * proxyFromMarketValue(marketValue);
    }
  } else {
    // Preseason / no appearances yet.
    effective = prevStats.length > 0
      ? reliabilityAdjustedPrior(prevStats)
      : proxyFromMarketValue(marketValue);
  }

  return Math.max(3.0, effective);
}

/**
 * Build player_id -> effective PPG for a set of players.
 *
 * Chunks the `in()` filter: the original inlined version passed every rostered
 * player in the league (20 clubs x 20+ players) as one PostgREST filter, which
 * builds a URL long enough to be at risk of rejection. 200 keeps it comfortable.
 *
 * DNPs (minutes <= 0) are excluded before any averaging — appearances, not
 * gameweeks, are the denominator.
 */
export async function buildEffectivePpgMap(
  admin: AdminClient,
  playerIds: string[],
  currentSeason: string,
  prevSeason: string,
  marketValues: Record<string, number>,
): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  if (playerIds.length === 0) return result;

  const groups: Record<string, { curr: PpgSample[]; prev: PpgSample[] }> = {};

  // Two axes of batching, and both are load-bearing.
  //
  // CHUNK caps the `.in()` list so the URL stays a sane length. PAGE caps the
  // ROWS that come back: a chunk of 200 players across two seasons is up to
  // 200 x 76 = 15,200 rows, and PostgREST silently returns only the first
  // 1,000. Chunking alone does not save you from that — it was returning a
  // truncated set, and because the order is season/gameweek descending, what
  // fell off the end was the prior season, which is precisely the input the
  // 0-9-appearance branches lean on. Page until a short page arrives.
  const CHUNK = 200;
  const PAGE = 1000;
  for (let i = 0; i < playerIds.length; i += CHUNK) {
    const chunk = playerIds.slice(i, i + CHUNK);

    for (let offset = 0; ; offset += PAGE) {
      const { data: stats } = await admin
        .from('player_stats')
        .select('player_id, fantasy_points, gameweek, stats, season')
        .in('player_id', chunk)
        .in('season', [currentSeason, prevSeason])
        .order('season', { ascending: false })
        .order('gameweek', { ascending: false })
        .order('player_id', { ascending: true })
        .range(offset, offset + PAGE - 1);

      for (const s of stats ?? []) {
        const raw = (s.stats as Record<string, unknown> | null) ?? {};
        const minutes = Number(raw.minutes_played ?? 0);
        if (minutes <= 0) continue;

        if (!groups[s.player_id]) groups[s.player_id] = { curr: [], prev: [] };
        const sample: PpgSample = { points: Number(s.fantasy_points) || 0, minutes };

        if (s.season === currentSeason) groups[s.player_id].curr.push(sample);
        else if (s.season === prevSeason) groups[s.player_id].prev.push(sample);
      }

      if (!stats || stats.length < PAGE) break;
    }
  }

  for (const id of playerIds) {
    const g = groups[id] ?? { curr: [], prev: [] };
    result[id] = calculateEffectivePpg(g.curr, g.prev, marketValues[id] ?? 0);
  }

  return result;
}
