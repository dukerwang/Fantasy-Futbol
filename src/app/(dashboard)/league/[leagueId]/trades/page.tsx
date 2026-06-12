import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { notFound, redirect } from 'next/navigation';
import TradesClient from './TradesClient';

interface Props {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<Record<string, string>>;
}

export default async function TradesPage({ params, searchParams }: Props) {
  const { leagueId } = await params;
  const { tab: tabParam } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  const { data: league } = await admin
    .from('leagues')
    .select('id, name, roster_size, status, loan_slot_buyback_fee, loan_bonus_cap_default, max_loan_outs, max_loan_ins, total_gameweeks, roster_locked, current_season, previous_season')
    .eq('id', leagueId)
    .single();

  if (!league) notFound();



  // Fetch all initial data from the trades API logic (same as GET /api/leagues/[id]/trades)
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, team_name, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) redirect('/dashboard');

  const { data: trades } = await admin
    .from('trade_proposals')
    .select(`
      *,
      team_a:teams!trade_proposals_team_a_id_fkey(id, team_name),
      team_b:teams!trade_proposals_team_b_id_fkey(id, team_name)
    `)
    .eq('league_id', leagueId)
    .or(`team_a_id.eq.${myTeam.id},team_b_id.eq.${myTeam.id}`)
    .order('created_at', { ascending: false });

  const { data: allTeams } = await admin
    .from('teams')
    .select('id, team_name, faab_budget')
    .eq('league_id', leagueId)
    .neq('id', myTeam.id);

  // Fetch active listings for this league
  const { data: listings } = await admin
    .from('player_sale_listings')
    .select(`
      id, seller_team_id, player_id, min_bid, buy_now_price, status,
      auction_expires_at, created_at,
      seller_team:teams!seller_team_id(id, team_name),
      player:players(id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at)
    `)
    .eq('league_id', leagueId)
    .in('status', ['pending', 'active'])
    .order('created_at', { ascending: false });

  // Fetch current highest bid for each active listing
  const listingIds = (listings ?? []).filter(l => l.status === 'active').map(l => l.id);
  const highestBids: Record<string, number> = {};
  if (listingIds.length > 0) {
    const { data: claims } = await admin
      .from('waiver_claims')
      .select('sale_listing_id, faab_bid')
      .in('sale_listing_id', listingIds)
      .eq('status', 'pending')
      .eq('is_auction', true)
      .order('faab_bid', { ascending: false });

    for (const c of claims ?? []) {
      if (c.sale_listing_id && !(c.sale_listing_id in highestBids)) {
        highestBids[c.sale_listing_id] = c.faab_bid;
      }
    }
  }

  // Build a lookup map of listing by player id
  const playerListingsMap: Record<string, any> = {};
  for (const l of listings ?? []) {
    playerListingsMap[l.player_id] = l;
  }

  // Fetch rosters for all other teams (for propose UI)
  const allTeamIds = (allTeams ?? []).map((t) => t.id);
  const allRosters: Record<string, any[]> = {};
  let entries: any[] = [];
  if (allTeamIds.length > 0) {
    const { data: dbEntries } = await admin
      .from('roster_entries')
      .select('team_id, on_trade_block, player:players(id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at)')
      .in('team_id', allTeamIds);
    entries = dbEntries ?? [];
  }

  const { data: myRosterEntries } = await admin
    .from('roster_entries')
    .select('on_trade_block, player:players(id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at)')
    .eq('team_id', myTeam.id);

  // Compute recent_ppg (last 10 gameweeks) for all players on the rosters
  const playerIds = new Set<string>();
  for (const e of entries) {
    const p = e.player as any;
    if (p?.id) playerIds.add(p.id);
  }
  for (const e of myRosterEntries ?? []) {
    const p = e.player as any;
    if (p?.id) playerIds.add(p.id);
  }

  const currentSeason = league.current_season || '2025-26';
  const previousSeason = league.previous_season || '2024-25';

  // Build a lookup of player market values
  const playerMarketValueMap: Record<string, number> = {};
  for (const e of entries) {
    const p = e.player as any;
    if (p?.id) playerMarketValueMap[p.id] = Number(p.market_value) || 0;
  }
  for (const e of myRosterEntries ?? []) {
    const p = e.player as any;
    if (p?.id) playerMarketValueMap[p.id] = Number(p.market_value) || 0;
  }

  let recentPpgMap: Record<string, number> = {};
  if (playerIds.size > 0) {
    const { data: stats } = await admin
      .from('player_stats')
      .select('player_id, fantasy_points, gameweek, stats, season')
      .in('player_id', Array.from(playerIds))
      .in('season', [currentSeason, previousSeason])
      .order('season', { ascending: false })
      .order('gameweek', { ascending: false });

    const playerGroups: Record<string, {
      currentSeasonStats: { points: number; minutes: number }[];
      previousSeasonStats: { points: number; minutes: number }[];
    }> = {};

    for (const s of stats ?? []) {
      const rawStats = (s.stats as any) || {};
      const minutes = Number(rawStats.minutes_played ?? 0);
      
      // Exclude DNPs (minutes_played <= 0)
      if (minutes <= 0) continue;

      if (!playerGroups[s.player_id]) {
        playerGroups[s.player_id] = {
          currentSeasonStats: [],
          previousSeasonStats: []
        };
      }

      const points = Number(s.fantasy_points) || 0;
      if (s.season === currentSeason) {
        playerGroups[s.player_id].currentSeasonStats.push({ points, minutes });
      } else if (s.season === previousSeason) {
        playerGroups[s.player_id].previousSeasonStats.push({ points, minutes });
      }
    }

    const calculateEffectivePPG = (
      currStats: { points: number; minutes: number }[],
      prevStats: { points: number; minutes: number }[],
      marketValue: number
    ): number => {
      const N = currStats.length;
      let effectivePPG = 3.0;

      // 1. Mid-Season (N >= 10 appearances)
      if (N >= 10) {
        const seasonPPG = currStats.reduce((sum, m) => sum + m.points, 0) / N;
        const recentMatches = currStats.slice(0, 10);
        const recentPPG = recentMatches.reduce((sum, m) => sum + m.points, 0) / recentMatches.length;
        effectivePPG = 0.6 * recentPPG + 0.4 * seasonPPG;
      }
      // 2. Early Season (1 <= N < 10 appearances)
      else if (N >= 1) {
        const seasonPPG_this_season = currStats.reduce((sum, m) => sum + m.points, 0) / N;
        const hasHistoricalData = prevStats.length > 0;

        if (hasHistoricalData) {
          const M_last = prevStats.reduce((sum, m) => sum + m.minutes, 0);
          const PPG_last_season = prevStats.reduce((sum, m) => sum + m.points, 0) / prevStats.length;
          const reliability = Math.min(1.0, M_last / 1500);
          const adjustedPPG_last_season = (reliability * PPG_last_season) + ((1 - reliability) * 4.0);

          const weight_this = N / 10;
          const weight_last = 1 - weight_this;
          effectivePPG = (weight_this * seasonPPG_this_season) + (weight_last * adjustedPPG_last_season);
        } else {
          // Brand new player
          let proxyPPG = 3.0;
          if (marketValue >= 80) proxyPPG = 10.0;
          else if (marketValue >= 40) proxyPPG = 8.0;
          else if (marketValue >= 20) proxyPPG = 6.0;
          else if (marketValue >= 10) proxyPPG = 4.5;
          else proxyPPG = 3.0;

          const weight_actual = Math.min(1.0, N / 5);
          effectivePPG = (weight_actual * seasonPPG_this_season) + ((1 - weight_actual) * proxyPPG);
        }
      }
      // 3. Preseason / GW1 (N == 0 appearances)
      else {
        const hasHistoricalData = prevStats.length > 0;
        if (hasHistoricalData) {
          const M_last = prevStats.reduce((sum, m) => sum + m.minutes, 0);
          const PPG_last_season = prevStats.reduce((sum, m) => sum + m.points, 0) / prevStats.length;
          const reliability = Math.min(1.0, M_last / 1500);
          const adjustedPPG_last_season = (reliability * PPG_last_season) + ((1 - reliability) * 4.0);
          effectivePPG = adjustedPPG_last_season;
        } else {
          let proxyPPG = 3.0;
          if (marketValue >= 80) proxyPPG = 10.0;
          else if (marketValue >= 40) proxyPPG = 8.0;
          else if (marketValue >= 20) proxyPPG = 6.0;
          else if (marketValue >= 10) proxyPPG = 4.5;
          else proxyPPG = 3.0;
          effectivePPG = proxyPPG;
        }
      }

      return Math.max(3.0, effectivePPG);
    };

    for (const id of playerIds) {
      const group = playerGroups[id] || { currentSeasonStats: [], previousSeasonStats: [] };
      const mv = playerMarketValueMap[id] ?? 0;
      recentPpgMap[id] = calculateEffectivePPG(group.currentSeasonStats, group.previousSeasonStats, mv);
    }
  }

  // Populate allRosters with recent_ppg
  for (const e of entries) {
    if (!allRosters[e.team_id]) allRosters[e.team_id] = [];
    const p = e.player as any;
    if (p) {
      allRosters[e.team_id].push({
        ...p,
        recent_ppg: recentPpgMap[p.id] ?? Math.max(3.0, p.ppg ?? 3.0),
        on_trade_block: e.on_trade_block,
        listing: playerListingsMap[p.id] ?? null
      });
    }
  }

  const myRoster = (myRosterEntries ?? []).map((e) => {
    const p = e.player as any;
    if (!p) return null;
    return {
      ...p,
      recent_ppg: recentPpgMap[p.id] ?? Math.max(3.0, p.ppg ?? 3.0),
      on_trade_block: e.on_trade_block,
      listing: playerListingsMap[p.id] ?? null
    };
  }).filter(Boolean);

  // ── League Feed — all accepted trades across the whole league ──────────────
  const { data: leagueTrades } = await admin
    .from('trade_proposals')
    .select(`
      id, team_a_id, team_b_id,
      offered_players, requested_players, offered_faab, requested_faab,
      status, message, created_at, updated_at,
      team_a:teams!trade_proposals_team_a_id_fkey(id, team_name),
      team_b:teams!trade_proposals_team_b_id_fkey(id, team_name)
    `)
    .eq('league_id', leagueId)
    .eq('status', 'accepted')
    .order('updated_at', { ascending: false })
    .limit(20);

  // All teams including user's own (needed to display league-wide feed)
  const { data: allTeamsIncludingMine } = await admin
    .from('teams')
    .select('id, team_name, faab_budget')
    .eq('league_id', leagueId);

  // Build playerMap from all players in all trade proposals (own + league feed)
  const allPlayerIds = new Set<string>();
  for (const t of trades ?? []) {
    (t.offered_players ?? []).forEach((id: string) => allPlayerIds.add(id));
    (t.requested_players ?? []).forEach((id: string) => allPlayerIds.add(id));
  }
  // Also include players from league feed trades
  for (const t of leagueTrades ?? []) {
    (t.offered_players ?? []).forEach((id: string) => allPlayerIds.add(id));
    (t.requested_players ?? []).forEach((id: string) => allPlayerIds.add(id));
  }

  const playerMap: Record<string, any> = {};
  if (allPlayerIds.size > 0) {
    const { data: players } = await admin
      .from('players')
      .select('id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at')
      .in('id', Array.from(allPlayerIds));
    for (const p of players ?? []) {
      playerMap[p.id] = p;
    }
  }

  // Fetch all player rankings and map globally
  const { data: rankings } = await admin.from('player_rankings').select('*');
  const rankMap = new Map((rankings ?? []).map((r: any) => [r.player_id, r]));

  // Inject rank into myRoster
  for (const player of myRoster) {
    const r = rankMap.get(player.id);
    if (r) {
      player.overall_rank = r.overall_rank;
      player.position_ranks = r.position_ranks;
    }
  }

  // Inject rank into allRosters
  for (const teamId in allRosters) {
    for (const player of allRosters[teamId]) {
      const r = rankMap.get(player.id);
      if (r) {
        player.overall_rank = r.overall_rank;
        player.position_ranks = r.position_ranks;
      }
    }
  }

  // Inject rank into playerMap
  for (const pid in playerMap) {
    const r = rankMap.get(pid);
    if (r) {
      playerMap[pid].overall_rank = r.overall_rank;
      playerMap[pid].position_ranks = r.position_ranks;
    }
  }

  // Fetch loans for this league
  const { data: loans } = await admin
    .from('player_loans')
    .select(`
      *,
      lender_team:teams!lender_team_id(id, team_name, user_id),
      borrower_team:teams!borrower_team_id(id, team_name, user_id),
      player:players(id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at)
    `)
    .eq('league_id', leagueId)
    .order('created_at', { ascending: false });

  for (const l of loans ?? []) {
    if (l.player) {
      const r = rankMap.get(l.player.id);
      if (r) {
        l.player.overall_rank = r.overall_rank;
        l.player.position_ranks = r.position_ranks;
      }
    }
  }

  // Determine current FPL gameweek for the loan modal GW pickers
  let currentGameweek = 1;
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      next: { revalidate: 3600 },
    });
    if (fplRes.ok) {
      const fplData = await fplRes.json();
      const now = new Date();
      for (const ev of fplData.events as any[]) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
          currentGameweek = Math.max(currentGameweek, ev.id);
        }
      }
    }
  } catch {
    // Silently fall back to GW1
  }

  // Determine initial tab from searchParam
  const VALID_TABS = ['trades', 'league-feed', 'listings', 'loans'] as const;
  type ValidTab = typeof VALID_TABS[number];
  const initialTab: ValidTab = VALID_TABS.includes(tabParam as ValidTab) ? (tabParam as ValidTab) : 'trades';

  return (
    <TradesClient
      leagueId={leagueId}
      leagueName={league.name}
      myTeam={myTeam}
      myRoster={myRoster}
      allTeams={allTeams ?? []}
      allTeamsIncludingMine={allTeamsIncludingMine ?? []}
      allRosters={allRosters}
      initialTrades={trades ?? []}
      leagueTrades={(leagueTrades ?? []) as unknown as any[]}
      initialPlayerMap={playerMap}
      initialListings={listings ?? []}
      listingHighestBids={highestBids}
      initialLoans={loans ?? []}
      currentGameweek={currentGameweek}
      initialTab={initialTab}
      leagueSettings={{
        loan_slot_buyback_fee: league.loan_slot_buyback_fee ?? 25,
        loan_bonus_cap_default: league.loan_bonus_cap_default ?? 0,
        max_loan_outs: league.max_loan_outs ?? 1,
        max_loan_ins: league.max_loan_ins ?? 2,
        total_gameweeks: league.total_gameweeks ?? 38,
        roster_locked: league.roster_locked ?? false
      }}
    />
  );
}
