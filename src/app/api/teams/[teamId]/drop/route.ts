import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface Props {
    params: Promise<{ teamId: string }>;
}

export async function POST(req: NextRequest, { params }: Props) {
    const { teamId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { playerId, actionType } = body;

    if (!playerId || !actionType) {
        return NextResponse.json({ error: 'Missing parameters' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify ownership
    const { data: team } = await admin
        .from('teams')
        .select('*')
        .eq('id', teamId)
        .eq('user_id', user.id)
        .single();

    if (!team) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Check roster lock (set during offseason reset)
    const { data: leagueData } = await admin
        .from('leagues')
        .select('roster_locked')
        .eq('id', team.league_id)
        .single();

    if (leagueData?.roster_locked) {
        return NextResponse.json(
            { error: 'Rosters are locked during the offseason. Drops are not allowed until the new season begins.' },
            { status: 403 },
        );
    }

    // Get roster entry to verify they actually own the player
    const { data: entry } = await admin
        .from('roster_entries')
        .select('id')
        .eq('team_id', teamId)
        .eq('player_id', playerId)
        .single();

    if (!entry) {
        return NextResponse.json({ error: 'Player not on roster' }, { status: 400 });
    }

    // Get player details
    const { data: player } = await admin
        .from('players')
        .select('id, market_value, name, is_active')
        .eq('id', playerId)
        .single();

    if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 });

    const marketValue = Number(player.market_value || 0);

    // Severance fee: 10% of market value (rounded down) — charged on plain drops only
    const severanceFee = actionType === 'drop' ? Math.floor(marketValue * 0.1) : 0;

    if (severanceFee > 0 && team.faab_budget < severanceFee) {
        return NextResponse.json(
            { error: `Insufficient FAAB to buy out this player's contract. Severance fee: £${severanceFee}m` },
            { status: 400 },
        );
    }

    let notes: string;
    if (actionType === 'transfer_out') {
        notes = `Transferred ${player.name} out of PL, refunded £${marketValue}m FAAB`;
    } else if (severanceFee > 0) {
        notes = `Dropped ${player.name} — paid £${severanceFee}m contract severance`;
    } else {
        notes = `Dropped ${player.name} to free agency`;
    }

    // 1. Delete roster entry
    const { error: dropError } = await admin
        .from('roster_entries')
        .delete()
        .eq('id', entry.id);

    if (dropError) return NextResponse.json({ error: dropError.message }, { status: 500 });

    // 2. Update FAAB (refund for transfer_out; deduct severance for plain drop)
    if (actionType === 'transfer_out') {
        await admin
            .from('teams')
            .update({ faab_budget: team.faab_budget + marketValue })
            .eq('id', teamId);
    } else if (severanceFee > 0) {
        await admin
            .from('teams')
            .update({ faab_budget: team.faab_budget - severanceFee })
            .eq('id', teamId);
    }

    // 3. Log transaction
    await admin.from('transactions').insert({
        league_id: team.league_id,
        team_id: teamId,
        player_id: playerId,
        type: actionType === 'transfer_out' ? 'transfer_out' : 'drop',
        compensation_amount: actionType === 'transfer_out' ? marketValue : severanceFee,
        notes,
    });

    // 4. For plain drops (not PL transfers), auto-start a 48-hour system auction
    //    so all managers get a fair waiver window rather than a first-click free-for-all.
    if (actionType !== 'transfer_out') {
        const auctionExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
        await admin.from('waiver_claims').insert({
            league_id: team.league_id,
            team_id: null,
            player_id: playerId,
            faab_bid: 0,
            priority: 999,
            status: 'pending',
            gameweek: 0,
            is_auction: true,
            expires_at: auctionExpiry,
        });
    }

    return NextResponse.json({ ok: true });
}
