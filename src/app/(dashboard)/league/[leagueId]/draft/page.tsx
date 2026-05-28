import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import DraftRoom from './DraftRoom';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import type { League, Team, Player, DraftPick } from '@/types';
import { getCurrentFplSeason, getLatestReferenceStatsSeason } from '@/lib/season/currentSeason';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '@/lib/scoring/matchRating';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export default async function DraftPage({ params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('*')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();

  // Enforce membership
  const { data: membership } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!membership && league.commissioner_id !== user.id) redirect('/dashboard');

  // Redirect if not yet drafting (and not complete — completed draft can still be viewed)
  if (league.status === 'setup') redirect(`/league/${leagueId}`);

  // Fetch teams with draft_order
  const { data: teamsData } = await admin
    .from('teams')
    .select('id, league_id, user_id, team_name, faab_budget, total_points, draft_order, created_at, updated_at')
    .eq('league_id', leagueId)
    .order('draft_order', { ascending: true });

  const teams = (teamsData ?? []) as Team[];

  // Fetch all picks with player + team info
  const { data: picksData } = await admin
    .from('draft_picks')
    .select('*, player:players(*), team:teams(id, team_name, user_id, draft_order)')
    .eq('league_id', leagueId)
    .order('pick', { ascending: true });

  const picks = (picksData ?? []) as DraftPick[];

  const season = (league as any).current_season ?? await getCurrentFplSeason();
  const refSeason = await getLatestReferenceStatsSeason(admin);

  // Fetch all active players for the picker (using centralized FULL_PLAYER_SELECT for consistency)
  const [{ data: playersData }, { data: rankings }, { data: refData }] = await Promise.all([
    admin.from('players').select(FULL_PLAYER_SELECT).eq('is_active', true),
    admin.from('player_rankings').select('*'),
    admin.from('rating_reference_stats').select('*').eq('season', refSeason)
  ]);

  const rankMap = new Map((rankings ?? []).map((r: any) => [r.player_id, r]));

  const players = (playersData ?? []).map((p: any) => {
    const ranks = rankMap.get(p.id);
    return {
      ...p,
      overall_rank: ranks?.overall_rank,
      position_ranks: ranks?.position_ranks
    };
  }) as Player[];

  const playerMap = new Map<string, any>();
  for (const p of players) {
    playerMap.set(p.id, p);
  }

  // Fetch all stats from player_stats globally (paginated)
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

  // Determine the current user's team in this league
  const myTeam = teams.find((t) => t.user_id === user.id) ?? null;

  return (
    <DraftRoom
      leagueId={leagueId}
      league={league as League}
      teams={teams}
      initialPicks={picks}
      allPlayers={players}
      myUserId={user.id}
      myTeam={myTeam}
      shadowMaps={shadowMaps}
    />
  );
}
