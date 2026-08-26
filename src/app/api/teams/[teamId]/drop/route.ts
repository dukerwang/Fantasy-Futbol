import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { executeDrop } from '@/lib/roster/executeDrop';

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

    // Transfer-out compensation is only valid once the player has actually left
    // the PL (is_active = false, set by the sync job). Re-checked authoritatively
    // in executeDrop for the deferred/queued path — this is just a fast, clear
    // rejection for the direct request.
    if (actionType === 'transfer_out' && player.is_active) {
        return NextResponse.json(
            { error: `${player.name} is still active in the Premier League. Use Drop instead of Transfer Out.` },
            { status: 400 },
        );
    }

    const marketValue = Number(player.market_value || 0);

    // Severance fee: 20% of market value (rounded down), minimum €2m — charged on plain drops only
    const severanceFee = actionType === 'drop' ? Math.max(2, Math.floor(marketValue * 0.2)) : 0;

    if (severanceFee > 0 && team.faab_budget < severanceFee) {
        return NextResponse.json(
            { error: `Insufficient Club Balance to buy out this player's contract. Severance fee: €${severanceFee}m` },
            { status: 400 },
        );
    }

    // Check if there is a matchup actually in progress (status only flips to 'live'
    // once the matchup processor has real stats for the gameweek — see matchupProcessor.ts)
    // to defer the drop. A merely 'scheduled' future matchup must not defer it — the whole
    // season's matchups are inserted upfront as 'scheduled', so that status alone says
    // nothing about whether play has started.
    const { data: activeMatchup } = await admin
        .from('matchups')
        .select('id, gameweek, status')
        .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`)
        .eq('status', 'live')
        .order('gameweek', { ascending: true })
        .limit(1)
        .maybeSingle();

    if (activeMatchup) {
        // Queue the drop in pending_drops
        const { error: insertErr } = await admin
            .from('pending_drops')
            .insert({
                league_id: team.league_id,
                team_id: teamId,
                player_id: playerId,
                action_type: actionType,
            });

        if (insertErr) return NextResponse.json({ error: insertErr.message }, { status: 500 });

        try {
            const { createNotification } = await import('@/lib/notifications/createNotification');
            await createNotification(admin, {
                kind: 'club',
                leagueId: team.league_id,
                userId: user.id,
                title: 'Drop Queued',
                content: `Your request to drop **${player.name}** has been queued. They will remain on your roster and lineup until the end of Gameweek ${activeMatchup.gameweek}.`,
                url: `/league/${team.league_id}/team/roster`
            });
        } catch (err) {
            console.error('Failed to send drop queued notification:', err);
        }

        return NextResponse.json({ ok: true, deferred: true, message: `Drop queued until the end of Gameweek ${activeMatchup.gameweek}.` });
    }

    try {
        await executeDrop(admin, teamId, playerId, actionType);
        return NextResponse.json({ ok: true });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return NextResponse.json({ error: message }, { status: 500 });
    }
}
