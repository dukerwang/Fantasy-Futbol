import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface Props {
  params: Promise<{ leagueId: string; listingId: string }>;
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
