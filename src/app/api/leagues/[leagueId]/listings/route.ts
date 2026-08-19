import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';

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
      player:players(${FULL_PLAYER_SELECT})
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
    .select('id, team_name')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  // 3. Parse and validate body
  const body = await req.json();
  const { playerId, minBid, buyNowPrice, openToTrade, openToSale, openToLoan, askPrice } = body as {
    playerId: string;
    minBid?: number | null;
    buyNowPrice?: number | null;
    openToTrade?: boolean;
    openToSale?: boolean;
    openToLoan?: boolean;
    askPrice?: number | null;
  };

  if (!playerId) {
    return NextResponse.json({ error: 'playerId is required' }, { status: 400 });
  }

  // minBid is optional (114): absent means "no open auction" — a release
  // clause and/or an asking price are the only doors in. At least one of the
  // three prices has to be set, or the listing is inert (nothing to shape it
  // around, not even a stance to advertise). Mirrors the DB CHECK
  // (player_sale_listings_states_a_price) so the seller gets a sentence
  // instead of a raised exception.
  const hasMinBid = minBid !== undefined && minBid !== null;
  const hasBuyNow = buyNowPrice !== undefined && buyNowPrice !== null;
  const hasAsk = askPrice !== undefined && askPrice !== null;

  if (!hasMinBid && !hasBuyNow && !hasAsk) {
    return NextResponse.json(
      { error: 'Set at least one of a minimum bid, a release clause, or an asking price.' },
      { status: 400 },
    );
  }

  if (hasMinBid && (!Number.isInteger(minBid as number) || (minBid as number) < 0)) {
    return NextResponse.json({ error: 'minBid must be a non-negative integer' }, { status: 400 });
  }

  const gateTrade = !!openToTrade;
  const gateSale = !!openToSale;
  const gateLoan = !!openToLoan;

  // No "choose at least one" check any more. 088 dropped
  // player_sale_listings_gate_not_inert because stating no preference is a
  // stance in its own right — "make me an offer" — and the most permissive one
  // there is, now that the flags advertise rather than refuse.

  if (hasBuyNow) {
    // Without an auction floor there is nothing for the clause to sit above —
    // any positive clause is fine. With one, it must clear it (114 keeps the
    // DB's buy_now_gt_min tolerant of a NULL min_bid, so this mirrors it).
    if (!Number.isInteger(buyNowPrice as number) || (buyNowPrice as number) <= 0) {
      return NextResponse.json({ error: 'buyNowPrice must be a positive integer' }, { status: 400 });
    }
    if (hasMinBid && (buyNowPrice as number) <= (minBid as number)) {
      return NextResponse.json({ error: 'buyNowPrice must be an integer greater than minBid' }, { status: 400 });
    }
  }

  // An asking price is optional since 088 (player_sale_listings_ask_requires_price
  // was dropped): its absence means the seller has not named a number, not that
  // he is unavailable. When there IS one, it must still sit between the floor
  // and the clause — player_sale_listings_gate_order survives, and the checks
  // below mirror it so the seller gets a sentence, not a constraint violation.

  if (hasAsk) {
    if (!Number.isInteger(askPrice as number) || (hasMinBid && (askPrice as number) < (minBid as number))) {
      return NextResponse.json(
        {
          error: hasMinBid
            ? `Asking price must be a whole number of at least your minimum bid (€${minBid}m).`
            : 'Asking price must be a whole number.',
        },
        { status: 400 },
      );
    }
    if (hasBuyNow && (askPrice as number) >= (buyNowPrice as number)) {
      return NextResponse.json(
        { error: 'Asking price must be below the release clause — otherwise nobody would negotiate.' },
        { status: 400 },
      );
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
  let isCurrentGwFinished = false;
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
          if (ev.id > currentFplGw) {
            currentFplGw = ev.id;
            isCurrentGwFinished = !!ev.finished;
          }
        }
      }
    }
  } catch (err) {
    console.error('[listings] Failed to fetch current GW from FPL:', err);
  }

  const totalGws = league.total_gameweeks ?? 38;
  const lastAllowedGw = totalGws - 8;
  const isSeasonOver = currentFplGw >= totalGws && isCurrentGwFinished;
  const isLockedWeek = currentFplGw > lastAllowedGw && currentFplGw <= totalGws;

  if (isLockedWeek && !isSeasonOver) {
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

  // 8. Pre-check the 80% floor.
  //
  // The trigger from 077 is the real enforcement — it re-reads market_value
  // inside the transaction, so a Transfermarkt sync landing mid-request cannot
  // slip a lowball through. This check exists purely so the seller sees the
  // actual number instead of a raised exception.
  const { data: playerRow } = await admin
    .from('players')
    .select('name, market_value')
    .eq('id', playerId)
    .single();

  // Quarantine: unlike a player whose value is simply low, a null market_value
  // means Transfermarkt hasn't priced them yet -- almost always a brand-new
  // signing (see syncPlayers.ts). Listing one for sale before a real value
  // exists would let it be bought for whatever the seller asks, with no floor
  // to anchor against. Migration 100 enforces this at the trigger level too;
  // this is just the friendly pre-check.
  if (playerRow && playerRow.market_value == null) {
    return NextResponse.json(
      {
        error: `${playerRow.name ?? 'This player'} hasn't been priced by Transfermarkt yet and can't be listed. Check back once a value is synced.`,
      },
      { status: 400 },
    );
  }

  const marketValue = Number(playerRow?.market_value ?? 0);
  // The floor only means something when there's an auction to floor. A
  // release-clause-only or negotiation-only listing (no minBid) has nothing
  // for this check to apply to.
  if (hasMinBid && marketValue > 0) {
    const floor = Math.floor(marketValue * 0.8);
    if ((minBid as number) < floor) {
      return NextResponse.json(
        {
          error: `Minimum bid must be at least €${floor}m — 80% of ${playerRow?.name ?? 'this player'}'s €${marketValue}m market value.`,
          floor,
          marketValue,
        },
        { status: 400 },
      );
    }
  }

  // 9. Create the listing.
  //
  // No anchor insert here: the trigger added in 080 seeds the auction claim on
  // this INSERT, so every listing is a live auction from creation. Doing it in
  // the route as well would race with the trigger and double-seed.
  const { data: listing, error: insertError } = await admin
    .from('player_sale_listings')
    .insert({
      league_id: leagueId,
      seller_team_id: myTeam.id,
      player_id: playerId,
      min_bid: hasMinBid ? minBid : null,
      buy_now_price: buyNowPrice ?? null,
      ask_price: askPrice ?? null,
      open_to_trade: gateTrade,
      open_to_sale: gateSale,
      open_to_loan: gateLoan,
      status: 'pending',
    })
    .select()
    .single();

  if (insertError) {
    return NextResponse.json({ error: insertError.message }, { status: 500 });
  }

  // Tell the rest of the league a player just hit the market. In-app + push
  // only — this is routine transfer-window activity, same reasoning as the
  // bidding-open notice on the demand side (see /auctions/bid).
  try {
    const { data: otherTeams } = await admin
      .from('teams')
      .select('user_id')
      .eq('league_id', leagueId)
      .neq('id', myTeam.id);

    if (otherTeams && otherTeams.length > 0) {
      const priceBits: string[] = [];
      if (hasMinBid) priceBits.push(`min bid €${minBid}m`);
      if (hasBuyNow) priceBits.push(`release clause €${buyNowPrice}m`);
      if (hasAsk) priceBits.push(`asking €${askPrice}m`);
      const priceLine = priceBits.length > 0 ? ` (${priceBits.join(', ')})` : '';

      const { createNotification } = await import('@/lib/notifications/createNotification');
      await Promise.all(
        otherTeams.map((t) =>
          createNotification(admin, {
            leagueId,
            userId: t.user_id,
            title: 'Player Listed',
            content: `**${myTeam.team_name}** has listed **${playerRow?.name ?? 'a player'}** for sale${priceLine}.`,
            url: `/league/${leagueId}/transfers/listings`,
            tag: `listed-${listing.id}`,
          })
        )
      );
    }
  } catch (err) {
    console.error('[listings] Failed to send new-listing notifications:', err);
  }

  return NextResponse.json({ ok: true, listing }, { status: 201 });
}
