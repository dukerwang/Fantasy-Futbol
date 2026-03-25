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
    const { playerId, onTradeBlock } = body;

    if (!playerId || typeof onTradeBlock !== 'boolean') {
        return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify ownership
    const { data: team } = await admin
        .from('teams')
        .select('id')
        .eq('id', teamId)
        .eq('user_id', user.id)
        .single();

    if (!team) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Update roster entry
    const { error } = await admin
        .from('roster_entries')
        .update({ on_trade_block: onTradeBlock })
        .eq('team_id', teamId)
        .eq('player_id', playerId);

    if (error) {
        return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
}
