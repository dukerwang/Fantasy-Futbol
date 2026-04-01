import { createAdminClient } from '@/lib/supabase/admin';
import { calculateTeamScore, loadReferenceStats, type PlayerScoreRecord } from '@/lib/scoring/matchups';

export async function processMatchupsForGameweek(gameweek: number, finished: boolean) {
    const admin = createAdminClient();

    // 1. Fetch incomplete matchups for this GW
    const { data: matchups, error: fetchErr } = await admin
        .from('matchups')
        .select('*, team_a:teams!matchups_team_a_id_fkey(*), team_b:teams!matchups_team_b_id_fkey(*)')
        .eq('gameweek', gameweek)
        .neq('status', 'completed');

    if (fetchErr) {
        throw new Error(`Failed to fetch matchups: ${fetchErr.message}`);
    }

    if (!matchups || matchups.length === 0) {
        return { ok: true, message: `No incomplete matchups found for GW ${gameweek}`, gameweek };
    }

    // Fetch FPL fixture data to know which PL teams' matches are finished
    const finishedPlTeamIds = new Set<number>();
    try {
        const fixRes = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${gameweek}`, {
            next: { revalidate: 60 },
        });
        if (fixRes.ok) {
            const fixtures = await fixRes.json();
            for (const f of fixtures) {
                if (f.finished || f.finished_provisional) {
                    finishedPlTeamIds.add(f.team_h);
                    finishedPlTeamIds.add(f.team_a);
                }
            }
        }
    } catch { /* Fail open */ }

    // Collect all player IDs (starters + bench) across all matchups
    const playerIds = new Set<string>();
    for (const m of matchups) {
        m.lineup_a?.starters?.forEach((s: any) => playerIds.add(s.player_id));
        m.lineup_a?.bench?.forEach((b: any) => playerIds.add(b.player_id));
        m.lineup_b?.starters?.forEach((s: any) => playerIds.add(s.player_id));
        m.lineup_b?.bench?.forEach((b: any) => playerIds.add(b.player_id));
    }

    if (playerIds.size === 0) {
        return { ok: true, message: 'No line-ups submitted' };
    }

    // 2. Load reference stats for dynamic slot scoring
    const season = '2025-26';
    const refStats = await loadReferenceStats(admin, season);

    // 3. Fetch player stats for this GW
    const { data: statsData } = await admin
        .from('player_stats')
        .select('player_id, fantasy_points, stats')
        .eq('gameweek', gameweek)
        .in('player_id', Array.from(playerIds));

    // Map: player_id → { minutes, statsJson }
    const playerRecord = new Map<string, PlayerScoreRecord>();
    for (const row of statsData ?? []) {
        const fixtureMins: number = (row.stats as any)?.minutes_played ?? 0;
        const existing = playerRecord.get(row.player_id);

        if (!existing) {
            playerRecord.set(row.player_id, { minutes: fixtureMins, statsJson: row.stats });
        } else {
            // Double GW: accumulate minutes and key stats
            const merged = { ...existing.statsJson };
            merged.goals = (merged.goals ?? 0) + ((row.stats as any)?.goals ?? 0);
            merged.assists = (merged.assists ?? 0) + ((row.stats as any)?.assists ?? 0);
            merged.saves = (merged.saves ?? 0) + ((row.stats as any)?.saves ?? 0);
            merged.goals_conceded = (merged.goals_conceded ?? 0) + ((row.stats as any)?.goals_conceded ?? 0);
            merged.yellow_cards = (merged.yellow_cards ?? 0) + ((row.stats as any)?.yellow_cards ?? 0);
            merged.red_cards = (merged.red_cards ?? 0) + ((row.stats as any)?.red_cards ?? 0);
            merged.minutes_played = (merged.minutes_played ?? 0) + fixtureMins;
            playerRecord.set(row.player_id, { minutes: Math.max(existing.minutes, fixtureMins), statsJson: merged });
        }
    }

    // 4. Fetch player positions and PL team IDs
    const { data: playersData } = await admin
        .from('players')
        .select('id, primary_position, secondary_positions, pl_team_id')
        .in('id', Array.from(playerIds));

    const playerPositions = new Map<string, string[]>();
    const playerPlTeamId = new Map<string, number>();
    for (const p of playersData ?? []) {
        playerPositions.set(p.id, [p.primary_position, ...(p.secondary_positions || [])]);
        if (p.pl_team_id) playerPlTeamId.set(p.id, p.pl_team_id);
    }

    // 5. Resolve matchups
    const DRAW_THRESHOLD = 10;
    let updated = 0;
    const updateErrors: string[] = [];

    for (const m of matchups) {
        const scoreA = calculateTeamScore(m.lineup_a, playerRecord, playerPositions, playerPlTeamId, refStats as any, finished, finishedPlTeamIds);
        const scoreB = calculateTeamScore(m.lineup_b, playerRecord, playerPositions, playerPlTeamId, refStats as any, finished, finishedPlTeamIds);
        const gap = Math.abs(scoreA - scoreB);

        const newStatus = finished ? 'completed' : 'live';
        const winnerId = (finished && gap > DRAW_THRESHOLD)
            ? (scoreA > scoreB ? m.team_a_id : m.team_b_id)
            : null;

        const updatePayload: Record<string, any> = {
            score_a: scoreA,
            score_b: scoreB,
            status: newStatus,
        };
        if (finished) {
            updatePayload.winner_team_id = winnerId;
        }

        const { error } = await admin
            .from('matchups')
            .update(updatePayload)
            .eq('id', m.id);

        if (!error) {
            updated++;
        } else {
            updateErrors.push(`Matchup ${m.id} error: ${error.message}`);
        }
    }

    return { 
        ok: true, 
        updated, 
        gameweek, 
        finished, 
        errors: updateErrors.length > 0 ? updateErrors : undefined 
    };
}
