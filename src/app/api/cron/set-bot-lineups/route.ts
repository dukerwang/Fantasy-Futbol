import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';
import { generateValidLineup } from '@/lib/lineups/generateValidLineup';

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
        for (const ev of fplData.events as any[]) {
            // Target the active gameweek, or if between gameweeks, target the upcoming one.
            if (ev.is_current || ev.is_next) {
                currentGw = ev.id;
                break;
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
            const okA =
                m.lineup_a?.starters?.length >= 11 &&
                m.lineup_a?.bench?.length >= 4 &&
                !m.lineup_a.starters.some((s: any) => !s?.player_id) &&
                !m.lineup_a.bench.some((b: any) => !b?.player_id);
            const okB =
                m.lineup_b?.starters?.length >= 11 &&
                m.lineup_b?.bench?.length >= 4 &&
                !m.lineup_b.starters.some((s: any) => !s?.player_id) &&
                !m.lineup_b.bench.some((b: any) => !b?.player_id);
            if (okA) prevLineupByTeam.set(m.team_a_id, m.lineup_a);
            if (okB) prevLineupByTeam.set(m.team_b_id, m.lineup_b);
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

    if (updatedCount > 0) {
        try {
            await processMatchupsForGameweek(currentGw, false);
            debugLog.push(`Triggered matchup re-score sync for GW ${currentGw}`);
        } catch (err: any) {
            debugLog.push(`Failed to trigger re-score sync: ${err.message}`);
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
