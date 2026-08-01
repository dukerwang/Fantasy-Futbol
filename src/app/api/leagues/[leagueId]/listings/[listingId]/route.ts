import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface Props {
  params: Promise<{ leagueId: string; listingId: string }>;
}

/**
 * PATCH — edit prices and offer gates while the listing is still quiet.
 *
 * "Quiet" means status 'pending'. Since migration 080 every listing carries an
 * auction anchor from the moment it is created, so 'pending' does NOT mean "no
 * auction" — it means "no manager has bid yet". The first real bid flips the row
 * to 'active' (in place_auction_bid_rpc) and locks editing, because by then the
 * price is a promise other managers have committed budget against.
 *
 * Outstanding offers do not block the edit — they are reported back so the UI
 * can warn. A seller raising their ask while someone is mid-negotiation is
 * rude, not incoherent; the buyer still has to confirm any deal.
 */
export async function PATCH(req: NextRequest, { params }: Props) {
  const { leagueId, listingId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  const { data: myTeam } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();
  if (!myTeam) return NextResponse.json({ error: 'No team in this league' }, { status: 403 });

  const { data: listing } = await admin
    .from('player_sale_listings')
    .select('id, seller_team_id, player_id, status, min_bid, ask_price, buy_now_price, open_to_trade, open_to_sale, open_to_loan')
    .eq('id', listingId)
    .eq('league_id', leagueId)
    .maybeSingle();

  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });
  if (listing.seller_team_id !== myTeam.id) {
    return NextResponse.json({ error: 'Only the seller can edit this listing' }, { status: 403 });
  }
  if (listing.status === 'active') {
    return NextResponse.json(
      { error: 'Bidding has started — prices are locked. Managers have committed budget against them.' },
      { status: 403 },
    );
  }
  if (listing.status !== 'pending') {
    return NextResponse.json(
      { error: `This listing cannot be edited because it is ${listing.status}.` },
      { status: 400 },
    );
  }

  const body = await req.json();
  const patch = body as {
    minBid?: number;
    buyNowPrice?: number | null;
    askPrice?: number | null;
    openToTrade?: boolean;
    openToSale?: boolean;
    openToLoan?: boolean;
  };

  // Absent key = leave alone. Explicit null = clear (buyNow/ask are nullable).
  const minBid = patch.minBid ?? listing.min_bid;
  const buyNowPrice = patch.buyNowPrice === undefined ? listing.buy_now_price : patch.buyNowPrice;
  const askPrice = patch.askPrice === undefined ? listing.ask_price : patch.askPrice;
  const gateTrade = patch.openToTrade ?? listing.open_to_trade;
  const gateSale = patch.openToSale ?? listing.open_to_sale;
  const gateLoan = patch.openToLoan ?? listing.open_to_loan;

  if (!Number.isInteger(minBid) || minBid < 0) {
    return NextResponse.json({ error: 'minBid must be a non-negative integer' }, { status: 400 });
  }
  // Stating no preference, and naming no asking price, are both legitimate
  // since 088 — the two constraints those checks mirrored are gone. What
  // survives is the ordering of whatever prices ARE given, below.
  if (buyNowPrice !== null && (!Number.isInteger(buyNowPrice) || buyNowPrice <= minBid)) {
    return NextResponse.json({ error: 'Buy Now price must be a whole number above the minimum bid.' }, { status: 400 });
  }
  if (askPrice !== null && askPrice !== undefined) {
    if (!Number.isInteger(askPrice) || askPrice < minBid) {
      return NextResponse.json(
        { error: `Asking price must be a whole number of at least €${minBid}m.` },
        { status: 400 },
      );
    }
    if (buyNowPrice !== null && askPrice >= buyNowPrice) {
      return NextResponse.json(
        { error: 'Asking price must be below the Buy Now price.' },
        { status: 400 },
      );
    }
  }

  // Same 80% pre-check as creation, and only when min_bid actually moves — the
  // 077 trigger deliberately early-returns on an unchanged min_bid so that
  // toggling a gate on an old listing is not rejected over a price the seller
  // never touched (market_value drifts continuously via the Transfermarkt sync).
  if (minBid !== listing.min_bid) {
    const { data: playerRow } = await admin
      .from('players')
      .select('name, market_value')
      .eq('id', listing.player_id)
      .single();

    // Quarantine: same as creation -- see listings/route.ts.
    if (playerRow && playerRow.market_value == null) {
      return NextResponse.json(
        {
          error: `${playerRow.name ?? 'This player'} hasn't been priced by Transfermarkt yet and can't be listed. Check back once a value is synced.`,
        },
        { status: 400 },
      );
    }

    const marketValue = Number(playerRow?.market_value ?? 0);
    if (marketValue > 0) {
      const floor = Math.floor(marketValue * 0.8);
      if (minBid < floor) {
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
  }

  const { data: updated, error: updateError } = await admin
    .from('player_sale_listings')
    .update({
      min_bid: minBid,
      buy_now_price: buyNowPrice,
      ask_price: askPrice ?? null,
      open_to_trade: gateTrade,
      open_to_sale: gateSale,
      open_to_loan: gateLoan,
      updated_at: new Date().toISOString(),
    })
    .eq('id', listingId)
    // Re-assert 'pending': a bid landing between the read above and this write
    // would otherwise let an edit slip through against a now-live auction.
    .eq('status', 'pending')
    .select()
    .single();

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  if (!updated) {
    return NextResponse.json(
      { error: 'A bid arrived while you were editing. Prices are now locked.' },
      { status: 409 },
    );
  }

  const { data: outstanding } = await admin
    .from('trade_proposals')
    .select('id, team_a_id, offered_faab, created_at')
    .eq('league_id', leagueId)
    .eq('sale_listing_id', listingId)
    .eq('status', 'pending');

  // Loan proposals hang off the player, not the listing — there is no
  // sale_listing_id on player_loans, because a loan can be arranged on any
  // player whether or not he is listed. Reported for the same reason as the
  // offers above: shutting the loan gate does not withdraw a proposal already
  // in flight, and the seller should see what they are walking away from.
  const { data: outstandingLoanRows } = await admin
    .from('player_loans')
    .select('id, lender_team_id, borrower_team_id, loan_fee, created_at')
    .eq('league_id', leagueId)
    .eq('player_id', listing.player_id)
    .eq('status', 'pending');

  return NextResponse.json({
    ok: true,
    listing: updated,
    outstandingOffers: outstanding ?? [],
    outstandingLoans: outstandingLoanRows ?? [],
  });
}

export async function DELETE(req: NextRequest, { params }: Props) {
  const { leagueId, listingId } = await params;

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

  // 3. Fetch the listing
  const { data: listing } = await admin
    .from('player_sale_listings')
    .select('*')
    .eq('id', listingId)
    .eq('league_id', leagueId)
    .maybeSingle();

  if (!listing) return NextResponse.json({ error: 'Listing not found' }, { status: 404 });

  // 4. Authorization: must be the seller
  if (listing.seller_team_id !== myTeam.id) {
    return NextResponse.json({ error: 'Only the seller can cancel this listing' }, { status: 403 });
  }

  // 5. Check listing status: can only cancel if 'pending' (pre-bid)
  if (listing.status === 'active') {
    return NextResponse.json(
      { error: 'Bidding has already started. This listing cannot be cancelled.' },
      { status: 403 }
    );
  }

  if (listing.status !== 'pending') {
    return NextResponse.json(
      { error: `This listing cannot be cancelled because it is ${listing.status}.` },
      { status: 400 }
    );
  }

  // 6. Execute cancellation
  const { error: updateError } = await admin
    .from('player_sale_listings')
    .update({
      status: 'cancelled',
      updated_at: new Date().toISOString(),
    })
    .eq('id', listingId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
