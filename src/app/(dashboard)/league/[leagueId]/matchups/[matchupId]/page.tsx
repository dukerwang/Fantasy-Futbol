import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import NavigationLink from '@/components/ui/NavigationLink';
import type { Matchup, MatchupLineup, Player, RawStats } from '@/types';
import MatchupPitch from '@/components/MatchupPitch';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { normalizeMatchupLineup } from '@/lib/lineups/normalizeMatchupLineup';
import { generateMatchReport } from '@/lib/narrative/matchReport';
import { getCurrentFplSeason, getLatestReferenceStatsSeason } from '@/lib/season/currentSeason';
import {
    applySubsToLineup,
    attachLineupSlotScores,
    buildLineupPerformance,
    calculateTeamScore,
    emptyTeamScoreDetail,
    loadReferenceStats,
    type MatchupPlayerDetail,
    type PlayerScoreRecord,
    type TeamScoreDetail,
} from '@/lib/scoring/matchups';
import { isGameweekFinalised } from '@/lib/scoring/gameweekState';
import { getFinishedPlTeamIds, getLockedPlTeamIds } from '@/lib/fixtures/lockout';
import { clubHref } from '@/lib/teams/clubHref';
import CrestBadge from '@/components/crest/CrestBadge';
import MatchReportCard from './MatchReportCard';
import MatchupLiveRefresh from './MatchupLiveRefresh';
import MarginAxis, { marginVerdict } from '@/components/matchups/MarginAxis';
import { isDrawMargin } from '@/lib/scoring/drawBand';
import type { PerfGroup } from '@/lib/scoring/perfBand';
import styles from './matchup-detail.module.css';

export const dynamic = 'force-dynamic';

interface Props {
    params: Promise<{ leagueId: string; matchupId: string }>;
}

export default async function MatchupDetailPage({ params }: Props) {
    const { leagueId, matchupId } = await params;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const admin = createAdminClient();

    const { data: league } = await admin
        .from('leagues')
        .select('id, name, commissioner_id')
        .eq('id', leagueId)
        .single();

    if (!league) notFound();

    const { data: member } = await admin
        .from('teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('user_id', user.id)
        .single();

    if (!member && league.commissioner_id !== user.id) redirect('/dashboard');

    const { data: matchupData } = await admin
        .from('matchups')
        .select(`
            *,
            team_a:teams!matchups_team_a_id_fkey(id, team_name, crest_config),
            team_b:teams!matchups_team_b_id_fkey(id, team_name, crest_config)
        `)
        .eq('id', matchupId)
        .eq('league_id', leagueId)
        .single();

    if (!matchupData) notFound();

    const matchup = matchupData as Matchup & {
        team_a: { id: string; team_name: string; crest_config: any } | null;
        team_b: { id: string; team_name: string; crest_config: any } | null;
    };

    const lineupA = normalizeMatchupLineup(matchup.lineup_a as MatchupLineup | null);
    const lineupB = normalizeMatchupLineup(matchup.lineup_b as MatchupLineup | null);

    const playerIds = new Set<string>();
    lineupA?.starters.forEach((s) => playerIds.add(s.player_id));
    (lineupA?.bench as any[] ?? []).forEach((b) => playerIds.add(b.player_id));
    lineupB?.starters.forEach((s) => playerIds.add(s.player_id));
    (lineupB?.bench as any[] ?? []).forEach((b) => playerIds.add(b.player_id));

    const playerMap: Record<string, Partial<Player>> = {};
    if (playerIds.size > 0) {
        const [{ data: playersData }, { data: rankings }] = await Promise.all([
            admin.from('players').select(FULL_PLAYER_SELECT).in('id', Array.from(playerIds)) as any,
            admin.from('player_rankings').select('*').in('player_id', Array.from(playerIds)),
        ]);
        const rankMap = new Map((rankings ?? []).map((r: any) => [r.player_id, r]));
        for (const p of (playersData ?? []) as any[]) {
            const ranks = rankMap.get(p.id);
            playerMap[p.id] = { ...p, overall_rank: ranks?.overall_rank, position_ranks: ranks?.position_ranks } as Partial<Player>;
        }
    }

    // Stored fantasy_points / match_rating are primary-position scores — the
    // same numbers the player browser and PPG use. The pitch has to show the
    // slot the manager actually fielded (Szoboszlai at RB is not his AM game).
    // We re-score secondaries from the stored stats JSON, which already carries
    // imputed ICT from sync; we do not re-derive the primary, so live ICT
    // can't drift from the number already written.
    const detailMap: Record<string, MatchupPlayerDetail> = {};
    let perfMap: Record<string, PerfGroup[]> = {};
    // Hoisted out of the block below: also needed to compute the live team
    // total (calculateTeamScore) further down, not just the per-player chips.
    let statsRows: any[] | undefined;
    let refStats: Awaited<ReturnType<typeof loadReferenceStats>> | undefined;
    if (playerIds.size > 0 && matchupData.gameweek) {
        // Scope by season too — gameweek numbers repeat every season, and
        // player_stats keeps every past season's rows (never archived/cleared).
        const [statsSeason, refSeason] = await Promise.all([
            getCurrentFplSeason(undefined, true),
            getLatestReferenceStatsSeason(admin),
        ]);
        const [{ data: fetchedStatsRows }, fetchedRefStats] = await Promise.all([
            admin
                .from('player_stats')
                // match_rating is its own column, never a key inside stats — the pitch
                // chip needs it passed through explicitly.
                .select('player_id, fantasy_points, match_rating, stats, perf')
                .eq('season', statsSeason)
                .eq('gameweek', matchupData.gameweek)
                .in('player_id', Array.from(playerIds)),
            loadReferenceStats(admin, refSeason),
        ]);
        statsRows = fetchedStatsRows ?? undefined;
        refStats = fetchedRefStats;

        for (const s of statsRows ?? []) {
            detailMap[s.player_id] = {
                points: Number(s.fantasy_points),
                rating: s.match_rating != null ? Number(s.match_rating) : null,
                stats: (s.stats as RawStats | undefined) ?? undefined,
                // The snapshot the sync stored, plus the position it describes —
                // buildLineupPerformance uses it only when the fielded slot
                // matches, and rebuilds otherwise.
                perf: (s.perf as PerfGroup[] | null) ?? null,
                primaryPosition: playerMap[s.player_id]?.primary_position ?? null,
            };
        }
    }

    // Whether we hold FPL's reviewed stats for this gameweek yet. Until the
    // post-lockdown pass runs, the scoreline is an estimate and must not be
    // labelled "Final" — see src/lib/scoring/gameweekState.ts.
    const finalised = await isGameweekFinalised(
        admin,
        await getCurrentFplSeason(undefined, true),
        matchupData.gameweek,
    );

    // Live/provisional total, computed the same way the matchup processor
    // computes the resolved one — auto-subs for blanked starters and the bench
    // depth bonus included. Only `matchup.score_a/score_b` (the processor's own
    // output) is used once the matchup is completed, below; this is what the
    // header shows while still live so the two surfaces can't disagree.
    //
    // Always run this (not just while live): the pitch's sub arrows and points
    // breakdown need `detailA`/`detailB` — which starters were auto-subbed and
    // by whom, and the bench bonus per player — for a completed matchup too.
    let computedScoreA = 0;
    let computedScoreB = 0;
    const detailA: TeamScoreDetail = emptyTeamScoreDetail();
    const detailB: TeamScoreDetail = emptyTeamScoreDetail();
    if (playerIds.size > 0 && matchupData.gameweek) {
        const playerRecord = new Map<string, PlayerScoreRecord>();
        for (const s of statsRows ?? []) {
            const stats = (s.stats as RawStats | null) ?? null;
            const fixtureMins = stats?.minutes_played ?? 0;
            playerRecord.set(s.player_id, {
                fixtures: [{ minutes: fixtureMins, fantasyPoints: Number(s.fantasy_points) || 0, stats }],
            });
        }

        const playerPositions = new Map<string, string[]>();
        const playerPlTeamId = new Map<string, number>();
        for (const [id, p] of Object.entries(playerMap)) {
            playerPositions.set(id, [p.primary_position, ...(p.secondary_positions ?? [])].filter(Boolean) as string[]);
            if (p.pl_team_id != null) playerPlTeamId.set(id, Number(p.pl_team_id));
        }

        const finishedPlTeamIds = await getFinishedPlTeamIds(matchupData.gameweek);

        computedScoreA = calculateTeamScore(lineupA, playerRecord, playerPositions, playerPlTeamId, refStats ?? {}, finalised, finishedPlTeamIds, detailA);
        computedScoreB = calculateTeamScore(lineupB, playerRecord, playerPositions, playerPlTeamId, refStats ?? {}, finalised, finishedPlTeamIds, detailB);

        // Effective lineups after auto-subs: starters who blanked are replaced by the
        // sub who filled their slot, so performance blocks & chip ratings grade the
        // sub at the slot he actually filled.
        const effectiveLineupA = applySubsToLineup(lineupA, detailA);
        const effectiveLineupB = applySubsToLineup(lineupB, detailB);

        const playerPrimary = new Map<string, string | undefined>();
        for (const [id, p] of Object.entries(playerMap)) {
            playerPrimary.set(id, p.primary_position);
        }
        attachLineupSlotScores(detailMap, [effectiveLineupA, effectiveLineupB], playerPrimary, refStats ?? {});
        // The banded performance block per starter, at the slot he was fielded
        // in. Computed here rather than in the client so no score reaches the
        // browser — see src/lib/scoring/perfBand.ts.
        perfMap = buildLineupPerformance(detailMap, [effectiveLineupA, effectiveLineupB], refStats ?? {});
    }

    // Which of these players' own clubs have kicked off. A chip showing 0.0 is
    // meaningless without it — the reader can't tell "played, did nothing" from
    // "hasn't started yet". Reuses the lineup lockout's kickoff signal rather
    // than deriving a second one; a failure returns an empty set, which the
    // pitch treats as "unknown" and falls back to showing plain scores.
    // Undefined, not [], when we can't tell: an empty array means "nobody has
    // kicked off", and getLockedPlTeamIds also returns an empty set when FPL is
    // unreachable. Conflating the two would stamp "yet to play" across a
    // finished match, so only a non-empty result is treated as known.
    let startedPlayerIds: string[] | undefined;
    try {
        const lockedTeamIds = await getLockedPlTeamIds(admin, matchupData.gameweek);
        if (lockedTeamIds.size > 0) {
            startedPlayerIds = Object.values(playerMap)
                .filter((p) => p?.id && p.pl_team_id != null && lockedTeamIds.has(Number(p.pl_team_id)))
                .map((p) => p!.id as string);
        }
    } catch { /* stays undefined — pitch falls back to plain scores */ }

    const isCompleted = matchup.status === 'completed';
    const isLive      = matchup.status === 'live';
    const scoreA      = isCompleted ? matchup.score_a : computedScoreA;
    const scoreB      = isCompleted ? matchup.score_b : computedScoreB;
    const isDraw      = isCompleted && isDrawMargin(scoreA, scoreB);
    const aWins       = isCompleted && !isDraw && scoreA > scoreB;
    const bWins       = isCompleted && !isDraw && scoreB > scoreA;
    const teamAName   = matchup.team_a?.team_name ?? 'Team A';
    const teamBName   = matchup.team_b?.team_name ?? 'Team B';

    const report = generateMatchReport(matchup, lineupA, lineupB, playerMap, detailMap, scoreA, scoreB, detailA, detailB);

    const myTeamSide: 'a' | 'b' | null =
        member?.id && matchup.team_a?.id === member.id ? 'a'
        : member?.id && matchup.team_b?.id === member.id ? 'b'
        : null;

    const axisProps = { scoreA, scoreB, isCompleted, teamAName, teamBName, myTeamSide };

    return (
        <div className={`${styles.page} g-page`}>
            {isLive && <MatchupLiveRefresh matchupId={matchup.id} />}

            <NavigationLink href={`/league/${leagueId}/matchups?gw=${matchup.gameweek}`} className={styles.backLink}>
                ← Gameweek {matchup.gameweek}
            </NavigationLink>

            {/* The scoreline — the same instrument the round's list draws, at
                panel scale. See design-2.0/README.md § "The surface". */}
            <section className={`${styles.headPanel} g-panel`}>
                <span className={`g-label ${styles.headLabel}`}>Gameweek {matchup.gameweek}</span>

                <div className="g-score">
                    <div className={myTeamSide === 'a' ? 'g-score-mine' : undefined}>
                        <div className={styles.scoreClub}>
                            <ClubLink leagueId={leagueId} teamId={matchup.team_a?.id} myTeamId={member?.id} name={teamAName} crestConfig={matchup.team_a?.crest_config} />
                        </div>
                        <span className={`g-score-v ${bWins ? styles.scoreLoser : ''}`}>
                            {scoreA.toFixed(2)}
                        </span>
                    </div>

                    <div className={`g-score-away ${myTeamSide === 'b' ? 'g-score-mine' : ''}`}>
                        <div className={`${styles.scoreClub} ${styles.scoreClubAway}`}>
                            <ClubLink leagueId={leagueId} teamId={matchup.team_b?.id} myTeamId={member?.id} name={teamBName} crestConfig={matchup.team_b?.crest_config} />
                        </div>
                        <span className={`g-score-v ${aWins ? styles.scoreLoser : ''}`}>
                            {scoreB.toFixed(2)}
                        </span>
                    </div>

                    <div className="g-score-axis">
                        <MarginAxis {...axisProps} />
                        <div className="g-axis-foot">
                            <span className={styles.axisState}>
                                {isLive
                                    ? <span className="ds-live">Live</span>
                                    : <span className="g-label-quiet">
                                          {isCompleted ? (finalised ? 'Final' : 'Provisional') : 'Scheduled'}
                                      </span>}
                            </span>
                            <span className="g-axis-verdict">{marginVerdict(axisProps)}</span>
                        </div>
                    </div>
                </div>
            </section>

            <MatchReportCard report={report} />

            <MatchupPitch
                lineupA={lineupA}
                lineupB={lineupB}
                playerMap={playerMap}
                startedPlayerIds={startedPlayerIds}
                detailMap={detailMap}
                perfMap={perfMap}
                gameweek={matchupData.gameweek}
                teamAName={teamAName}
                teamBName={teamBName}
                teamAId={matchup.team_a?.id}
                teamBId={matchup.team_b?.id}
                crestA={matchup.team_a?.crest_config}
                crestB={matchup.team_b?.crest_config}
                scoreA={scoreA}
                scoreB={scoreB}
                detailA={detailA}
                detailB={detailB}
            />
        </div>
    );
}

/**
 * A club's crest and name inside a scoreline cell, linked to that club's squad.
 *
 * The lineup below shows the eleven that played this week; the link answers the
 * question that immediately follows it — what else is on that roster.
 *
 * It returns the crest and the name as SIBLINGS rather than wrapping them in a
 * flex box of its own: the cell already lays them out, and the away cell
 * reverses that layout. A wrapper here would have to reverse too, which is one
 * more place to keep in sync for nothing.
 */
function ClubLink({
    leagueId, teamId, myTeamId, name, crestConfig,
}: { leagueId: string; teamId?: string; myTeamId?: string; name: string; crestConfig?: any }) {
    if (!teamId) return <span className={styles.clubLink}>{name}</span>;
    return (
        <>
            <CrestBadge config={crestConfig} size={44} teamName={name} teamId={teamId} />
            <NavigationLink href={clubHref(leagueId, teamId, teamId === myTeamId)} className={styles.clubLink}>
                {name}
            </NavigationLink>
        </>
    );
}
