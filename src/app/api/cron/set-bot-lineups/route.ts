import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FORMATION_SLOTS, POSITION_FLEX_MAP, GranularPosition, MatchupLineup, BenchSlot, Formation } from '@/types';

export const maxDuration = 60;

export async function GET(req: NextRequest) {
    // 1. Authenticate — accept Vercel's Bearer header OR x-cron-secret
    const secret = req.headers.get('authorization')?.replace('Bearer ', '')
        ?? req.headers.get('x-cron-secret');
    if (secret !== process.env.CRON_SECRET && process.env.NODE_ENV !== 'development') {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const admin = createAdminClient();

    // 2. Get current gameweek from FPL
    let currentGw = 1;
    try {
        const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/');
        if (!fplRes.ok) throw new Error('FPL fetch failed');
        const fplData = await fplRes.json();
        const now = new Date();
        for (const ev of fplData.events as any[]) {
            if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
                currentGw = Math.max(currentGw, ev.id);
            }
        }
    } catch (err: any) {
        return NextResponse.json({ error: 'FPL fetch failed', details: err.message }, { status: 500 });
    }

    // 3. Get all matchups for current GW (any status)
    const { data: matchups, error: matchupsErr } = await admin
        .from('matchups')
        .select('id, team_a_id, team_b_id, lineup_a, lineup_b')
        .eq('gameweek', currentGw);

    if (matchupsErr || !matchups) {
        return NextResponse.json({ error: 'Failed to fetch matchups' }, { status: 500 });
    }

    if (matchups.length === 0) {
        return NextResponse.json({ ok: true, message: `No matchups for GW ${currentGw}`, gameweek: currentGw });
    }

    // 4. Find bot teams by team_name containing 'Bot' (e.g. 'FC Bot 1', 'Bot FC 2')
    const { data: botTeamsData } = await admin
        .from('teams')
        .select('id, team_name')
        .ilike('team_name', '%Bot%');

    const botTeamIds = new Set((botTeamsData ?? []).map((t: any) => t.id));

    // 5. Carry-over from previous GW
    const prevGw = currentGw - 1;
    const { data: prevMatchups } = await admin
        .from('matchups')
        .select('team_a_id, team_b_id, lineup_a, lineup_b')
        .eq('gameweek', prevGw);

    const prevLineupByTeam = new Map<string, any>();
    if (prevMatchups) {
        for (const m of prevMatchups) {
            if (m.lineup_a?.starters?.length >= 11) prevLineupByTeam.set(m.team_a_id, m.lineup_a);
            if (m.lineup_b?.starters?.length >= 11) prevLineupByTeam.set(m.team_b_id, m.lineup_b);
        }
    }

    let updatedCount = 0;
    const debugLog: string[] = [];

    for (const matchup of matchups) {
        const lineupAIncomplete = !matchup.lineup_a || (matchup.lineup_a as any)?.starters?.length < 11;
        if (botTeamIds.has(matchup.team_a_id) && lineupAIncomplete) {
            let lineup = prevLineupByTeam.get(matchup.team_a_id) ?? null;
            if (!lineup) {
                const result = await generateValidLineup(admin, matchup.team_a_id);
                lineup = result.lineup;
                debugLog.push(`team_a ${matchup.team_a_id}: ${result.debug}`);
            } else {
                debugLog.push(`team_a ${matchup.team_a_id}: carried over from GW${prevGw}`);
            }
            if (lineup) {
                await admin.from('matchups').update({ lineup_a: lineup }).eq('id', matchup.id);
                updatedCount++;
            }
        }

        const lineupBIncomplete = !matchup.lineup_b || (matchup.lineup_b as any)?.starters?.length < 11;
        if (botTeamIds.has(matchup.team_b_id) && lineupBIncomplete) {
            let lineup = prevLineupByTeam.get(matchup.team_b_id) ?? null;
            if (!lineup) {
                const result = await generateValidLineup(admin, matchup.team_b_id);
                lineup = result.lineup;
                debugLog.push(`team_b ${matchup.team_b_id}: ${result.debug}`);
            } else {
                debugLog.push(`team_b ${matchup.team_b_id}: carried over from GW${prevGw}`);
            }
            if (lineup) {
                await admin.from('matchups').update({ lineup_b: lineup }).eq('id', matchup.id);
                updatedCount++;
            }
        }
    }

    return NextResponse.json({
        ok: true,
        gameweek: currentGw,
        matchupCount: matchups.length,
        botTeamCount: botTeamIds.size,
        prevGwLineupCount: prevLineupByTeam.size,
        updatedCount,
        debug: debugLog.slice(0, 10), // first 10 for brevity
    });
}

async function generateValidLineup(admin: any, teamId: string): Promise<{ lineup: MatchupLineup | null; debug: string }> {
    const { data: rosterData, error } = await admin
        .from('roster_entries')
        .select(`
            id, status, player_id,
            player:players(id, primary_position, secondary_positions, pl_team_id, is_active)
        `)
        .eq('team_id', teamId);

    if (!rosterData) {
        return { lineup: null, debug: `roster query failed: ${error?.message}` };
    }

    if (rosterData.length === 0) {
        return { lineup: null, debug: `no roster_entries found for team` };
    }

    // Accept any player not on IR that has a position — don't require is_active for bot test teams
    const availableEntries = rosterData.filter((e: any) => e.status !== 'ir' && e.player?.primary_position);
    if (availableEntries.length === 0) {
        return { lineup: null, debug: `${rosterData.length} entries but 0 have primary_position (check player FK)` };
    }

    const allFormations: Formation[] = ['4-3-3', '4-4-2', '4-2-3-1', '4-1-4-1', '3-4-3', '4-2-1-3'];
    let bestLineup: MatchupLineup | null = null;

    for (const formation of allFormations) {
        const slots = FORMATION_SLOTS[formation];
        const starters: { player_id: string; slot: GranularPosition }[] = [];
        const usedIds = new Set<string>();
        let success = true;

        for (const slotPos of slots) {
            const allowed = POSITION_FLEX_MAP[slotPos];
            const candidate = availableEntries.find((e: any) => {
                if (usedIds.has(e.player.id)) return false;
                const positions = [e.player.primary_position, ...(e.player.secondary_positions || [])];
                return positions.some((p: any) => allowed.includes(p));
            });

            if (!candidate) { success = false; break; }
            starters.push({ player_id: candidate.player.id, slot: slotPos });
            usedIds.add(candidate.player.id);
        }

        if (success) {
            const benchPool = availableEntries.filter((e: any) => !usedIds.has(e.player.id));
            const bench: { player_id: string; slot: BenchSlot }[] = [];
            const benchSlots: BenchSlot[] = ['DEF', 'MID', 'ATT', 'FLEX'];
            for (const bSlot of benchSlots) {
                const c = benchPool.shift();
                if (c) bench.push({ player_id: c.player.id, slot: bSlot });
            }
            bestLineup = { formation, starters, bench };
            break;
        }
    }

    return {
        lineup: bestLineup,
        debug: bestLineup
            ? `generated ${bestLineup.formation} with ${bestLineup.starters.length} starters`
            : `${availableEntries.length} available players but no formation fit`,
    };
}
