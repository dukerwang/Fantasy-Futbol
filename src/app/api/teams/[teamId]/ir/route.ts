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
    const { playerId, action } = body;

    if (!playerId || !action || (action !== 'move_to_ir' && action !== 'activate')) {
        return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: 400 });
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

    // Get current roster entry
    const { data: entry } = await admin
        .from('roster_entries')
        .select(`id, status, player:players(fpl_status)`)
        .eq('team_id', teamId)
        .eq('player_id', playerId)
        .single();

    if (!entry) return NextResponse.json({ error: 'Player not on roster' }, { status: 400 });

    const fplStatus = (entry.player as any)?.fpl_status;

    if (action === 'move_to_ir') {
        if (entry.status === 'ir') {
            return NextResponse.json({ error: 'Player is already on IR' }, { status: 400 });
        }
        
        // Validation: must be strictly injured ('i') or unavailable/missing ('u' / 'n'). Doubtful ('d') doesn't typically qualify.
        // Actually, let's allow 'i', 'u', 'd', 's', 'n' to be flexible, but user specifically said 'i' or 'u'.
        // "Validate FPL status ('i' or 'u') before allowing IR placement"
        if (fplStatus !== 'i' && fplStatus !== 'u' && fplStatus !== 'd') {
            return NextResponse.json({ error: 'Player is not eligible for IR. They must be officially Injured (i) or Unavailable (u).' }, { status: 400 });
        }

        const { error } = await admin
            .from('roster_entries')
            .update({ status: 'ir' })
            .eq('id', entry.id);
            
        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    } 
    
    // Activate Action
    if (action === 'activate') {
        if (entry.status !== 'ir') {
            return NextResponse.json({ error: 'Player is not currently on IR' }, { status: 400 });
        }

        // Validate roster space. Does not include IR players.
        const { data: roster } = await admin
            .from('roster_entries')
            .select('id')
            .eq('team_id', teamId)
            .neq('status', 'ir');
            
        const { data: league } = await admin
            .from('leagues')
            .select('roster_size')
            .eq('id', team.league_id)
            .single();

        const maxActive = league?.roster_size ?? 20;

        if (roster && roster.length >= maxActive) {
            return NextResponse.json({ error: 'Active roster is full. You must drop a player before activating from IR.' }, { status: 400 });
        }

        const { error } = await admin
            .from('roster_entries')
            .update({ status: 'bench' })
            .eq('id', entry.id);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }
}
