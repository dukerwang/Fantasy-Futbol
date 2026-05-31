import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { AuctionListing, Player } from '@/types';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // Verify the caller has a team in this league
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, faab_budget, team_name')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // League settings
  const { data: league } = await admin
    .from('leagues')
    .select('roster_size, taxi_size, taxi_age_limit, previous_season')
    .eq('id', leagueId)
    .single();

  // All teams in the league (to determine which players are rostered)
  const { data: allTeams } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId);

  const teamIds = (allTeams ?? []).map((t) => t.id);

  // Compute bottom-half eligibility from previous season standings archive
  const previousSeason = league?.previous_season ?? '2025-26';
  const { data: standingsArchive } = await admin
    .from('season_standings_archive')
    .select('team_id, final_rank')
    .eq('league_id', leagueId)
    .eq('season', previousSeason);

  const numTeamsInArchive = standingsArchive?.length ?? 0;
  const bottomHalfThreshold = numTeamsInArchive > 0 ? Math.ceil(numTeamsInArchive / 2) : 0;
  const bottomHalfTeamIds = new Set(
    standingsArchive
      ?.filter((s) => s.final_rank > bottomHalfThreshold)
      .map((s) => s.team_id) ?? []
  );

  const isMyTeamEligible = bottomHalfTeamIds.size > 0 ? bottomHalfTeamIds.has(myTeam.id) : true;

  // Determine newly promoted Premier League clubs dynamically
  const { data: prevPlayers } = await admin
    .from('players')
    .select('pl_team')
    .eq('pl_season', previousSeason);

  const prevTeams = new Set(prevPlayers?.map((p) => p.pl_team).filter(Boolean) ?? []);

  const { data: currPlayers } = await admin
    .from('players')
    .select('pl_team')
    .eq('is_active', true);

  const promotedClubs = new Set<string>();
  if (prevTeams.size > 0) {
    for (const p of currPlayers ?? []) {
      if (p.pl_team && !prevTeams.has(p.pl_team)) {
        promotedClubs.add(p.pl_team);
      }
    }
  }

  // Pending auction claims for this league (highest bid first per player)
  const { data: claims } = await admin
    .from('waiver_claims')
    .select(`
      *,
      player:players!player_id(*),
      team:teams(id, team_name)
    `)
    .eq('league_id', leagueId)
    .eq('status', 'pending')
    .eq('is_auction', true)
    .order('faab_bid', { ascending: false });

  // Group claims by player → build AuctionListing per player
  // Claims are already ordered by faab_bid desc, so the first encountered is the highest.
  const auctionMap = new Map<string, AuctionListing>();
  for (const claim of claims ?? []) {
    const existing = auctionMap.get(claim.player_id);
    const bidEntry = {
      team_name: claim.team ? (claim.team as any).team_name : 'System',
      faab_bid: claim.faab_bid,
      created_at: claim.created_at,
    };

    const hasSystemClaim = (claims ?? []).some(
      (c) => c.player_id === claim.player_id && c.team_id === null
    );
    const playerClub = (claim.player as any)?.pl_team;
    const isPromotedExclusive = hasSystemClaim && playerClub && promotedClubs.has(playerClub);

    if (!existing) {
      auctionMap.set(claim.player_id, {
        player: claim.player as Player,
        expires_at: claim.expires_at,
        highest_bid: claim.faab_bid,
        highest_bidder_team_name: claim.team ? (claim.team as any).team_name : 'System',
        highest_bidder_team_id: claim.team_id,
        my_bid: claim.team_id && claim.team_id === myTeam.id ? claim.faab_bid : null,
        my_drop_player_id: claim.team_id && claim.team_id === myTeam.id ? claim.drop_player_id : null,
        bid_count: 1,
        bid_history: [bidEntry],
        is_promoted_exclusive: !!isPromotedExclusive,
        is_eligible: isMyTeamEligible,
      });
    } else {
      existing.bid_count++;
      existing.bid_history.push(bidEntry);
      if (claim.team_id && claim.team_id === myTeam.id) {
        existing.my_bid = claim.faab_bid;
        existing.my_drop_player_id = claim.drop_player_id;
      }
    }
  }

  // Sort active auctions by soonest-expiring first
  const auctions = Array.from(auctionMap.values()).sort(
    (a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime(),
  );

  const auctionedPlayerIds = Array.from(auctionMap.keys());

  // Rostered player IDs (across all teams in the league)
  let rosteredPlayerIds: string[] = [];
  if (teamIds.length > 0) {
    const { data: rostered } = await admin
      .from('roster_entries')
      .select('player_id')
      .in('team_id', teamIds);
    rosteredPlayerIds = (rostered ?? []).map((r) => r.player_id);
  }

  // My current roster (for the "drop player" selector in the bid modal)
  const { data: myRosterEntries } = await admin
    .from('roster_entries')
    .select('player_id, status, player:players(id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at)')
    .eq('team_id', myTeam.id);

  const myRoster = (myRosterEntries ?? []).map((e) => ({ ...e.player as any, status: e.status }));
  // Roster capacity excludes IR + academy(taxi)
  const activeRosterCount = myRoster.filter(r => r.status !== 'ir' && r.status !== 'taxi').length;
  const myTaxiCount = myRoster.filter(r => r.status === 'taxi').length;
  const rosterFull = activeRosterCount >= (league?.roster_size ?? 20);

  // Free agents: active players not rostered and not in active auctions
  const excludedIds = [...new Set([...rosteredPlayerIds, ...auctionedPlayerIds])];

  let freeAgentQuery = admin
    .from('players')
    .select('id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at')
    .eq('is_active', true)
    .order('total_points', { ascending: false, nullsFirst: false });

  if (excludedIds.length > 0) {
    freeAgentQuery = freeAgentQuery.not('id', 'in', `(${excludedIds.join(',')})`);
  }

  const { data: freeAgents } = await freeAgentQuery;

  return NextResponse.json({
    auctions,
    freeAgents: freeAgents ?? [],
    myTeam: {
      id: myTeam.id,
      faab_budget: myTeam.faab_budget,
      team_name: myTeam.team_name,
    },
    myRoster,
    rosterFull,
    academy: {
      current: myTaxiCount,
      max: league?.taxi_size ?? 3,
      age_limit: league?.taxi_age_limit ?? 21,
    },
    isMyTeamEligible,
    promotedClubs: Array.from(promotedClubs),
  });
}
