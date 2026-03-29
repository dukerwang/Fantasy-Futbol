import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { FORMATION_SLOTS, POSITION_FLEX_MAP, GranularPosition, MatchupLineup, BenchSlot, Formation } from '@/types';

export const maxDuration = 60; // 60 seconds

export async function GET(req: NextRequest) {
    // 1. Authenticate cron
    const authHeader = req.headers.get('authorization');
    const secret = authHeader?.replace('Bearer ', '') ?? req.headers.get('x-cron-secret');
    if (secret !== process.env.CRON_SECRET && process.env.NODE_ENV !== 'development') {
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

    // 3. Find matchups for this gameweek in ANY status (bot lineups should be set regardless)
    const { data: matchups, error: matchupsErr } = await admin
        .from('matchups')
        .select('id, team_a_id, team_b_id, lineup_a, lineup_b, status')
        .eq('gameweek', currentGw);

    if (matchupsErr || !matchups) {
        return NextResponse.json({ error: 'Failed to fetch matchups' }, { status: 500 });
    }

    if (matchups.length === 0) {
        return NextResponse.json({ message: `No matchups found for GW ${currentGw}`, ok: true, gameweek: currentGw });
    }

    // 4. Find all "bot" teams by team_name — covers "FC Bot 1", "Bot FC 2", etc.
    const { data: botTeamsData } = await admin
        .from('teams')
        .select('id, team_name')
        .ilike('team_name', '%Bot%');

    const botUsers = botTeamsData ?? [];  // For count reporting
    const botTeamIds = new Set((botTeamsData ?? []).map((t: any) => t.id));


    // CARRY-OVER LOGIC: Fetch previous gameweek lineups for these bots
    const prevGw = currentGw - 1;
    const { data: prevMatchups } = await admin
        .from('matchups')
        .select('team_a_id, team_b_id, lineup_a, lineup_b')
        .eq('gameweek', prevGw);

    const prevLineupByTeam = new Map<string, any>();
    if (prevMatchups) {
        for (const m of prevMatchups) {
            if (m.lineup_a) prevLineupByTeam.set(m.team_a_id, m.lineup_a);
            if (m.lineup_b) prevLineupByTeam.set(m.team_b_id, m.lineup_b);
        }
    }

    let updatedCount = 0;
    const debugLog: string[] = [];

    for (const matchup of matchups) {
        // Evaluate Team A — carry over if missing or incomplete
        const lineupAIncomplete = !matchup.lineup_a || (matchup.lineup_a as any)?.starters?.length < 11;
        if (botTeamIds.has(matchup.team_a_id) && lineupAIncomplete) {
            let lineup = prevLineupByTeam.get(matchup.team_a_id);
            if (!lineup) {
              lineup = await generateValidLineup(admin, matchup.team_a_id);
              debugLog.push(`Generated fresh lineup for team_a ${matchup.team_a_id}`);
            } else {
              debugLog.push(`Carried over lineup for team_a ${matchup.team_a_id} from GW${prevGw}`);
            }
            if (lineup) {
                await admin.from('matchups').update({ lineup_a: lineup }).eq('id', matchup.id);
                updatedCount++;
            } else {
              debugLog.push(`Failed to generate lineup for team_a ${matchup.team_a_id}`);
            }
        }
        // Evaluate Team B
        const lineupBIncomplete = !matchup.lineup_b || (matchup.lineup_b as any)?.starters?.length < 11;
        if (botTeamIds.has(matchup.team_b_id) && lineupBIncomplete) {
            let lineup = prevLineupByTeam.get(matchup.team_b_id);
            if (!lineup) {
              lineup = await generateValidLineup(admin, matchup.team_b_id);
              debugLog.push(`Generated fresh lineup for team_b ${matchup.team_b_id}`);
            } else {
              debugLog.push(`Carried over lineup for team_b ${matchup.team_b_id} from GW${prevGw}`);
            }
            if (lineup) {
                await admin.from('matchups').update({ lineup_b: lineup }).eq('id', matchup.id);
                updatedCount++;
            } else {
              debugLog.push(`Failed to generate lineup for team_b ${matchup.team_b_id}`);
            }
        }
    }

    return NextResponse.json({
        ok: true,
        updatedCount,
        gameweek: currentGw,
        matchupCount: matchups.length,
        botUserCount: botUsers?.length ?? 0,
        botTeamCount: botTeamIds.size,
        prevGwLineupCount: prevLineupByTeam.size,
        debug: debugLog,
    });
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

    // Include any player not on IR that has a valid position — bot accounts may not have is_active=true
    const availableEntries = rosterData.filter((e: any) => e.status !== 'ir' && e.player?.primary_position);
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
