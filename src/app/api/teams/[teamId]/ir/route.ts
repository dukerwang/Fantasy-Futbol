import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPlayerDisplayName } from '@/lib/players/displayName';

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
        .select(`id, status, player:players(id, name, fpl_status, pl_team_id, web_name)`)
        .eq('team_id', teamId)
        .eq('player_id', playerId)
        .single();

    if (!entry) return NextResponse.json({ error: 'Player not on roster' }, { status: 400 });

    const player = entry.player as unknown as { id: string; name: string; fpl_status: string | null; pl_team_id: number | null; web_name: string | null };
    const fplStatus = player?.fpl_status;

    // Kickoff lock against the *scoring* week, not the squad-editor week.
    // Final sanitize strips IR from the saved XI, so an IR move after a player
    // has played would zero his points when the matchup locks in.
    if (player?.pl_team_id) {
        const { data: matchup } = await admin
            .from('matchups')
            .select('gameweek')
            .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
            .in('status', ['scheduled', 'live'])
            .order('gameweek', { ascending: true })
            .limit(1)
            .maybeSingle();

        if (matchup) {
            const { getLockedPlTeamIds } = await import('@/lib/fixtures/lockout');
            const lockedTeamIds = await getLockedPlTeamIds(admin, matchup.gameweek);
            if (lockedTeamIds.has(player.pl_team_id)) {
                return NextResponse.json(
                    { error: `Cannot change IR status for ${getPlayerDisplayName(player, 'full')} — their match has already kicked off.` },
                    { status: 400 },
                );
            }
        }
    }

    if (action === 'move_to_ir') {
        if (entry.status === 'loan_in' || entry.status === 'loan_out') {
            return NextResponse.json({ error: 'Cannot move loaned players to IR' }, { status: 400 });
        }

        if (entry.status === 'ir') {
            return NextResponse.json({ error: 'Player is already on IR' }, { status: 400 });
        }

        // Validation: must be strictly injured ('i') or unavailable/missing ('u' / 'n'). Doubtful ('d') doesn't typically qualify.
        // Actually, let's allow 'i', 'u', 'd', 's', 'n' to be flexible, but user specifically said 'i' or 'u'.
        // "Validate FPL status ('i' or 'u') before allowing IR placement"
        if (fplStatus !== 'i' && fplStatus !== 'u' && fplStatus !== 'd') {
            return NextResponse.json({ error: 'Player is not eligible for IR. They must be officially Injured (i) or Unavailable (u).' }, { status: 400 });
        }

        // IR slot availability check
        const { data: league } = await admin
            .from('leagues')
            .select('ir_size')
            .eq('id', team.league_id)
            .single();

        const irSize = league?.ir_size ?? 2;

        const { data: currentIr, error: irCountErr } = await admin
            .from('roster_entries')
            .select('id')
            .eq('team_id', teamId)
            .eq('status', 'ir');

        if (irCountErr) return NextResponse.json({ error: irCountErr.message }, { status: 500 });

        if ((currentIr?.length ?? 0) >= irSize) {
            return NextResponse.json(
                { error: `IR is full (${irSize} slots). Activate or drop an IR player first.` },
                { status: 400 },
            );
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

        // Validate roster space. IR and taxi players don't count against the active roster limit.
        const { data: roster } = await admin
            .from('roster_entries')
            .select('id')
            .eq('team_id', teamId)
            .not('status', 'in', '("ir","taxi","loan_in")');
            
        const { data: league } = await admin
            .from('leagues')
            .select('roster_size')
            .eq('id', team.league_id)
            .single();

        // Count active buybacks for this team
        const { count: buybackCount } = await admin
            .from('player_loans')
            .select('id', { count: 'exact', head: true })
            .eq('lender_team_id', teamId)
            .eq('status', 'active')
            .eq('slot_buyback_used', true);

        const maxActive = (league?.roster_size ?? 20) + (buybackCount ?? 0);

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
