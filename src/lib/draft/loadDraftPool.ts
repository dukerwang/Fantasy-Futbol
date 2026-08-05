/**
 * Shared player-pool + shadow-stats loader used by both the real draft room
 * and the mock draft. Keeping this in one place means practice mode sees the
 * exact same ranks, archive overlays, and per-position GP/Pts/PPG/Avg as the
 * live draft — which is what the player card and scouting table read from.
 */

import { unstable_cache } from 'next/cache';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { createAdminClient } from '@/lib/supabase/admin';
import { getLatestReferenceStatsSeason, resolveDraftStatsSeason } from '@/lib/season/currentSeason';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '@/lib/scoring/matchRating';
import type { Player } from '@/types';

export type ShadowPosStats = {
  gp: number;
  total_points: number;
  avg_rating: number;
  total_minutes: number;
};

export type DraftShadowMaps = {
  all: Record<string, Record<string, ShadowPosStats>>;
  gt45: Record<string, Record<string, ShadowPosStats>>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

export async function loadDraftPool(
  admin: AdminClient,
  league: { current_season?: string | null; previous_season?: string | null },
): Promise<{ players: Player[]; shadowMaps: DraftShadowMaps; season: string }> {
  // Draft scouting always uses the latest completed season with archive data
  // (e.g. 2025-26), never the empty upcoming league.current_season (2026-27)
  // and never a stale previous_season default with zero rows (2024-25).
  const season = await resolveDraftStatsSeason(admin, league);
  const refSeason = await getLatestReferenceStatsSeason(admin);
  const { players, shadowMaps } = await loadDraftStatsForSeason(season, refSeason);
  return { players, shadowMaps, season };
}

// The draft room polls this every 15s per connected client to catch auto-picks
// and timer state. Everything below depends only on (season, refSeason), not on
// any one league, so it's cached across every poll from every client instead of
// re-running a ~15-page unfiltered scan of player_stats on every tick — that was
// enough concurrent full-table scans during a live draft to starve the DB
// connection pool for everyone (see the 2026-08-05 incident).
const loadDraftStatsForSeason = unstable_cache(
  async (season: string, refSeason: string): Promise<{ players: Player[]; shadowMaps: DraftShadowMaps }> => {
    const admin = createAdminClient();

    const [{ data: playersData }, { data: rankings }, { data: refData }, { data: archives }, { data: seasonClubs }] =
      await Promise.all([
        admin.from('players').select(FULL_PLAYER_SELECT).eq('is_active', true),
        admin.from('player_rankings').select('*'),
        admin.from('rating_reference_stats').select('*').eq('season', refSeason),
        admin
          .from('season_player_stats_archive')
          .select('player_id, ppg, form_rating, overall_rank, position_ranks')
          .eq('season', season),
        admin.from('player_season_clubs').select('player_id').eq('season', season),
      ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const archiveMap = new Map<string, any>((archives ?? []).map((a: any) => [a.player_id, a]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rankMap = new Map<string, any>((rankings ?? []).map((r: any) => [r.player_id, r]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const seasonClubIds = new Set((seasonClubs ?? []).map((r: any) => r.player_id));
  const hasSeasonClubBaseline = seasonClubIds.size > 0;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const players = (playersData ?? []).map((p: any) => {
    const ranks = rankMap.get(p.id);
    const arch = archiveMap.get(p.id);
    return {
      ...p,
      ppg: arch ? Number(arch.ppg) : p.ppg,
      form_rating: arch ? Number(arch.form_rating) : p.form_rating,
      overall_rank: arch ? arch.overall_rank : ranks?.overall_rank,
      position_ranks: arch ? arch.position_ranks : ranks?.position_ranks,
      isNewToPrem: hasSeasonClubBaseline && !seasonClubIds.has(p.id),
    };
  }) as Player[];

  const playerMap = new Map<string, Player>();
  for (const p of players) playerMap.set(p.id, p);

  const allStats: {
    player_id: string;
    match_rating: number | null;
    fantasy_points: number | null;
    stats: { minutes_played?: number } | null;
  }[] = [];
  let page = 0;
  const PAGE_SIZE = 1000;
  while (true) {
    const { data } = await admin
      .from('player_stats')
      .select('player_id, match_rating, fantasy_points, stats')
      .eq('season', season)
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

    if (!data || data.length === 0) break;
    allStats.push(...data);
    if (data.length < PAGE_SIZE) break;
    page++;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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

  function buildStatsAgg(minMins: number): Record<string, Record<string, ShadowPosStats>> {
    const shadowAgg = new Map<string, Map<string, { gp: number; pts: number; sumR: number; mins: number }>>();

    for (const r of allStats) {
      const minutes = Number(r.stats?.minutes_played ?? 0);
      if (minutes <= 0) continue;
      if (minutes < minMins) continue;

      const p = playerMap.get(r.player_id);
      if (!p) continue;

      let playerMapEntry = shadowAgg.get(r.player_id);
      if (!playerMapEntry) {
        playerMapEntry = new Map();
        shadowAgg.set(r.player_id, playerMapEntry);
      }

      const primPos = p.primary_position ? String(p.primary_position).toUpperCase() : '';
      if (primPos) {
        let primAcc = playerMapEntry.get(primPos);
        if (!primAcc) {
          primAcc = { gp: 0, pts: 0, sumR: 0, mins: 0 };
          playerMapEntry.set(primPos, primAcc);
        }
        primAcc.gp += 1;
        primAcc.pts += Number(r.fantasy_points ?? 0);
        primAcc.sumR += Number(r.match_rating ?? 0);
        primAcc.mins += minutes;
      }

      const secPositions = (p.secondary_positions ?? []) as string[];
      for (const secPos of secPositions) {
        const posKey = String(secPos).toUpperCase();
        if (!posKey || posKey === primPos) continue;

        let secAcc = playerMapEntry.get(posKey);
        if (!secAcc) {
          secAcc = { gp: 0, pts: 0, sumR: 0, mins: 0 };
          playerMapEntry.set(posKey, secAcc);
        }

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const dynamicRating = calculateMatchRating(r.stats as any, posKey as any, refStats as any, primPos as any);
        secAcc.gp += 1;
        secAcc.pts += dynamicRating.fantasyPoints;
        secAcc.sumR += dynamicRating.rating;
        secAcc.mins += minutes;
      }
    }

    const result: Record<string, Record<string, ShadowPosStats>> = {};
    for (const [pid, playerMapEntry] of shadowAgg) {
      result[pid] = {};
      for (const [pos, ex] of playerMapEntry) {
        result[pid][pos] = {
          gp: ex.gp,
          total_points: ex.pts,
          avg_rating: ex.gp > 0 ? ex.sumR / ex.gp : 0,
          total_minutes: ex.mins,
        };
      }
    }
    return result;
  }

    return {
      players,
      shadowMaps: {
        all: buildStatsAgg(15),
        gt45: buildStatsAgg(45),
      },
    };
  },
  ['draft-pool-stats-by-season'],
  { revalidate: 60 },
);
