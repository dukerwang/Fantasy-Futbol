import { createAdminClient } from '@/lib/supabase/admin';
import { calculateTeamScore, loadReferenceStats, type PlayerScoreRecord } from '@/lib/scoring/matchups';
import { normalizeMatchupLineup } from '@/lib/lineups/normalizeMatchupLineup';
import { getCurrentFplSeason, getLatestReferenceStatsSeason } from '@/lib/season/currentSeason';
import { sendEmail } from '@/lib/email/client';
import { getMatchweekSummaryEmail } from '@/lib/email/templates';
import { executeAdvanceTournament } from '@/lib/tournaments/advanceTournament';
import { payMeritPeriod } from '@/lib/economy/payMeritPeriod';
import { DRAW_THRESHOLD } from '@/lib/scoring/drawBand';

export async function processMatchupsForGameweek(gameweek: number, finished: boolean) {
    const admin = createAdminClient();

    // Match stats are keyed by (season, gameweek), but a gameweek number repeats every
    // season — so a schedule for the upcoming season must never be scored against last
    // season's rows. Everything below is scoped to the season FPL is currently serving.
    // Use the RAW season (no offseason bump) so this always matches the string the stats
    // writer in /api/sync/stats stamps onto player_stats.
    const statsSeason = await getCurrentFplSeason(undefined, true);

    // 1. Fetch incomplete matchups for this GW.
    // Only leagues that are actually playing: a league still in setup/drafting/offseason
    // has a full GW1-38 schedule on the books, and scoring it would invent results.
    const { data: matchups, error: fetchErr } = await admin
        .from('matchups')
        .select('*, team_a:teams!matchups_team_a_id_fkey(*), team_b:teams!matchups_team_b_id_fkey(*), league:leagues!inner(name, status)')
        .eq('gameweek', gameweek)
        .eq('league.status', 'active')
        .neq('status', 'completed');

    if (fetchErr) {
        throw new Error(`Failed to fetch matchups: ${fetchErr.message}`);
    }

    if (!matchups || matchups.length === 0) {
        return { ok: true, message: `No incomplete matchups found for GW ${gameweek}`, gameweek };
    }

    // Bail before touching anything if this gameweek has no stats for the current season.
    // Without this the scorer would happily write 0-0 "live" results for a GW that has
    // not been played yet, and those land in the standings table.
    const { count: seasonStatCount } = await admin
        .from('player_stats')
        .select('id', { count: 'exact', head: true })
        .eq('season', statsSeason)
        .eq('gameweek', gameweek);

    if (!seasonStatCount) {
        return {
            ok: true,
            message: `No ${statsSeason} stats recorded for GW ${gameweek} yet — nothing to score`,
            gameweek,
            season: statsSeason,
        };
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
    const season = await getLatestReferenceStatsSeason(admin);
    const refStats = await loadReferenceStats(admin, season);


    // 3. Fetch player stats for this GW (current season only — see statsSeason above)
    const { data: statsData } = await admin
        .from('player_stats')
        .select('player_id, fantasy_points, stats')
        .eq('season', statsSeason)
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
        if (e.status === 'ir' || e.status === 'loan_out') {
            if (!teamIrMap.has(e.team_id)) teamIrMap.set(e.team_id, new Set());
            teamIrMap.get(e.team_id)!.add(e.player_id);
        }
    }

    // We build ONE playerRecord map for matchup scoring:
    //   playerRecord: stored fantasy_points (V2) + raw stats JSON, so the
    //     role-aware path engages when finished=true.
    const playerRecord = new Map<string, PlayerScoreRecord>();
    for (const row of statsData ?? []) {
        const stats = (row.stats as any) ?? null;
        const fixtureMins: number = stats?.minutes_played ?? 0;
        const pts: number = Number(row.fantasy_points) || 0;

        const fix = { minutes: fixtureMins, fantasyPoints: pts, stats };

        const existing = playerRecord.get(row.player_id);
        if (!existing) playerRecord.set(row.player_id, { fixtures: [fix] });
        else existing.fixtures.push(fix);
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
    let updated = 0;
    const updateErrors: string[] = [];

    // For summary emails
    const leagueSummaryData = new Map<string, { 
        name: string, 
        results: any[], 
        highScorer: { teamName: string, score: number } 
    }>();

    // Only sanitize lineups when the GW is finished (score is being locked in).
    // During a live GW, never retroactively null out players — a mid-GW roster move
    // (e.g. a player won at auction) should not zero out that player's already-earned pts.
    const sanitize = (lineup: any, teamId: string) => {
        if (!lineup) return null;
        if (!finished) return lineup; // live GW: never alter starters
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

        // Calculate team scores under the promoted official V2 engine (with dynamic slot-aware scoring)
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

            // Collect summary data
            if (finished) {
                if (!leagueSummaryData.has(m.league_id)) {
                    leagueSummaryData.set(m.league_id, {
                        name: (m as any).league?.name || 'Your League',
                        results: [],
                        highScorer: { teamName: '', score: -1 }
                    });
                }
                const summary = leagueSummaryData.get(m.league_id)!;
                summary.results.push({
                    teamA: (m.team_a as any).team_name,
                    scoreA: scoreA,
                    teamB: (m.team_b as any).team_name,
                    scoreB: scoreB,
                    winner: winnerId === m.team_a_id ? (m.team_a as any).team_name : (winnerId === m.team_b_id ? (m.team_b as any).team_name : null)
                });
                
                if (scoreA > summary.highScorer.score) {
                    summary.highScorer = { teamName: (m.team_a as any).team_name, score: scoreA };
                }
                if (scoreB > summary.highScorer.score) {
                    summary.highScorer = { teamName: (m.team_b as any).team_name, score: scoreB };
                }
            }
        } else {
            updateErrors.push(`Matchup ${m.id} error: ${error.message}`);
        }
    }

    // 6. Send summary emails & Process deferred transactions (drops/trades)
    if (finished && leagueSummaryData.size > 0) {
        for (const [leagueId, summary] of Array.from(leagueSummaryData.entries())) {
            // A0. Pay the merit period if this gameweek closes one.
            //
            // Runs before the deferred-transaction blocks below so a club that
            // is about to have a drop or trade executed already has the money.
            // Never fatal: the credit RPC is idempotent on
            // (league, team, season, period), so a failure here is retried the
            // next time this gameweek is resolved rather than double-paying.
            try {
                const merit = await payMeritPeriod(admin, leagueId, gameweek);
                if (merit.paid) {
                    console.log(
                        `[matchupProcessor] Merit period ${merit.periodIndex} paid for league ${leagueId}: ` +
                        merit.payments.map((p) => `${p.teamName} €${p.amount}m`).join(', ')
                    );
                }
            } catch (err) {
                console.error(`[matchupProcessor] Merit payment failed for league ${leagueId}:`, err);
            }

            // A. Execute any pending drops queued during the gameweek
            try {
                const { data: pendingDrops } = await admin
                    .from('pending_drops')
                    .select('*')
                    .eq('league_id', leagueId);

                if (pendingDrops && pendingDrops.length > 0) {
                    const { executeDrop } = await import('@/lib/roster/executeDrop');
                    for (const pd of pendingDrops) {
                        try {
                            await executeDrop(admin, pd.team_id, pd.player_id, pd.action_type as 'drop' | 'transfer_out');
                        } catch (err) {
                            console.error(`[matchupProcessor] Failed to execute pending drop ${pd.id}:`, err);
                        }
                    }
                    await admin.from('pending_drops').delete().in('id', pendingDrops.map(pd => pd.id));
                }
            } catch (dropErr) {
                console.error('[matchupProcessor] Error handling pending drops:', dropErr);
            }

            // B. Execute any accepted_deferred trades
            try {
                const { data: deferredTrades } = await admin
                    .from('trade_proposals')
                    .select('id')
                    .eq('league_id', leagueId)
                    .eq('status', 'accepted_deferred');

                if (deferredTrades && deferredTrades.length > 0) {
                    const { data: leagueInfo } = await admin
                        .from('leagues')
                        .select('roster_size')
                        .eq('id', leagueId)
                        .single();
                    const rosterSize = leagueInfo?.roster_size ?? 20;

                    for (const trade of deferredTrades) {
                        const { data: rpcRes, error: rpcError } = await admin.rpc('execute_trade_transaction_rpc', {
                            p_trade_id: trade.id,
                            p_roster_size: rosterSize,
                            p_min_roster_size: 15,
                        });
                        if (rpcError || !rpcRes?.success) {
                            console.error(`[matchupProcessor] Failed to execute deferred trade ${trade.id}:`, rpcError || rpcRes?.error);
                            await admin.from('trade_proposals').update({ status: 'rejected' }).eq('id', trade.id);
                        }
                    }
                }
            } catch (tradeErr) {
                console.error('[matchupProcessor] Error handling deferred trades:', tradeErr);
            }

            // C. Execute any accepted_deferred loans
            try {
                const { data: deferredLoans } = await admin
                    .from('player_loans')
                    .select('*')
                    .eq('league_id', leagueId)
                    .eq('status', 'accepted_deferred');

                if (deferredLoans && deferredLoans.length > 0) {
                    for (const loan of deferredLoans) {
                        const { data: rpcRes, error: rpcError } = await admin.rpc('execute_loan_acceptance_rpc', {
                            p_loan_id: loan.id,
                            p_lender_team_id: loan.lender_team_id,
                            p_borrower_team_id: loan.borrower_team_id,
                            p_player_id: loan.player_id,
                            p_loan_fee: loan.loan_fee,
                            p_league_id: leagueId
                        });

                        if (rpcError || !rpcRes?.success) {
                            console.error(`[matchupProcessor] Failed to execute deferred loan ${loan.id}:`, rpcError || rpcRes?.error);
                            await admin.from('player_loans').update({ status: 'rejected' }).eq('id', loan.id);
                        } else {
                            // Cancel any pending listings
                            await admin
                                .from('player_sale_listings')
                                .update({ status: 'cancelled', updated_at: new Date().toISOString() })
                                .eq('league_id', leagueId)
                                .eq('player_id', loan.player_id)
                                .eq('status', 'pending');
                        }
                    }
                }
            } catch (loanErr) {
                console.error('[matchupProcessor] Error handling deferred loans:', loanErr);
            }

            try {
                const { data: allTeams } = await admin
                    .from('teams')
                    .select('user_id')
                    .eq('league_id', leagueId);
                
                if (allTeams && allTeams.length > 0) {
                    const userIds = allTeams.map(t => t.user_id);
                    const { data: users } = await admin.from('users').select('email').in('id', userIds);
                    const emails = (users ?? []).map(u => u.email).filter(Boolean);

                    if (emails.length > 0) {
                        const baseUrl = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
                        await sendEmail({
                            to: emails,
                            subject: `Monday Review: GW${gameweek} Summary - ${summary.name}`,
                            html: getMatchweekSummaryEmail(
                                summary.name,
                                gameweek,
                                summary.results,
                                summary.highScorer,
                                `${baseUrl}/league/${leagueId}/standings`
                            )
                        });
                    }

                    // Create in-game notifications
                    const { createNotification } = await import('@/lib/notifications/createNotification');
                    for (const t of allTeams) {
                        await createNotification(admin, {
                            leagueId: leagueId,
                            userId: t.user_id,
                            title: `Gameweek ${gameweek} Review`,
                            content: `Matchweek ${gameweek} is finalized! **${summary.highScorer.teamName}** top-scored with **${summary.highScorer.score.toFixed(1)}** points. Check all results now.`,
                            url: `/league/${leagueId}`
                        });
                    }
                }
            } catch (err) {
                console.error(`[matchupProcessor] Failed to send summary for league ${leagueId}:`, err);
            }
        }
    }

    // 7. Accumulate loan performance bonus points if finished
    if (finished) {
        try {
            const { error: rpcError } = await admin.rpc('accumulate_loan_bonus_points', {
                p_gameweek: gameweek,
                p_season: season
            });
            if (rpcError) {
                console.error('[matchupProcessor] Failed to accumulate loan bonus points:', rpcError.message);
            }
        } catch (err) {
            console.error('[matchupProcessor] Failed to execute accumulate_loan_bonus_points RPC:', err);
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

/**
 * Scans the DB for ANY matchups still in 'live' status across ALL gameweeks.
 * For each stalled GW, checks FPL's bootstrap-static to see if the GW is
 * finished (bonus points locked) OR finished_provisional (all fixtures done,
 * bonus points pending). Either is sufficient to lock in match scores.
 *
 * After resolving a GW, any active tournaments are advanced for that GW so
 * cup brackets stay in sync.
 *
 * This is called after every fpl_live sync AND by the dedicated
 * /api/sync/resolve-matchups cron (4× daily) so no GW can stay orphaned.
 */
export async function resolveAllStalledGameweeks(): Promise<{
    resolved: number[];
    skipped: number[];
    tournamentsAdvanced: number;
    reason?: string;
}> {
    try {
        const admin = createAdminClient();

        // 1. Find all GWs that still have live (unresolved) matchups
        const { data: liveMatchups } = await admin
            .from('matchups')
            .select('gameweek')
            .eq('status', 'live');

        if (!liveMatchups || liveMatchups.length === 0) {
            return { resolved: [], skipped: [], tournamentsAdvanced: 0, reason: 'no_live_matchups' };
        }

        const stalledGws = [...new Set(liveMatchups.map(m => m.gameweek))].sort((a, b) => a - b);

        // 2. Fetch FPL bootstrap once — covers all GW finished/finished_provisional flags
        const bsRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
            next: { revalidate: 0 },
            headers: { 'User-Agent': 'FantasyFutbol/1.0' },
        });

        if (!bsRes.ok) {
            return { resolved: [], skipped: stalledGws, tournamentsAdvanced: 0, reason: 'fpl_api_error' };
        }

        const bsData = await bsRes.json();
        // Accept finished (bonus locked) OR finished_provisional (all matches done, bonus pending).
        // finished_provisional fires hours before finished — eliminates most overnight delays.
        const resolveableSet = new Set<number>(
            (bsData.events as any[])
                .filter((e: any) => e.finished === true || e.finished_provisional === true)
                .map((e: any) => e.id as number)
        );

        // 3. Resolve each stalled GW
        const resolved: number[] = [];
        const skipped: number[] = [];
        let tournamentsAdvanced = 0;

        for (const gw of stalledGws) {
            if (!resolveableSet.has(gw)) {
                skipped.push(gw);
                continue;
            }
            // Process with finished=true to lock in winners and flip status to 'completed'
            await processMatchupsForGameweek(gw, true);
            resolved.push(gw);

            // Advance any active tournaments for this now-resolved GW so cup brackets stay live.
            // We do this inline rather than calling the tournament route to avoid HTTP overhead.
            try {
                const { data: activeTournaments } = await admin
                    .from('tournaments')
                    .select('id')
                    .eq('status', 'active');

                if (activeTournaments) {
                    for (const t of activeTournaments) {
                        await executeAdvanceTournament(t.id, gw);
                        tournamentsAdvanced++;
                    }
                }
            } catch (tErr) {
                console.warn(`[resolveAllStalledGameweeks] Tournament advance failed for GW ${gw}:`, tErr);
            }
        }

        return { resolved, skipped, tournamentsAdvanced };
    } catch (err: any) {
        return { resolved: [], skipped: [], tournamentsAdvanced: 0, reason: `error: ${String(err)}` };
    }
}
