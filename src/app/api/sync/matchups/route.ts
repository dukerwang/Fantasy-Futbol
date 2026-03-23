/**
 * POST /api/sync/matchups?gameweek=<n>&finished=<true/false>
 *
 * Calculates the current gameweek's matchups based on player_stats and starting XI.
 * Players earn points based on the specific slot they occupy in the lineup,
 * not their static DB primary_position.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '@/lib/scoring/engine';
import type { GranularPosition, ReferenceStats, RatingComponent } from '@/types';

export const maxDuration = 60; // 1 minute max for Vercel Hobby tier

type RefStatsMap = Record<string, ReferenceStats>;

/** Load per-position reference stats from Supabase, falling back to hardcoded defaults. */
async function loadReferenceStats(admin: ReturnType<typeof createAdminClient>, season: string): Promise<RefStatsMap> {
    const { data, error } = await admin
        .from('rating_reference_stats')
        .select('position_group, component, median, stddev')
        .eq('season', season);

    if (error || !data || data.length === 0) {
        return DEFAULT_REFERENCE_STATS as unknown as RefStatsMap;
    }

    // Start with defaults, then overlay DB rows
    const ref: RefStatsMap = JSON.parse(JSON.stringify(DEFAULT_REFERENCE_STATS));
    for (const row of data as { position_group: string; component: string; median: number; stddev: number }[]) {
        const pos = row.position_group;
        const comp = row.component as RatingComponent;
        if (ref[pos] && (ref[pos] as any)[comp]) {
            (ref[pos] as any)[comp] = { median: Number(row.median), stddev: Number(row.stddev) };
        }
    }
    return ref;
}


async function getCurrentGameweek(): Promise<number> {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
        next: { revalidate: 3600 }
    });
    const data = await res.json();
    const curr = data.events.find((e: any) => e.is_current);
    return curr ? curr.id : 0;
}

export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
    const secret = req.headers.get('x-cron-secret');
    if (!secret || !process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(req.url);
    let gameweek = parseInt(searchParams.get('gameweek') ?? '0', 10);
    if (!gameweek) {
        gameweek = await getCurrentGameweek();
    }
    const finished = searchParams.get('finished') === 'true';

    if (!gameweek || gameweek < 1) {
        return NextResponse.json({ error: 'gameweek required (positive integer)' }, { status: 400 });
    }

    const admin = createAdminClient();

    // 1. Fetch incomplete matchups for this GW
    const { data: matchups } = await admin
        .from('matchups')
        .select('*, team_a:teams!matchups_team_a_id_fkey(*), team_b:teams!matchups_team_b_id_fkey(*)')
        .eq('gameweek', gameweek)
        .neq('status', 'completed');

    if (!matchups || matchups.length === 0) {
        return NextResponse.json({ ok: true, message: 'No matchups to process' });
    }

    // Collect all player IDs (starters + bench) across all matchups
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

    // 2. Load reference stats for dynamic slot scoring
    const season = '2025-26';
    const refStats = await loadReferenceStats(admin, season);

    // 3. Fetch player stats for this GW (including raw stats JSON for re-scoring)
    const { data: statsData } = await admin
        .from('player_stats')
        .select('player_id, fantasy_points, stats')
        .eq('gameweek', gameweek)
        .in('player_id', Array.from(playerIds));

    // Map: player_id → { minutes, statsJson }
    // For double GW: merge multiple fixtures, keeping max minutes and summing stats
    const playerRecord = new Map<string, { minutes: number; statsJson: any }>();
    for (const row of statsData ?? []) {
        const fixtureMins: number = (row.stats as any)?.minutes_played ?? 0;
        const existing = playerRecord.get(row.player_id);

        if (!existing) {
            playerRecord.set(row.player_id, { minutes: fixtureMins, statsJson: row.stats });
        } else {
            // Double GW: keep the fixture with more minutes (primary); sum key stats across fixtures
            if (fixtureMins > existing.minutes) {
                // Merge: use the more-played fixture as base, accumulate goal stats
                const merged = { ...row.stats as any };
                merged.goals = (merged.goals ?? 0) + (existing.statsJson?.goals ?? 0);
                merged.assists = (merged.assists ?? 0) + (existing.statsJson?.assists ?? 0);
                merged.saves = (merged.saves ?? 0) + (existing.statsJson?.saves ?? 0);
                merged.goals_conceded = (merged.goals_conceded ?? 0) + (existing.statsJson?.goals_conceded ?? 0);
                merged.yellow_cards = (merged.yellow_cards ?? 0) + (existing.statsJson?.yellow_cards ?? 0);
                merged.red_cards = (merged.red_cards ?? 0) + (existing.statsJson?.red_cards ?? 0);
                merged.own_goals = (merged.own_goals ?? 0) + (existing.statsJson?.own_goals ?? 0);
                merged.penalties_missed = (merged.penalties_missed ?? 0) + (existing.statsJson?.penalties_missed ?? 0);
                merged.penalty_saves = (merged.penalty_saves ?? 0) + (existing.statsJson?.penalty_saves ?? 0);
                // Sum FPL ICT metrics
                merged.bps = (merged.bps ?? 0) + (existing.statsJson?.bps ?? 0);
                merged.influence = (merged.influence ?? 0) + (existing.statsJson?.influence ?? 0);
                merged.creativity = (merged.creativity ?? 0) + (existing.statsJson?.creativity ?? 0);
                merged.threat = (merged.threat ?? 0) + (existing.statsJson?.threat ?? 0);
                merged.expected_goals = (merged.expected_goals ?? 0) + (existing.statsJson?.expected_goals ?? 0);
                merged.expected_assists = (merged.expected_assists ?? 0) + (existing.statsJson?.expected_assists ?? 0);
                merged.fpl_tackles = (merged.fpl_tackles ?? 0) + (existing.statsJson?.fpl_tackles ?? 0);
                merged.fpl_cbi = (merged.fpl_cbi ?? 0) + (existing.statsJson?.fpl_cbi ?? 0);
                merged.fpl_recoveries = (merged.fpl_recoveries ?? 0) + (existing.statsJson?.fpl_recoveries ?? 0);
                merged.minutes_played = fixtureMins + (existing.statsJson?.minutes_played ?? 0);
                playerRecord.set(row.player_id, { minutes: fixtureMins, statsJson: merged });
            } else {
                // Accumulate into existing
                const merged = { ...existing.statsJson };
                merged.goals = (merged.goals ?? 0) + ((row.stats as any)?.goals ?? 0);
                merged.assists = (merged.assists ?? 0) + ((row.stats as any)?.assists ?? 0);
                merged.saves = (merged.saves ?? 0) + ((row.stats as any)?.saves ?? 0);
                merged.goals_conceded = (merged.goals_conceded ?? 0) + ((row.stats as any)?.goals_conceded ?? 0);
                merged.yellow_cards = (merged.yellow_cards ?? 0) + ((row.stats as any)?.yellow_cards ?? 0);
                merged.red_cards = (merged.red_cards ?? 0) + ((row.stats as any)?.red_cards ?? 0);
                merged.own_goals = (merged.own_goals ?? 0) + ((row.stats as any)?.own_goals ?? 0);
                merged.penalties_missed = (merged.penalties_missed ?? 0) + ((row.stats as any)?.penalties_missed ?? 0);
                merged.penalty_saves = (merged.penalty_saves ?? 0) + ((row.stats as any)?.penalty_saves ?? 0);
                merged.bps = (merged.bps ?? 0) + ((row.stats as any)?.bps ?? 0);
                merged.influence = (merged.influence ?? 0) + ((row.stats as any)?.influence ?? 0);
                merged.creativity = (merged.creativity ?? 0) + ((row.stats as any)?.creativity ?? 0);
                merged.threat = (merged.threat ?? 0) + ((row.stats as any)?.threat ?? 0);
                merged.expected_goals = (merged.expected_goals ?? 0) + ((row.stats as any)?.expected_goals ?? 0);
                merged.expected_assists = (merged.expected_assists ?? 0) + ((row.stats as any)?.expected_assists ?? 0);
                merged.fpl_tackles = (merged.fpl_tackles ?? 0) + ((row.stats as any)?.fpl_tackles ?? 0);
                merged.fpl_cbi = (merged.fpl_cbi ?? 0) + ((row.stats as any)?.fpl_cbi ?? 0);
                merged.fpl_recoveries = (merged.fpl_recoveries ?? 0) + ((row.stats as any)?.fpl_recoveries ?? 0);
                merged.minutes_played = (merged.minutes_played ?? 0) + fixtureMins;
                playerRecord.set(row.player_id, { minutes: existing.minutes, statsJson: merged });
            }
        }
    }

    // 4. Fetch player positions for auto-sub eligibility checks
    const { data: playersData } = await admin
        .from('players')
        .select('id, primary_position, secondary_positions')
        .in('id', Array.from(playerIds));

    const playerPositions = new Map<string, string[]>();
    for (const p of playersData ?? []) {
        playerPositions.set(p.id, [p.primary_position, ...(p.secondary_positions || [])]);
    }

    // Strict flex map: each slot only accepts its own position type
    const POSITION_FLEX_MAP: Record<string, string[]> = {
        GK: ['GK'], CB: ['CB'], LB: ['LB'], RB: ['RB'],
        DM: ['DM'], CM: ['CM'], LM: ['LM'], RM: ['RM'],
        AM: ['AM'], LW: ['LW'], RW: ['RW'], ST: ['ST'],
    };

    let updated = 0;

    /**
     * Score a single player in a specific lineup slot using the match rating engine.
     * Points are determined by the SLOT they occupy, not their DB primary_position.
     */
    function scorePlayerInSlot(playerId: string, slot: GranularPosition): number {
        const record = playerRecord.get(playerId);
        if (!record || record.minutes === 0) return 0;

        const stats = record.statsJson;
        if (!stats) return 0;

        const { fantasyPoints } = calculateMatchRating(stats, slot, refStats as any);
        return fantasyPoints;
    }

    /** Resolve a single team's lineup score with auto-subs and bench bonus. */
    function calculateTeamScore(lineup: any): number {
        if (!lineup) return 0;

        let score = 0;
        const benchEntries: { player_id: string; slot: string }[] = lineup.bench ?? [];
        const benchIds = benchEntries.map((b: any) => b.player_id);
        const starters: { player_id: string; slot: GranularPosition }[] = lineup.starters ?? [];

        const usedBenchIds = new Set<string>();

        // 1. Starters & Auto-Subs
        for (const starter of starters) {
            const record = playerRecord.get(starter.player_id);
            const minutes = record?.minutes ?? 0;

            if (minutes > 0) {
                // Starter played — score using their actual lineup slot
                score += scorePlayerInSlot(starter.player_id, starter.slot);
            } else {
                // Starter didn't play — find an eligible bench sub
                const slotAllowedPos = POSITION_FLEX_MAP[starter.slot] ?? [];

                let subFound = false;
                for (const benchId of benchIds) {
                    if (usedBenchIds.has(benchId)) continue;

                    const benchRecord = playerRecord.get(benchId);
                    if ((benchRecord?.minutes ?? 0) === 0) continue;

                    const subPositions = playerPositions.get(benchId) ?? [];
                    const canPlaySlot = subPositions.some((pos) => slotAllowedPos.includes(pos));

                    if (canPlaySlot) {
                        // Sub played in the slot — score them in the starter's slot position
                        score += scorePlayerInSlot(benchId, starter.slot);
                        usedBenchIds.add(benchId);
                        subFound = true;
                        break;
                    }
                }
            }
        }

        // 2. Bench depth bonus (20% of unused bench players who played)
        for (const benchId of benchIds) {
            if (!usedBenchIds.has(benchId)) {
                const record = playerRecord.get(benchId);
                if (record && record.minutes > 0 && record.statsJson) {
                    // Score bench player in a neutral slot matching their primary position
                    const primaryPos = (playerPositions.get(benchId)?.[0] ?? 'CM') as GranularPosition;
                    const { fantasyPoints } = calculateMatchRating(record.statsJson, primaryPos, refStats as any);
                    if (fantasyPoints > 0) {
                        score += fantasyPoints * 0.20;
                    }
                }
            }
        }

        return Math.round(score * 10) / 10;
    }

    // 5. Resolve matchups
    const DRAW_THRESHOLD = 10;
    for (const m of matchups) {
        const scoreA = calculateTeamScore(m.lineup_a);
        const scoreB = calculateTeamScore(m.lineup_b);
        const gap = Math.abs(scoreA - scoreB);

        const newStatus = finished ? 'completed' : 'live';
        // Draw if gap ≤ 10 pts — winner_team_id = null for draws
        const winnerId = (finished && gap > DRAW_THRESHOLD)
            ? (scoreA > scoreB ? m.team_a_id : m.team_b_id)
            : null;

        const { error } = await admin
            .from('matchups')
            .update({
                score_a: scoreA,
                score_b: scoreB,
                status: newStatus,
            })
            .eq('id', m.id);

        if (!error) updated++;
    }

    return NextResponse.json({ ok: true, updated, gameweek, finished });
}
