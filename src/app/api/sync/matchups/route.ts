/**
 * POST /api/sync/matchups?gameweek=<n>&finished=<true/false>
 *
 * Calculates the current gameweek's matchups based on player_stats and starting XI.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';

export async function POST(req: NextRequest) {
    const secret = req.headers.get('x-cron-secret');
    if (!secret || !process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    const gameweek = parseInt(searchParams.get('gameweek') ?? '0', 10);
    const finished = searchParams.get('finished') === 'true';

    if (!gameweek || gameweek < 1) {
        return NextResponse.json({ error: 'gameweek required (positive integer)' }, { status: 400 });
    }

    const admin = createAdminClient();

    // 1. Fetch incomplete matchups for this MW
    const { data: matchups } = await admin
        .from('matchups')
        .select('*, team_a:teams!matchups_team_a_id_fkey(*), team_b:teams!matchups_team_b_id_fkey(*)')
        .eq('gameweek', gameweek)
        .neq('status', 'completed');

    if (!matchups || matchups.length === 0) {
        return NextResponse.json({ ok: true, message: 'No matchups to process' });
    }

    // Collect all players (starters + bench) across all matchups
    const playerIds = new Set<string>();
    for (const m of matchups) {
        m.lineup_a?.starters?.forEach((s: any) => playerIds.add(s.player_id));
        m.lineup_a?.bench?.forEach((b: any) => playerIds.add(b.player_id));

        m.lineup_b?.starters?.forEach((s: any) => playerIds.add(s.player_id));
        m.lineup_b?.bench?.forEach((b: any) => playerIds.add(b.player_id));
    }

    if (playerIds.size === 0) {
        return NextResponse.json({ ok: true, message: 'No line-ups submitted' });
    }

    // 2. Fetch player stats for this MW
    // We need minutes_played to determine if they get auto-subbed
    const { data: statsData } = await admin
        .from('player_stats')
        .select('player_id, fantasy_points, stats')
        .eq('gameweek', gameweek)
        .in('player_id', Array.from(playerIds));

    // Map of player_id -> { points, minutes }
    const playerRecord = new Map<string, { points: number; minutes: number }>();
    for (const row of statsData ?? []) {
        const current = playerRecord.get(row.player_id) ?? { points: 0, minutes: 0 };
        current.points += Number(row.fantasy_points);
        // Only update minutes if they actually played in this fixture, to prevent overriding a 90 min game with a 0 min game in a double GW
        const fixtureMins = (row.stats as any).minutes_played ?? 0;
        current.minutes = Math.max(current.minutes, fixtureMins);
        playerRecord.set(row.player_id, current);
    }

    // Fetch players with their positions for validation during auto-subs
    const { data: playersData } = await admin
        .from('players')
        .select('id, primary_position, secondary_positions')
        .in('id', Array.from(playerIds));

    const playerPositions = new Map<string, string[]>();
    for (const p of playersData ?? []) {
        playerPositions.set(p.id, [p.primary_position, ...(p.secondary_positions || [])]);
    }

    // Flex map for auto-subs
    const POSITION_FLEX_MAP: Record<string, string[]> = {
        GK: ['GK'],
        CB: ['CB'],
        LB: ['LB', 'RB', 'CB'],
        RB: ['RB', 'LB', 'CB'],
        DM: ['DM', 'CM'],
        CM: ['CM', 'DM', 'AM'],
        AM: ['AM', 'CM', 'LW', 'RW'],
        LW: ['LW', 'RW', 'AM', 'ST'],
        RW: ['RW', 'LW', 'AM', 'ST'],
        ST: ['ST', 'LW', 'RW'],
    };

    let updated = 0;

    // Helper function to resolve a single team's lineup
    function calculateTeamScore(lineup: any) {
        if (!lineup) return 0;

        let score = 0;
        const benchIds = (lineup.bench ?? []).map((b: any) => b.player_id);
        const starters = [...(lineup.starters ?? [])];

        // Track which bench players are used so they don't contribute to depth bonus
        const usedBenchIds = new Set<string>();

        // 1. Calculate Starters & Auto-Subs
        for (const starter of starters) {
            const record = playerRecord.get(starter.player_id);
            const minutes = record?.minutes ?? 0;

            if (minutes > 0) {
                // Starter played, gets full points
                score += record?.points ?? 0;
            } else {
                // Starter played 0 minutes. Try to find a sub.
                const slotAllowedPos = POSITION_FLEX_MAP[starter.slot as string] ?? [];

                let subFound = false;
                for (let i = 0; i < benchIds.length; i++) {
                    const benchId = benchIds[i];
                    if (usedBenchIds.has(benchId)) continue;

                    const benchRecord = playerRecord.get(benchId);
                    if ((benchRecord?.minutes ?? 0) === 0) continue; // Bench player also didn't play

                    const subPositions = playerPositions.get(benchId) ?? [];
                    const canPlaySlot = subPositions.some((pos) => slotAllowedPos.includes(pos));

                    if (canPlaySlot) {
                        // Sub them in!
                        score += benchRecord?.points ?? 0;
                        usedBenchIds.add(benchId);
                        subFound = true;
                        break;
                    }
                }

                // If no sub found, they just get 0 points.
            }
        }

        // 2. Add Bench depth contribution (20% of unused bench players who played)
        let benchBonus = 0;
        for (const benchId of benchIds) {
            if (!usedBenchIds.has(benchId)) {
                const record = playerRecord.get(benchId);
                // Only give 20% of positive points (don't subtract 20% of a red card)
                if (record && record.points > 0) {
                    benchBonus += record.points * 0.20;
                }
            }
        }

        // Round to 1 decimal to prevent floating-point artifacts from 0.20 multiplier
        return Math.round((score + benchBonus) * 10) / 10;
    }

    // 3. Resolve Matchups (atomic: update + point increment in one transaction)
    for (const m of matchups) {
        const scoreA = calculateTeamScore(m.lineup_a);
        const scoreB = calculateTeamScore(m.lineup_b);

        const { data: resolved } = await admin.rpc('resolve_matchup', {
            p_matchup_id: m.id,
            p_score_a: scoreA,
            p_score_b: scoreB,
            p_team_a_id: m.team_a_id,
            p_team_b_id: m.team_b_id,
            p_finished: finished,
        });

        if (resolved) updated++;
    }

    return NextResponse.json({ ok: true, updated, gameweek, finished });
}
