'use client';

import { useState, useEffect } from 'react';
import NavigationLink from '@/components/ui/NavigationLink';
import { createClient } from '@/lib/supabase/client';
import type { Matchup } from '@/types';
import CrestBadge from '@/components/crest/CrestBadge';
import MarginAxis, { marginVerdict } from '@/components/matchups/MarginAxis';
import { isDrawMargin } from '@/lib/scoring/drawBand';
import styles from './matchups.module.css';

interface TeamRecord {
    W: number;
    L: number;
    D: number;
}

interface Props {
    matchup: Matchup;
    myTeamId?: string;
    currentFplGw: number;
    isCurrentFplGwFinished?: boolean;
    /**
     * Whether we hold FPL's reviewed stats for this gameweek. FPL withholds the
     * ICT block and final bonus until its 09:00-UK lockdown the day after the
     * last match, so a score can look settled hours before it actually is.
     * Defaults to true so callers that never show in-play scores are unaffected.
     */
    finalised?: boolean;
    featured?: boolean;
    recordA?: TeamRecord | null;
    recordB?: TeamRecord | null;
}

export default function LiveMatchupCard({
    matchup,
    myTeamId,
    currentFplGw,
    isCurrentFplGwFinished,
    finalised = true,
    featured = false,
    recordA,
    recordB,
}: Props) {
    const [liveScore, setLiveScore] = useState({
        score_a: matchup.score_a,
        score_b: matchup.score_b,
    });

    let effectiveStatus = matchup.status;
    if (currentFplGw > matchup.gameweek || (currentFplGw === matchup.gameweek && isCurrentFplGwFinished)) {
        effectiveStatus = 'completed';
    } else if (currentFplGw === matchup.gameweek && matchup.status === 'scheduled') {
        effectiveStatus = 'live';
    }

    const isLive = effectiveStatus === 'live';
    const isCompleted = effectiveStatus === 'completed';

    const teamAName = (matchup as any).team_a?.team_name ?? 'TBD';
    const teamBName = (matchup as any).team_b?.team_name ?? 'TBD';
    const teamAId = (matchup as any).team_a?.id;
    const teamBId = (matchup as any).team_b?.id;
    const crestA = (matchup as any).team_a?.crest_config;
    const crestB = (matchup as any).team_b?.crest_config;

    const myTeamSide: 'a' | 'b' | null =
        myTeamId === teamAId ? 'a' : myTeamId === teamBId ? 'b' : null;

    // Ensure state stays synced when the matchup prop changes (e.g. user toggles gameweeks)
    useEffect(() => {
        setLiveScore({ score_a: matchup.score_a, score_b: matchup.score_b });
    }, [matchup.score_a, matchup.score_b]);

    // One fetch on mount to pick up anything that changed since SSR, then live
    // updates via Realtime instead of the 60s poll this replaced — `matchups`
    // is on the supabase_realtime publication (migration 104) and its scores
    // are recomputed on every fpl_live sync tick (~2 min, migration 103), not
    // just on page load.
    useEffect(() => {
        if (!isLive) return;

        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`/api/leagues/${matchup.league_id}/matchups/${matchup.id}/score`);
                if (res.ok) {
                    const data = await res.json();
                    if (!cancelled) setLiveScore({ score_a: data.score_a, score_b: data.score_b });
                }
            } catch { /* silent */ }
        })();

        const supabase = createClient();
        const channel = supabase
            .channel(`matchup:${matchup.id}`)
            .on(
                'postgres_changes',
                { event: 'UPDATE', schema: 'public', table: 'matchups', filter: `id=eq.${matchup.id}` },
                (payload) => {
                    const row = payload.new as { score_a: number; score_b: number };
                    setLiveScore({ score_a: row.score_a, score_b: row.score_b });
                },
            )
            .subscribe();

        return () => {
            cancelled = true;
            supabase.removeChannel(channel);
        };
    }, [isLive, matchup.id, matchup.league_id]);

    const scoreA = liveScore.score_a;
    const scoreB = liveScore.score_b;

    const isDraw = isCompleted && isDrawMargin(scoreA, scoreB);
    const aWins = isCompleted && !isDraw && scoreA > scoreB;
    const bWins = isCompleted && !isDraw && scoreB > scoreA;

    const href = `/league/${matchup.league_id}/matchups/${matchup.id}`;

    const axisProps = {
        scoreA, scoreB, isCompleted, teamAName, teamBName, myTeamSide,
    };

    /* Two states, not three words. "Live" is the system's own marker (.ds-live,
       on --color-live); the rest are plain quiet labels, because none of them is
       a status that needs a colour to be understood.

       "Final" is only honest once we hold FPL's reviewed stats. FPL withholds
       the ICT block and final bonus until its lockdown at 09:00 UK the day
       after the last match, so between the final whistle and that pass the
       score is settled-looking but still an estimate — say so rather than
       stamping a number that is about to move. */
    const stateNode = isLive
        ? <span className="ds-live">Live</span>
        : <span className="g-label-quiet">
              {isCompleted ? (finalised ? 'Final' : 'Provisional') : 'Scheduled'}
          </span>;

    // ── Featured fixture — the panel-scale scoreline ───────────────────────────
    if (featured) {
        return (
            <NavigationLink href={href} className={styles.featured}>
                <span className={`g-label ${styles.featuredLabel}`}>
                    {myTeamSide ? 'Your fixture' : 'Featured fixture'}
                </span>

                <div className="g-score">
                    {/* Home */}
                    <div className={myTeamSide === 'a' ? 'g-score-mine' : undefined}>
                        <div className={styles.scoreClub}>
                            {teamAId && <CrestBadge config={crestA} size={44} teamName={teamAName} teamId={teamAId} />}
                            <span className={styles.scoreId}>
                                <span className={styles.scoreName}>{teamAName}</span>
                                {recordA && (
                                    <span className="g-label-quiet">
                                        {recordA.W}W · {recordA.D}D · {recordA.L}L
                                    </span>
                                )}
                            </span>
                        </div>
                        <span className={`g-score-v ${bWins ? styles.scoreLoser : ''}`}>
                            {scoreA.toFixed(2)}
                        </span>
                    </div>

                    {/* Away */}
                    <div className={`g-score-away ${myTeamSide === 'b' ? 'g-score-mine' : ''}`}>
                        <div className={`${styles.scoreClub} ${styles.scoreClubAway}`}>
                            {teamBId && <CrestBadge config={crestB} size={44} teamName={teamBName} teamId={teamBId} />}
                            <span className={styles.scoreId}>
                                <span className={styles.scoreName}>{teamBName}</span>
                                {recordB && (
                                    <span className="g-label-quiet">
                                        {recordB.W}W · {recordB.D}D · {recordB.L}L
                                    </span>
                                )}
                            </span>
                        </div>
                        <span className={`g-score-v ${aWins ? styles.scoreLoser : ''}`}>
                            {scoreB.toFixed(2)}
                        </span>
                    </div>

                    {/* The margin axis, full width beneath both figures. */}
                    <div className="g-score-axis">
                        <MarginAxis {...axisProps} />
                        <div className="g-axis-foot">
                            <span className={styles.axisState}>{stateNode}</span>
                            <span className="g-axis-verdict">{marginVerdict(axisProps)}</span>
                        </div>
                    </div>
                </div>
            </NavigationLink>
        );
    }

    // ── A fixture row — the same language at row scale ─────────────────────────
    return (
        <NavigationLink href={href} className={styles.fixtureLink}>
            <div className={styles.fixture}>
                <div className={styles.fixtureSide}>
                    {teamAId && <CrestBadge config={crestA} size={28} teamName={teamAName} teamId={teamAId} />}
                    <span className={styles.fixtureName}>{teamAName}</span>
                    <span className={[
                        styles.fixtureScore,
                        bWins ? styles.scoreLoser : '',
                        myTeamSide === 'a' ? styles.fixtureScoreMine : '',
                    ].filter(Boolean).join(' ')}>
                        {scoreA.toFixed(2)}
                    </span>
                </div>

                <div className={styles.fixtureCentre}>
                    <MarginAxis {...axisProps} size="sm" />
                    <span className={styles.fixtureState}>{stateNode}</span>
                </div>

                <div className={`${styles.fixtureSide} ${styles.fixtureSideAway}`}>
                    {teamBId && <CrestBadge config={crestB} size={28} teamName={teamBName} teamId={teamBId} />}
                    <span className={styles.fixtureName}>{teamBName}</span>
                    <span className={[
                        styles.fixtureScore,
                        aWins ? styles.scoreLoser : '',
                        myTeamSide === 'b' ? styles.fixtureScoreMine : '',
                    ].filter(Boolean).join(' ')}>
                        {scoreB.toFixed(2)}
                    </span>
                </div>
            </div>
        </NavigationLink>
    );
}
