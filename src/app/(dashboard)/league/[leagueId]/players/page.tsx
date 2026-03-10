import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import TransferMarketClient from './TransferMarketClient';
import type { AuctionListing, Player } from '@/types';

interface Props {
  params: Promise<{ leagueId: string }>;
  searchParams: Promise<{ q?: string; pos?: string }>;
}

export default async function TransferMarketPage({ params, searchParams }: Props) {
  const { leagueId } = await params;
  const { q, pos } = await searchParams;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  const admin = createAdminClient();

  // Validate league
  const { data: league } = await admin
    .from('leagues')
    .select('id, name, roster_size, faab_budget')
    .eq('id', leagueId)
    .single();
  if (!league) notFound();

  // Caller must have a team in this league
  const { data: myTeam } = await admin
    .from('teams')
    .select('id, faab_budget, team_name')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();
  if (!myTeam) redirect('/dashboard');

  // All teams in the league (needed to determine rostered players)
  const { data: allTeams } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId);
  const teamIds = (allTeams ?? []).map((t) => t.id);

  // Active auction claims (highest bid first)
  const { data: claims } = await admin
    .from('waiver_claims')
    .select(`
      *,
      player:players!waiver_claims_player_id_fkey(*),
      team:teams(id, team_name)
    `)
    .eq('league_id', leagueId)
    .eq('status', 'pending')
    .eq('is_auction', true)
    .order('faab_bid', { ascending: false });

  // Build one AuctionListing per player
  const auctionMap = new Map<string, AuctionListing>();
  for (const claim of claims ?? []) {
    const existing = auctionMap.get(claim.player_id);
    if (!existing) {
      auctionMap.set(claim.player_id, {
        player: claim.player as Player,
        expires_at: claim.expires_at,
        highest_bid: claim.faab_bid,
        highest_bidder_team_name: (claim.team as any).team_name,
        highest_bidder_team_id: claim.team_id,
        my_bid: claim.team_id === myTeam.id ? claim.faab_bid : null,
        my_drop_player_id: claim.team_id === myTeam.id ? claim.drop_player_id : null,
        bid_count: 1,
      });
    } else {
      existing.bid_count++;
      if (claim.team_id === myTeam.id) {
        existing.my_bid = claim.faab_bid;
        existing.my_drop_player_id = claim.drop_player_id;
      }
    }
  }

  const auctions = Array.from(auctionMap.values()).sort(
    (a, b) => new Date(a.expires_at).getTime() - new Date(b.expires_at).getTime(),
  );

  const auctionedPlayerIds = Array.from(auctionMap.keys());

  // Rostered player IDs (any team in this league)
  let rosteredPlayerIds: string[] = [];
  if (teamIds.length > 0) {
    const { data: rostered } = await admin
      .from('roster_entries')
      .select('player_id')
      .in('team_id', teamIds);
    rosteredPlayerIds = (rostered ?? []).map((r) => r.player_id);
  }

  // My roster (for the "drop player" dropdown in the bid modal)
  const { data: myRosterEntries } = await admin
    .from('roster_entries')
    .select('player_id, player:players(id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at)')
    .eq('team_id', myTeam.id);
  const myRoster = (myRosterEntries ?? []).map((e) => e.player as any);
  const rosterFull = myRoster.length >= (league.roster_size ?? 20);

  // Free agents: active, not rostered, not in active auctions
  const excludedIds = [...new Set([...rosteredPlayerIds, ...auctionedPlayerIds])];

  let freeAgentQuery = admin
    .from('players')
    .select('id, fpl_id, api_football_id, web_name, name, full_name, date_of_birth, nationality, pl_team, pl_team_id, primary_position, secondary_positions, market_value, market_value_updated_at, projected_points, photo_url, height_cm, fpl_status, fpl_news, total_points, form_rating, ppg, is_active, transfermarkt_id, created_at, updated_at')
    .eq('is_active', true)
    .order('market_value', { ascending: false })
    .limit(60);

  if (excludedIds.length > 0) {
    freeAgentQuery = freeAgentQuery.not('id', 'in', `(${excludedIds.join(',')})`);
  }

  if (q) {
    freeAgentQuery = freeAgentQuery.ilike('name', `%${q}%`);
  }
  if (pos) {
    freeAgentQuery = freeAgentQuery.or(`primary_position.eq.${pos},secondary_positions.cs.{${pos}}`);
  }

  const { data: freeAgents } = await freeAgentQuery;

  return (
    <TransferMarketClient
      leagueId={leagueId}
      leagueName={league.name}
      initialAuctions={auctions}
      initialFreeAgents={(freeAgents ?? []) as any[]}
      initialMyTeam={{ id: myTeam.id, faab_budget: myTeam.faab_budget, team_name: myTeam.team_name }}
      initialMyRoster={myRoster}
      initialRosterFull={rosterFull}
      initialQ={q ?? ''}
      initialPos={pos ?? ''}
    />
  );
}
