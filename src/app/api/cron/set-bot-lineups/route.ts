import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FORMATION_SLOTS, POSITION_FLEX_MAP, GranularPosition, MatchupLineup, BenchSlot, Formation } from '@/types';

export const maxDuration = 60; // 60 seconds

export async function GET(req: NextRequest) {
    // 1. Authenticate cron
    const authHeader = req.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}` && process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();

    // 2. Fetch current gameweek from FPL
    let currentGw = 1;
    try {
        const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
        if (!fplRes.ok) throw new Error('Failed to fetch FPL data');
        const fplData = await fplRes.json();
        const now = new Date();
        for (const ev of fplData.events as any[]) {
            if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
                currentGw = Math.max(currentGw, ev.id);
            }
        }
    } catch (err: any) {
        return NextResponse.json({ error: 'Failed to find current FPL gameweek', details: err.message }, { status: 500 });
    }

    // 3. Find all "scheduled" matchups for this gameweek
    const { data: matchups, error: matchupsErr } = await admin
        .from('matchups')
        .select('id, team_a_id, team_b_id, lineup_a, lineup_b, status')
        .eq('gameweek', currentGw)
        .in('status', ['scheduled', 'live']);

    if (matchupsErr || !matchups) {
        return NextResponse.json({ error: 'Failed to fetch matchups' }, { status: 500 });
    }

    if (matchups.length === 0) {
        return NextResponse.json({ message: 'No scheduled matchups found for current gameweek', ok: true });
    }

    // 4. Find all "bot" teams
    const { data: botUsers } = await admin.from('users').select('id, full_name').ilike('full_name', 'Bot %');
    const botUserIds = new Set((botUsers || []).map((u: any) => u.id));

    const teamIdsInMatchups = new Set<string>();
    matchups.forEach(m => {
        teamIdsInMatchups.add(m.team_a_id);
        teamIdsInMatchups.add(m.team_b_id);
    });

    const { data: teamsData } = await admin.from('teams').select('id, user_id').in('id', Array.from(teamIdsInMatchups));
    const botTeamIds = new Set(
        (teamsData || []).filter((t: any) => botUserIds.has(t.user_id)).map((t: any) => t.id)
    );

    let updatedCount = 0;

    for (const matchup of matchups) {
        // Evaluate Team A — generate if missing or has fewer than 11 starters
        const lineupAIncomplete = !matchup.lineup_a || (matchup.lineup_a as any)?.starters?.length < 11;
        if (botTeamIds.has(matchup.team_a_id) && lineupAIncomplete) {
            const lineup = await generateValidLineup(admin, matchup.team_a_id);
            if (lineup) {
                await admin.from('matchups').update({ lineup_a: lineup }).eq('id', matchup.id);
                updatedCount++;
            }
        }
        // Evaluate Team B
        const lineupBIncomplete = !matchup.lineup_b || (matchup.lineup_b as any)?.starters?.length < 11;
        if (botTeamIds.has(matchup.team_b_id) && lineupBIncomplete) {
            const lineup = await generateValidLineup(admin, matchup.team_b_id);
            if (lineup) {
                await admin.from('matchups').update({ lineup_b: lineup }).eq('id', matchup.id);
                updatedCount++;
            }
        }
    }

    return NextResponse.json({ ok: true, updatedCount, gameweek: currentGw });
}

async function generateValidLineup(admin: any, teamId: string): Promise<MatchupLineup | null> {
    const { data: rosterData } = await admin
        .from('roster_entries')
        .select(`
            id, status, player_id,
            player:players(id, primary_position, secondary_positions, pl_team_id, is_active)
        `)
        .eq('team_id', teamId);
    
    if (!rosterData) return null;

    const availableEntries = rosterData.filter((e: any) => e.status !== 'ir' && e.player?.is_active);
    if (availableEntries.length === 0) return null;

    const allFormations: Formation[] = ['4-3-3', '4-4-2', '4-2-3-1', '4-1-4-1', '3-4-3', '4-2-1-3'];

    let bestLineup: MatchupLineup | null = null;

    for (const formation of allFormations) {
        const slots = FORMATION_SLOTS[formation];
        const starters: { player_id: string; slot: GranularPosition }[] = [];
        const usedIds = new Set<string>();
        let success = true;

        for (const slotPos of slots) {
            const allowed = POSITION_FLEX_MAP[slotPos];
            // find best player
            const candidate = availableEntries.find((e: any) => {
                if (usedIds.has(e.player.id)) return false;
                const positions = [e.player.primary_position, ...(e.player.secondary_positions || [])];
                return positions.some((p: any) => allowed.includes(p));
            });

            if (!candidate) {
                success = false;
                break;
            }

            starters.push({ player_id: candidate.player.id, slot: slotPos });
            usedIds.add(candidate.player.id);
        }

        if (success) {
            // Fill bench
            const benchPool = availableEntries.filter((e: any) => !usedIds.has(e.player.id));
            const bench: { player_id: string; slot: BenchSlot }[] = [];
            
            const benchSlots: BenchSlot[] = ['DEF', 'MID', 'ATT', 'FLEX'];
            
            for (const bSlot of benchSlots) {
               const candidate = benchPool.shift();
               if (candidate) {
                   bench.push({ player_id: candidate.player.id, slot: bSlot });
               }
            }

            bestLineup = { formation, starters, bench };
            break; // Stop after finding the first valid formation
        }
    }

    return bestLineup;
}
