import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { redirect, notFound } from 'next/navigation';
import TransferMarketClient from './TransferMarketClient';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import type { Player } from '@/types';

export const dynamic = 'force-dynamic';

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

  // Validate league membership
  const { data: league } = await admin
    .from('leagues')
    .select('id, name, roster_size')
    .eq('id', leagueId)
    .single();
  if (!league) notFound();

  const { data: myTeam } = await admin
    .from('teams')
    .select('id, team_name, faab_budget')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();
  if (!myTeam) redirect('/dashboard');

  // All teams in this league
  const { data: allTeams } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId);
  const teamIds = (allTeams ?? []).map((t: { id: string }) => t.id);

  // Active auctions for this league — query waiver_claims (the actual table)
  const { data: rawClaims } = await admin
    .from('waiver_claims')
    .select('*, player:players!player_id(*), team:teams(id, team_name)')
    .eq('league_id', leagueId)
    .eq('status', 'pending')
    .eq('is_auction', true)
    .order('faab_bid', { ascending: false });

  // Group by player to build AuctionListing[] with per-auction bid history
  const auctionMap = new Map<string, any>();
  for (const claim of rawClaims ?? []) {
    const existing = auctionMap.get(claim.player_id);
    const bidEntry = {
      team_name: claim.team ? (claim.team as any).team_name : 'System',
      faab_bid: claim.faab_bid,
      created_at: claim.created_at,
    };
    if (!existing) {
      auctionMap.set(claim.player_id, {
        player: claim.player,
        expires_at: claim.expires_at,
        highest_bid: claim.faab_bid,
        highest_bidder_team_name: claim.team ? (claim.team as any).team_name : 'System',
        highest_bidder_team_id: claim.team_id,
        my_bid: claim.team_id && claim.team_id === myTeam.id ? claim.faab_bid : null,
        my_drop_player_id: claim.team_id && claim.team_id === myTeam.id ? claim.drop_player_id : null,
        bid_count: 1,
        bid_history: [bidEntry],
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

  // Fetch all active players and rankings separately for merging
  const [{ data: playersData }, { data: rankingsData }] = await Promise.all([
    admin.from('players').select(FULL_PLAYER_SELECT).eq('is_active', true).order('total_points', { ascending: false, nullsFirst: false }),
    admin.from('player_rankings').select('*')
  ]);

  const rankMap = new Map((rankingsData ?? []).map((r: any) => [r.player_id, r]));

  // Merge rankings into the master player list
  const allActivePlayersWithRanks: Player[] = (playersData ?? []).map((p: any) => {
    const ranks = rankMap.get(p.id);
    return {
      ...p,
      overall_rank: ranks?.overall_rank,
      position_ranks: ranks?.position_ranks
    } as Player;
  });

  // Filter for Free Agents (not rostered, not auctioned)
  const excludedIds = new Set([...rosteredPlayerIds, ...auctionedPlayerIds]);
  let freeAgents = allActivePlayersWithRanks.filter(p => !excludedIds.has(p.id));

  // Handle Search and Position filters
  if (q) {
    const queryLower = q.toLowerCase();
    freeAgents = freeAgents.filter(p => p.name.toLowerCase().includes(queryLower) || p.web_name?.toLowerCase().includes(queryLower));
  }
  if (pos) {
    freeAgents = freeAgents.filter(p => p.primary_position === pos || p.secondary_positions?.includes(pos as any));
  }

  // My roster for the drop dropdown
  const { data: myRosterEntries } = await (admin
    .from('roster_entries')
    .select(`player_id, player:players(${FULL_PLAYER_SELECT})`) as any)
    .eq('team_id', myTeam.id);

  const myRoster = (myRosterEntries ?? []).map((e: any) => {
    const p = e.player;
    const ranks = rankMap.get(p.id);
    return {
      ...p,
      overall_rank: ranks?.overall_rank,
      position_ranks: ranks?.position_ranks
    };
  });

  const rosterFull = myRoster.length >= (league.roster_size ?? 20);

  // Recent completed auction wins for the sidebar feed
  const { data: recentActivity } = await admin
    .from('transactions')
    .select(
      `id, type, faab_bid, processed_at,
       team:teams(id, team_name),
       player:players(id, web_name, name, primary_position, pl_team)`
    )
    .eq('league_id', leagueId)
    .in('type', ['waiver_claim', 'free_agent_pickup'])
    .order('processed_at', { ascending: false })
    .limit(8);

  return (
    <TransferMarketClient
      leagueId={leagueId}
      leagueName={league.name}
      initialAuctions={(auctions ?? []) as any[]}
      initialFreeAgents={(freeAgents.slice(0, 100) ?? []) as any[]}
      initialMyTeam={{ id: myTeam.id, faab_budget: myTeam.faab_budget, team_name: myTeam.team_name }}
      initialMyRoster={myRoster as any[]}
      initialRosterFull={rosterFull}
      initialQ={q ?? ''}
      initialPos={pos ?? ''}
      initialRecentActivity={(recentActivity ?? []) as any[]}
    />
  );
}
