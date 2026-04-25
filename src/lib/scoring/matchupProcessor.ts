import { createAdminClient } from '@/lib/supabase/admin';
import { calculateTeamScore, loadReferenceStats, type PlayerScoreRecord } from '@/lib/scoring/matchups';
import { normalizeMatchupLineup } from '@/lib/lineups/normalizeMatchupLineup';

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

    // Collect all player IDs (starters + bench) across all matchups.
    // If a matchup has a null lineup, try to resolve it from the most recent past lineup for that team.
    const playerIds = new Set<string>();
    const resolvedLineups = new Map<string, { lineup_a?: any; lineup_b?: any }>();

    for (const m of matchups) {
        let lA = m.lineup_a;
        let lB = m.lineup_b;

        // Fallback for Team A
        if (!lA) {
            const { data: pastA } = await admin
                .from('matchups')
                .select('lineup_a, lineup_b, team_a_id')
                .or(`team_a_id.eq.${m.team_a_id},team_b_id.eq.${m.team_a_id}`)
                .lt('gameweek', gameweek)
                .order('gameweek', { ascending: false })
                .limit(5);
            const matchA = pastA?.find(pm => pm.team_a_id === m.team_a_id ? pm.lineup_a : pm.lineup_b);
            if (matchA) lA = (matchA.team_a_id === m.team_a_id ? matchA.lineup_a : matchA.lineup_b);
        }

        // Fallback for Team B
        if (!lB) {
            const { data: pastB } = await admin
                .from('matchups')
                .select('lineup_a, lineup_b, team_a_id')
                .or(`team_a_id.eq.${m.team_b_id},team_b_id.eq.${m.team_b_id}`)
                .lt('gameweek', gameweek)
                .order('gameweek', { ascending: false })
                .limit(5);
            const matchB = pastB?.find(pm => pm.team_a_id === m.team_b_id ? pm.lineup_a : pm.lineup_b);
            if (matchB) lB = (matchB.team_a_id === m.team_b_id ? matchB.lineup_a : matchB.lineup_b);
        }

        resolvedLineups.set(m.id, { lineup_a: lA, lineup_b: lB });

        lA?.starters?.forEach((s: any) => playerIds.add(s.player_id));
        lA?.bench?.forEach((b: any) => playerIds.add(b.player_id));
        lB?.starters?.forEach((s: any) => playerIds.add(s.player_id));
        lB?.bench?.forEach((b: any) => playerIds.add(b.player_id));
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

    // Fetch all current roster entries for these teams to sanitize fallbacks
    const teamIds = new Set<string>();
    for (const m of matchups) {
        teamIds.add(m.team_a_id);
        teamIds.add(m.team_b_id);
    }
    const { data: allRosterEntries } = await admin
        .from('roster_entries')
        .select('team_id, player_id, status')
        .in('team_id', Array.from(teamIds));
    
    const teamRosterMap = new Map<string, Set<string>>();
    const teamIrMap = new Map<string, Set<string>>();
    for (const e of allRosterEntries ?? []) {
        if (!teamRosterMap.has(e.team_id)) teamRosterMap.set(e.team_id, new Set());
        teamRosterMap.get(e.team_id)!.add(e.player_id);
        if (e.status === 'ir') {
            if (!teamIrMap.has(e.team_id)) teamIrMap.set(e.team_id, new Set());
            teamIrMap.get(e.team_id)!.add(e.player_id);
        }
    }

    // Map: player_id → { fixtures: { minutes, fantasyPoints }[] }
    const playerRecord = new Map<string, PlayerScoreRecord>();
    for (const row of statsData ?? []) {
        const fixtureMins: number = (row.stats as any)?.minutes_played ?? 0;
        const pts: number = Number(row.fantasy_points) || 0;
        const existing = playerRecord.get(row.player_id);

        const fixture = { minutes: fixtureMins, fantasyPoints: pts };
        if (!existing) {
            playerRecord.set(row.player_id, { fixtures: [fixture] });
        } else {
            existing.fixtures.push(fixture);
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

    const sanitize = (lineup: any, teamId: string) => {
        if (!lineup) return null;
        const roster = teamRosterMap.get(teamId);
        const ir = teamIrMap.get(teamId);
        if (!roster) return lineup;
        return {
            ...lineup,
            starters: (lineup.starters ?? []).map((s: any) => 
                (s && s.player_id && roster.has(s.player_id) && !ir?.has(s.player_id)) ? s : { ...s, player_id: null }
            ),
            bench: (lineup.bench ?? []).map((b: any) => 
                (b && b.player_id && roster.has(b.player_id) && !ir?.has(b.player_id)) ? b : { ...b, player_id: null }
            )
        };
    };

    for (const m of matchups) {
        const resolved = resolvedLineups.get(m.id);
        const lineupA = normalizeMatchupLineup(sanitize(resolved?.lineup_a, m.team_a_id));
        const lineupB = normalizeMatchupLineup(sanitize(resolved?.lineup_b, m.team_b_id));

        const scoreA = calculateTeamScore(lineupA, playerRecord, playerPositions, playerPlTeamId, refStats as any, finished, finishedPlTeamIds);
        const scoreB = calculateTeamScore(lineupB, playerRecord, playerPositions, playerPlTeamId, refStats as any, finished, finishedPlTeamIds);
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
        // If we inferred a corrected formation label, persist it so downstream UI stops lying.
        if (lineupA && lineupA !== m.lineup_a) updatePayload.lineup_a = lineupA;
        if (lineupB && lineupB !== m.lineup_b) updatePayload.lineup_b = lineupB;
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
