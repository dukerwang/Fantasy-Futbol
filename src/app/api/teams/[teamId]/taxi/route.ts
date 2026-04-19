import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';

interface Props {
    params: Promise<{ teamId: string }>;
}

function calculateAgeInYears(dobIso: string, referenceDate = new Date()): number {
    const dob = new Date(dobIso);
    let age = referenceDate.getFullYear() - dob.getFullYear();
    const monthDiff = referenceDate.getMonth() - dob.getMonth();
    if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dob.getDate())) {
        age--;
    }
    return age;
}

export async function POST(req: NextRequest, { params }: Props) {
    const { teamId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json();
    const { playerId, action } = body;

    if (!playerId || !action || (action !== 'move_to_taxi' && action !== 'activate')) {
        return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: 400 });
    }

    const admin = createAdminClient();

    // Verify ownership
    const { data: team } = await admin
        .from('teams')
        .select('id, user_id, league_id, faab_budget')
        .eq('id', teamId)
        .eq('user_id', user.id)
        .single();

    if (!team) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // Fetch league academy config
    const { data: league } = await admin
        .from('leagues')
        .select('roster_size, taxi_size, taxi_age_limit, season')
        .eq('id', team.league_id)
        .single();

    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 });

    const taxiSize: number = league.taxi_size ?? 3;
    const taxiAgeLimit: number = league.taxi_age_limit ?? 21;
    const maxActive: number = league.roster_size ?? 20;

    // Fetch the roster entry
    const { data: entry } = await admin
        .from('roster_entries')
        .select('id, status, player:players(id, name, date_of_birth)')
        .eq('team_id', teamId)
        .eq('player_id', playerId)
        .single();

    if (!entry) return NextResponse.json({ error: 'Player not on roster' }, { status: 400 });

    const player = entry.player as unknown as { id: string; name: string; date_of_birth: string | null };

    // ── MOVE TO TAXI ────────────────────────────────────────────────────────────

    if (action === 'move_to_taxi') {
        if (entry.status === 'taxi') {
            return NextResponse.json({ error: 'Player is already in the academy' }, { status: 400 });
        }
        if (entry.status === 'ir') {
            return NextResponse.json({ error: 'Player is on IR. Activate them first before moving to the academy.' }, { status: 400 });
        }

        // Age eligibility check
        if (!player.date_of_birth) {
            return NextResponse.json({ error: 'Player has no date of birth on record - cannot verify academy eligibility.' }, { status: 400 });
        }
        const age = calculateAgeInYears(player.date_of_birth, new Date());
        if (age > taxiAgeLimit) {
            return NextResponse.json(
                { error: `${player.name} is age ${age} and not U${taxiAgeLimit} eligible for academy placement.` },
                { status: 400 }
            );
        }

        // Taxi slot availability check
        const { data: currentTaxi, error: taxiCountErr } = await admin
            .from('roster_entries')
            .select('id')
            .eq('team_id', teamId)
            .eq('status', 'taxi');

        if (taxiCountErr) return NextResponse.json({ error: taxiCountErr.message }, { status: 500 });

        if ((currentTaxi?.length ?? 0) >= taxiSize) {
            return NextResponse.json(
                { error: `Academy is full (${taxiSize} slots). Promote or drop an academy player first.` },
                { status: 400 }
            );
        }

        const { error } = await admin
            .from('roster_entries')
            .update({ status: 'taxi' })
            .eq('id', entry.id);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }

    // ── ACTIVATE (promote taxi → bench) ─────────────────────────────────────────

    if (action === 'activate') {
        if (entry.status !== 'taxi') {
            return NextResponse.json({ error: 'Player is not currently in the academy' }, { status: 400 });
        }

        // Check active roster space (excludes IR and taxi)
        const { data: activeRoster, error: rosterErr } = await admin
            .from('roster_entries')
            .select('id')
            .eq('team_id', teamId)
            .not('status', 'in', '("ir","taxi")');

        if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 });

        if ((activeRoster?.length ?? 0) >= maxActive) {
            return NextResponse.json(
                { error: 'Active roster is full. Drop a player before promoting from the academy.' },
                { status: 400 }
            );
        }

        const { error } = await admin
            .from('roster_entries')
            .update({ status: 'bench' })
            .eq('id', entry.id);

        if (error) return NextResponse.json({ error: error.message }, { status: 500 });
        return NextResponse.json({ ok: true });
    }
}
