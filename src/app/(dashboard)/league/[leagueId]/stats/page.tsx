import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import GlobalStatsTable from './GlobalStatsTable';
import type { Player } from '@/types';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '@/lib/scoring/matchRating';
import type { GranularPosition } from '@/types';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export interface StatPlayer extends Player {
  owner_team_id: string | null;
  owner_team_name: string | null;
}

export default async function StatsPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Validate league
  const { data: league } = await admin
    .from('leagues')
    .select('id, name, current_season')
    .eq('id', leagueId)
    .single();
  if (!league) notFound();

  const season = (league as any).current_season ?? await getCurrentFplSeason();

  // All teams in this league
  const { data: allTeams } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId);
  const teamIds = (allTeams ?? []).map((t: { id: string }) => t.id);

  // Fetch all active players and rankings separately
  const [{ data: playersData }, { data: rankings }, { data: refData }] = await Promise.all([
    admin.from('players').select(FULL_PLAYER_SELECT).eq('is_active', true).order('total_points', { ascending: false, nullsFirst: false }) as any,
    admin.from('player_rankings').select('*'),
    admin.from('rating_reference_stats').select('*').eq('season', '2025/26'),
  ]);

  const rankMap = new Map((rankings ?? []).map((r: any) => [r.player_id, r]));
  const players = (playersData ?? []).map((p: any) => {
    const ranks = rankMap.get(p.id);
    return {
      ...p,
      overall_rank: ranks?.overall_rank,
      position_ranks: ranks?.position_ranks
    };
  });

  const playerMap = new Map<string, any>();
  for (const p of players) {
    playerMap.set(p.id, p);
  }

  // Roster entries for this league → owner map
  const ownerMap = new Map<string, { teamId: string; teamName: string }>();
  if (teamIds.length > 0) {
    const { data: rosterEntries } = await admin
      .from('roster_entries')
      .select('player_id, team:teams(id, team_name)')
      .in('team_id', teamIds);

    for (const entry of rosterEntries ?? []) {
      const team = entry.team as any;
      if (team) {
        ownerMap.set(entry.player_id, { teamId: team.id, teamName: team.team_name });
      }
    }
  }

  // Fetch all stats from player_stats (paginated)
  const allStats: { player_id: string; match_rating: number | null; fantasy_points: number | null; stats: { minutes_played?: number } | null }[] = [];
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

  // Load Reference Stats
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

  // Helper to build position stats aggregates
  function buildStatsAgg(minMins: number) {
    const shadowAgg = new Map<string, Map<string, { gp: number; pts: number; sumR: number; mins: number }>>();

    for (const r of allStats) {
      const minutes = Number(r.stats?.minutes_played ?? 0);
      if (minutes <= 0) continue;
      if (minutes < minMins) continue;

      const p = playerMap.get(r.player_id);
      if (!p) continue;

      let playerMapEntry = shadowAgg.get(r.player_id);
      if (!playerMapEntry) {
        playerMapEntry = new Map<string, { gp: number; pts: number; sumR: number; mins: number }>();
        shadowAgg.set(r.player_id, playerMapEntry);
      }

      // 1. Primary Position
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

      // 2. Secondary Positions
      const secPositions = (p.secondary_positions ?? []) as string[];
      for (const secPos of secPositions) {
        const posKey = String(secPos).toUpperCase();
        if (!posKey || posKey === primPos) continue;

        let secAcc = playerMapEntry.get(posKey);
        if (!secAcc) {
          secAcc = { gp: 0, pts: 0, sumR: 0, mins: 0 };
          playerMapEntry.set(posKey, secAcc);
        }

        // Dynamically calculate rating and points under this secondary position weights
        const dynamicRating = calculateMatchRating(r.stats as any, posKey as any, refStats as any, primPos as any);

        secAcc.gp += 1;
        secAcc.pts += dynamicRating.fantasyPoints;
        secAcc.sumR += dynamicRating.rating;
        secAcc.mins += minutes;
      }
    }

    const result: Record<string, Record<string, { gp: number; total_points: number; avg_rating: number; total_minutes: number }>> = {};
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

  const shadowMaps = {
    all: buildStatsAgg(0),
    gt45: buildStatsAgg(45),
  };

  // Merge owners
  const statPlayers: StatPlayer[] = (players ?? []).map((p: any) => {
    const owner = ownerMap.get(p.id) ?? null;
    return {
      ...p,
      owner_team_id: owner?.teamId ?? null,
      owner_team_name: owner?.teamName ?? null,
    };
  });

  return (
    <GlobalStatsTable
      leagueId={leagueId}
      leagueName={league.name}
      players={statPlayers}
      shadowMaps={shadowMaps}
    />
  );
}
