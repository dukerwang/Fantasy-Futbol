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

  // League settings (roster_size)
  const { data: league } = await admin
    .from('leagues')
    .select('roster_size')
    .eq('id', leagueId)
    .single();

  // All teams in the league (to determine which players are rostered)
  const { data: allTeams } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId);

  const teamIds = (allTeams ?? []).map((t) => t.id);

  // Pending auction claims for this league (highest bid first per player)
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

  // Group claims by player → build AuctionListing per player
  // Claims are already ordered by faab_bid desc, so the first encountered is the highest.
  const auctionMap = new Map<string, AuctionListing>();
  for (const claim of claims ?? []) {
    const existing = auctionMap.get(claim.player_id);
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
      });
    } else {
      existing.bid_count++;
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
    .select('player_id, player:players(id, name, primary_position, secondary_positions, pl_team)')
    .eq('team_id', myTeam.id);

  const myRoster = (myRosterEntries ?? []).map((e) => e.player as any);
  const rosterFull = myRoster.length >= (league?.roster_size ?? 20);

  // Free agents: active players not rostered and not in active auctions
  const excludedIds = [...new Set([...rosteredPlayerIds, ...auctionedPlayerIds])];

  let freeAgentQuery = admin
    .from('players')
    .select('id, name, web_name, primary_position, secondary_positions, pl_team, market_value, photo_url, projected_points')
    .eq('is_active', true)
    .order('market_value', { ascending: false })
    .limit(60);

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
  });
}
