import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { resolveLineupEditMatchup } from '@/lib/lineups/editTarget';
import { resolveCurrentGw } from '@/lib/season/currentGameweek';

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
    const { playerId, action, swapWithPlayerId } = body;

    if (!playerId || !action || (action !== 'move_to_taxi' && action !== 'activate' && action !== 'swap')) {
        return NextResponse.json({ error: 'Missing or invalid parameters' }, { status: 400 });
    }

    if (action === 'swap' && (!swapWithPlayerId || swapWithPlayerId === playerId)) {
        return NextResponse.json({ error: 'Missing or invalid swap player' }, { status: 400 });
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

    // ── SWAP ACTION ─────────────────────────────────────────────────────────────
    if (action === 'swap') {
        const { data: entries, error: entriesErr } = await admin
            .from('roster_entries')
            .select('id, player_id, status, player:players(id, name, date_of_birth, pl_team_id, web_name)')
            .eq('team_id', teamId)
            .in('player_id', [playerId, swapWithPlayerId]);

        if (entriesErr) return NextResponse.json({ error: entriesErr.message }, { status: 500 });
        if (!entries || entries.length !== 2) {
            return NextResponse.json({ error: 'Both players must be on your roster' }, { status: 400 });
        }

        const entry1 = entries.find((e) => e.player_id === playerId)!;
        const entry2 = entries.find((e) => e.player_id === swapWithPlayerId)!;

        let incomingEntry = entry1;
        let outgoingEntry = entry2;
        if (incomingEntry.status === 'taxi' && outgoingEntry.status !== 'taxi') {
            incomingEntry = entry2;
            outgoingEntry = entry1;
        }

        if (incomingEntry.status === 'taxi') {
            return NextResponse.json({ error: 'Both players are already in the academy' }, { status: 400 });
        }
        if (outgoingEntry.status !== 'taxi') {
            return NextResponse.json({ error: 'Target player is not currently in the academy' }, { status: 400 });
        }
        if (incomingEntry.status === 'ir') {
            return NextResponse.json({ error: 'Player is on IR. Activate them first before moving to the academy.' }, { status: 400 });
        }
        if (incomingEntry.status === 'loan_in' || incomingEntry.status === 'loan_out') {
            return NextResponse.json({ error: 'Cannot move loaned players to the academy' }, { status: 400 });
        }

        const incomingPlayer = incomingEntry.player as unknown as { id: string; name: string; date_of_birth: string | null; pl_team_id: number | null; web_name: string | null };
        const outgoingPlayer = outgoingEntry.player as unknown as { id: string; name: string; date_of_birth: string | null; pl_team_id: number | null; web_name: string | null };

        // Kickoff lock check for both players
        const currentFplGw = await resolveCurrentGw();
        const matchup = await resolveLineupEditMatchup(admin, teamId, currentFplGw);

        if (matchup) {
            const { getLockedPlTeamIds } = await import('@/lib/fixtures/lockout');
            const lockedTeamIds = await getLockedPlTeamIds(admin, matchup.gameweek);
            if (incomingPlayer.pl_team_id && lockedTeamIds.has(incomingPlayer.pl_team_id)) {
                return NextResponse.json(
                    { error: `Cannot change academy status for ${getPlayerDisplayName(incomingPlayer, 'full')} — their match has already kicked off.` },
                    { status: 400 },
                );
            }
            if (outgoingPlayer.pl_team_id && lockedTeamIds.has(outgoingPlayer.pl_team_id)) {
                return NextResponse.json(
                    { error: `Cannot change academy status for ${getPlayerDisplayName(outgoingPlayer, 'full')} — their match has already kicked off.` },
                    { status: 400 },
                );
            }
        }

        // Age eligibility check for incoming player
        if (!incomingPlayer.date_of_birth) {
            return NextResponse.json({ error: 'Player has no date of birth on record - cannot verify academy eligibility.' }, { status: 400 });
        }
        const age = calculateAgeInYears(incomingPlayer.date_of_birth, new Date());
        if (age > taxiAgeLimit) {
            return NextResponse.json(
                { error: `${incomingPlayer.name} is age ${age} and not U${taxiAgeLimit} eligible for academy placement.` },
                { status: 400 },
            );
        }

        // Grandfather rule check (excluding the outgoing player who is being removed from taxi)
        const { data: academyRows, error: academyErr } = await admin
            .from('roster_entries')
            .select('id, player_id, player:players(name, date_of_birth)')
            .eq('team_id', teamId)
            .eq('status', 'taxi');
        if (academyErr) return NextResponse.json({ error: academyErr.message }, { status: 500 });

        const agedOut = (academyRows as unknown as { id: string; player_id: string; player: { name: string; date_of_birth: string | null } | null }[] ?? []).find((r) => {
            if (r.id === outgoingEntry.id || r.player_id === outgoingEntry.player_id) return false;
            const dob = r.player?.date_of_birth;
            if (!dob) return false;
            return calculateAgeInYears(dob, new Date()) > taxiAgeLimit;
        });
        if (agedOut) {
            const agedOutName = agedOut.player?.name ?? 'an academy player';
            return NextResponse.json(
                { error: `Resolve aged-out academy player ${agedOutName} before adding another player to academy.` },
                { status: 400 },
            );
        }

        // Atomic swap updates
        const { error: errIncoming } = await admin
            .from('roster_entries')
            .update({ status: 'taxi' })
            .eq('id', incomingEntry.id);
        if (errIncoming) return NextResponse.json({ error: errIncoming.message }, { status: 500 });

        const { error: errOutgoing } = await admin
            .from('roster_entries')
            .update({ status: 'bench' })
            .eq('id', outgoingEntry.id);
        if (errOutgoing) return NextResponse.json({ error: errOutgoing.message }, { status: 500 });

        return NextResponse.json({ ok: true });
    }

    // Fetch the roster entry
    const { data: entry } = await admin
        .from('roster_entries')
        .select('id, status, player:players(id, name, date_of_birth, pl_team_id, web_name)')
        .eq('team_id', teamId)
        .eq('player_id', playerId)
        .single();

    if (!entry) return NextResponse.json({ error: 'Player not on roster' }, { status: 400 });

    const player = entry.player as unknown as { id: string; name: string; date_of_birth: string | null; pl_team_id: number | null; web_name: string | null };

    // Kickoff lock: same target week as the squad editor. After this GW's last
    // kickoff that is next week (unlocked). IR/drops stay on the scoring week.
    if (player.pl_team_id) {
        const currentFplGw = await resolveCurrentGw();
        const matchup = await resolveLineupEditMatchup(admin, teamId, currentFplGw);

        if (matchup) {
            const { getLockedPlTeamIds } = await import('@/lib/fixtures/lockout');
            const lockedTeamIds = await getLockedPlTeamIds(admin, matchup.gameweek);
            if (lockedTeamIds.has(player.pl_team_id)) {
                return NextResponse.json(
                    { error: `Cannot change academy status for ${getPlayerDisplayName(player, 'full')} — their match has already kicked off.` },
                    { status: 400 },
                );
            }
        }
    }

    // ── MOVE TO TAXI ────────────────────────────────────────────────────────────

    if (action === 'move_to_taxi') {
        if (entry.status === 'loan_in' || entry.status === 'loan_out') {
            return NextResponse.json({ error: 'Cannot move loaned players to the academy' }, { status: 400 });
        }
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

        // Grandfather rule: aged-out academy players may remain, but must be resolved
        // before adding new players into academy.
        const { data: academyRows, error: academyErr } = await admin
            .from('roster_entries')
            .select('player:players(name, date_of_birth)')
            .eq('team_id', teamId)
            .eq('status', 'taxi');
        if (academyErr) return NextResponse.json({ error: academyErr.message }, { status: 500 });

        const agedOut = (academyRows as unknown as { player: { name: string; date_of_birth: string | null } | null }[] ?? []).find((r) => {
            const dob = r.player?.date_of_birth;
            if (!dob) return false;
            return calculateAgeInYears(dob, new Date()) > taxiAgeLimit;
        });
        if (agedOut) {
            const agedOutName = agedOut.player?.name ?? 'an academy player';
            return NextResponse.json(
                { error: `Resolve aged-out academy player ${agedOutName} before adding another player to academy.` },
                { status: 400 },
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

        // Check active roster space (excludes IR, taxi, and loan_in)
        const { data: activeRoster, error: rosterErr } = await admin
            .from('roster_entries')
            .select('id')
            .eq('team_id', teamId)
            .not('status', 'in', '("ir","taxi","loan_in")');

        if (rosterErr) return NextResponse.json({ error: rosterErr.message }, { status: 500 });

        // Count active buybacks for this team
        const { count: buybackCount } = await admin
            .from('player_loans')
            .select('id', { count: 'exact', head: true })
            .eq('lender_team_id', teamId)
            .eq('status', 'active')
            .eq('slot_buyback_used', true);

        const effectiveMaxActive = maxActive + (buybackCount ?? 0);

        if ((activeRoster?.length ?? 0) >= effectiveMaxActive) {
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
