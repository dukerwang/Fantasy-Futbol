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

    let refundAmount = 0;
    let notes = `Dropped ${player.name} to free agency`;

    // Provide market value refund for transfer_out
    if (actionType === 'transfer_out') {
        refundAmount = player.market_value;
        notes = `Transferred ${player.name} out of PL, refunded £${refundAmount}m FAAB`;
    }

    // 1. Delete roster entry
    const { error: dropError } = await admin
        .from('roster_entries')
        .delete()
        .eq('id', entry.id);

    if (dropError) return NextResponse.json({ error: dropError.message }, { status: 500 });

    // 2. Refund FAAB if applicable
    if (refundAmount > 0) {
        await admin
            .from('teams')
            .update({ faab_budget: team.faab_budget + refundAmount })
            .eq('id', teamId);
    }

    // 3. Log transaction
    await admin.from('transactions').insert({
        league_id: team.league_id,
        team_id: teamId,
        player_id: playerId,
        type: actionType === 'transfer_out' ? 'transfer_out' : 'drop',
        compensation_amount: refundAmount,
        notes,
    });

    return NextResponse.json({ ok: true });
}
