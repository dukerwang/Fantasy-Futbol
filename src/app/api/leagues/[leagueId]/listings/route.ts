import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface Props {
  params: Promise<{ leagueId: string }>;
}

export async function GET(req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  // Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

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

  return NextResponse.json({ listings: listings ?? [], highestBids });
}

export async function POST(req: NextRequest, { params }: Props) {
  const { leagueId } = await params;

  // 1. Auth check
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // 2. Caller must have a team in this league
  const { data: myTeam } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  // 3. Parse and validate body
  const body = await req.json();
  const { playerId, minBid, buyNowPrice } = body as {
    playerId: string;
    minBid: number;
    buyNowPrice?: number | null;
  };

  if (!playerId || minBid === undefined || minBid === null) {
    return NextResponse.json({ error: 'playerId and minBid are required' }, { status: 400 });
  }

  if (!Number.isInteger(minBid) || minBid < 0) {
    return NextResponse.json({ error: 'minBid must be a non-negative integer' }, { status: 400 });
  }

  if (buyNowPrice !== undefined && buyNowPrice !== null) {
    if (!Number.isInteger(buyNowPrice) || buyNowPrice <= minBid) {
      return NextResponse.json({ error: 'buyNowPrice must be an integer greater than minBid' }, { status: 400 });
    }
  }

  // 4. Fetch league settings & locks
  const { data: league } = await admin
    .from('leagues')
    .select('roster_locked, total_gameweeks')
    .eq('id', leagueId)
    .single();

  if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });

  if (league.roster_locked) {
    return NextResponse.json(
      { error: 'Rosters are locked. Listings are not allowed until the new season begins.' },
      { status: 403 }
    );
  }

  // 5. Fetch current gameweek from FPL to enforce season timing (blocked in final 8 GWs)
  let currentFplGw = 0;
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: { 'User-Agent': 'FantasyFutbol/1.0' },
      next: { revalidate: 3600 },
    });
    if (fplRes.ok) {
      const fplData = await fplRes.json();
      const now = new Date();
      for (const ev of fplData.events as any[]) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
          currentFplGw = Math.max(currentFplGw, ev.id);
        }
      }
    }
  } catch (err) {
    console.error('[listings] Failed to fetch current GW from FPL:', err);
  }

  const totalGws = league.total_gameweeks ?? 38;
  const lastAllowedGw = totalGws - 8;
  if (currentFplGw > lastAllowedGw) {
    return NextResponse.json(
      { error: `Player sales are locked in the final 8 gameweeks of the season (after GW${lastAllowedGw}).` },
      { status: 403 }
    );
  }

  // 6. Player ownership check & status constraint (cannot list loaned-out or loaned-in players)
  const { data: rosterEntry } = await admin
    .from('roster_entries')
    .select('id, status')
    .eq('team_id', myTeam.id)
    .eq('player_id', playerId)
    .maybeSingle();

  if (!rosterEntry) {
    return NextResponse.json({ error: 'Player is not on your roster' }, { status: 400 });
  }

  if (rosterEntry.status === 'loan_out') {
    return NextResponse.json({ error: 'Cannot list a player currently loaned out' }, { status: 400 });
  }

  if (rosterEntry.status === 'loan_in') {
    return NextResponse.json({ error: 'Cannot list a player you have loaned in' }, { status: 400 });
  }

  // 7. Check for existing active listing for this player in this league
  const { data: activeListing } = await admin
    .from('player_sale_listings')
    .select('id')
    .eq('league_id', leagueId)
    .eq('player_id', playerId)
    .in('status', ['pending', 'active'])
    .maybeSingle();

  if (activeListing) {
    return NextResponse.json(
      { error: 'An active sale listing already exists for this player' },
      { status: 409 }
    );
  }

  // 8. Create the listing
  const { data: listing, error: insertError } = await admin
    .from('player_sale_listings')
    .insert({
      league_id: leagueId,
      seller_team_id: myTeam.id,
      player_id: playerId,
      min_bid: minBid,
      buy_now_price: buyNowPrice ?? null,
      status: 'pending',
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, listing }, { status: 201 });
}
