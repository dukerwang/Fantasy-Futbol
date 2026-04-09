import { NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { insertMatchups } from '@/lib/schedule/insertMatchups';

export const maxDuration = 60;

export async function POST() {
    const admin = createAdminClient();

    // 1. Get real user
    const { data: realUsers, error: realUserErr } = await admin.auth.admin.listUsers();
    if (realUserErr || !realUsers || realUsers.users.length === 0) {
        return NextResponse.json({ error: 'No real users found to host the league' }, { status: 400 });
    }
    const hostUser = realUsers.users.find(u => u.email === 'dukerwang@gmail.com') || realUsers.users.find(u => !u.email?.startsWith('bot')) || realUsers.users[0];

    // 2. Ensure 9 bot users exist
    const botIds: string[] = [];
    for (let i = 1; i <= 9; i++) {
        const email = `bot${i}@test.com`;
        let bot = realUsers.users.find(u => u.email === email);
        if (!bot) {
            const { data: newBot, error: createErr } = await admin.auth.admin.createUser({
                email,
                password: 'password123',
                email_confirm: true,
                user_metadata: { full_name: `Bot ${i}` }
            });
            if (createErr) return NextResponse.json({ error: `Failed to create bot ${i}: ${createErr.message}` }, { status: 500 });
            bot = newBot.user;

            // Attempt insert into public.users in case trigger fails or doesn't exist
            await admin.from('users').upsert({ id: bot.id, full_name: `Bot ${i}` });
        }
        if (bot) botIds.push(bot.id);
    }

    // 3. Create a League
    const { data: league, error: leagueErr } = await admin.from('leagues').insert({
        name: `E2E 10-Man Test (${new Date().toLocaleTimeString()})`,
        commissioner_id: hostUser.id,
        status: 'drafting',
        roster_size: 20,
        max_teams: 10
    }).select().single();

    if (leagueErr) return NextResponse.json({ error: leagueErr.message }, { status: 500 });

    // 4. Create teams and members
    const allUsers = [hostUser.id, ...botIds];
    const teams = [];

    for (let i = 0; i < allUsers.length; i++) {
        const userId = allUsers[i];

        // Member
        await admin.from('league_members').insert({
            league_id: league.id,
            user: userId,
            role: i === 0 ? 'commissioner' : 'member'
        });

        // Team
        const { data: team, error: teamErr } = await admin.from('teams').insert({
            league_id: league.id,
            user_id: userId,
            team_name: i === 0 ? "Duke's Destroyers" : `Bot FC ${i}`,
            draft_order: i + 1
        }).select().single();

        if (teamErr) return NextResponse.json({ error: teamErr.message }, { status: 500 });
        teams.push(team);
    }

    // 5. Select top 500 players to have enough positional depth
    const { data: players } = await admin.from('players')
        .select('id, primary_position')
        .eq('is_active', true)
        .order('market_value', { ascending: false })
        .limit(500);

    if (!players || players.length < 200) {
        return NextResponse.json({ error: 'Not enough players in DB' }, { status: 500 });
    }

    // Strict granular quotas summing to 20 based on actual DB distribution
    const limits = {
        GK: 2,
        CB: 3, LB: 2, RB: 2,
        DM: 2, CM: 2, AM: 1, LM: 1, RM: 1,
        LW: 1, RW: 1, ST: 2
    };

    const teamCounts: Record<string, typeof limits> = {};
    for (const t of teams) {
        teamCounts[t.id] = {
            GK: 0, CB: 0, LB: 0, RB: 0, DM: 0, CM: 0, AM: 0, LM: 0, RM: 0, LW: 0, RW: 0, ST: 0
        };
    }

    // 6. Simulate Snake Draft
    const picksToInsert = [];
    const rostersToInsert = [];

    const numTeams = 10;

    // Copy players array so we can splice out drafted players
    const availablePlayers = [...players];

    for (let round = 1; round <= 20; round++) {
        for (let pickInRound = 1; pickInRound <= numTeams; pickInRound++) {
            const overallPick = (round - 1) * numTeams + pickInRound;

            // Snake order calculation
            let teamObj;
            if (round % 2 !== 0) {
                teamObj = teams.find(t => t.draft_order === pickInRound); // 1 to 10
            } else {
                teamObj = teams.find(t => t.draft_order === (numTeams - pickInRound + 1)); // 10 to 1
            }

            const currentCounts = teamCounts[teamObj.id];

            // Find the highest value player that fits an open quota slot
            let draftedPlayerIndex = -1;
            for (let i = 0; i < availablePlayers.length; i++) {
                const pos = availablePlayers[i].primary_position as keyof typeof limits;
                if (limits[pos] !== undefined && currentCounts[pos] < limits[pos]) {
                    draftedPlayerIndex = i;
                    currentCounts[pos]++;
                    break;
                }
            }

            if (draftedPlayerIndex === -1) {
                return NextResponse.json({ error: `Could not find a valid player for ${teamObj.team_name} in round ${round}` }, { status: 500 });
            }

            const pId = availablePlayers[draftedPlayerIndex].id;
            // Remove from available pool
            availablePlayers.splice(draftedPlayerIndex, 1);

            picksToInsert.push({
                league_id: league.id,
                team_id: teamObj.id,
                player_id: pId,
                round,
                pick: overallPick
            });

            rostersToInsert.push({
                team_id: teamObj.id,
                player_id: pId,
                primary_position: availablePlayers[draftedPlayerIndex].primary_position,
                pos: availablePlayers[draftedPlayerIndex].primary_position,
                status: 'bench', // will update below after all picks
                acquisition_type: 'draft'
            });
        }
    }

    // Auto-set starting 11 for each team using a 1GK-4DEF-3MID-3FWD shape
    const startingSlots = { GK: 1, CB: 2, LB: 1, RB: 1, DM: 1, CM: 1, AM: 1, LW: 1, RW: 1, ST: 1 };
    const teamRosters: Record<string, typeof rostersToInsert> = {};
    for (const r of rostersToInsert) {
        if (!teamRosters[r.team_id]) teamRosters[r.team_id] = [];
        teamRosters[r.team_id].push(r);
    }
    for (const teamId in teamRosters) {
        const used: Record<string, number> = {};
        for (const r of teamRosters[teamId]) {
            const pos = r.primary_position || r.pos;
            const cap = startingSlots[pos as keyof typeof startingSlots] ?? 0;
            used[pos] = used[pos] ?? 0;
            if (used[pos] < cap) {
                r.status = 'active';
                used[pos]++;
            }
        }
    }

    // Batch insert picks & rosters
    const { error: picksErr } = await admin.from('draft_picks').insert(picksToInsert);
    if (picksErr) return NextResponse.json({ error: picksErr.message }, { status: 500 });

    const { error: rostersErr } = await admin.from('roster_entries').insert(rostersToInsert);
    if (rostersErr) return NextResponse.json({ error: rostersErr.message }, { status: 500 });

    // 7. Initialize League calendar
    await admin.from('leagues').update({ status: 'active' }).eq('id', league.id);

    try {
        await insertMatchups(admin, league.id);
    } catch (scheduleErr) {
        console.warn("Matchups error (expected if PL season hasn't started):", scheduleErr);
    }

    return NextResponse.json({
        success: true,
        league_id: league.id,
        message: `E2E League Created! 10 teams, 150 players drafted.`
    });
}
