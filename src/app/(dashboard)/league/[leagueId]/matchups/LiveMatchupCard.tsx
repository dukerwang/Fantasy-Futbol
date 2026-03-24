'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import type { Matchup } from '@/types';
import styles from './matchups.module.css';

interface Props {
  matchup: Matchup;
  myTeamId?: string;
  currentFplGw: number;
  aHasCup?: boolean;
  bHasCup?: boolean;
}

export default function LiveMatchupCard({ matchup, myTeamId, currentFplGw, aHasCup, bHasCup }: Props) {
  const [liveScore, setLiveScore] = useState({
    score_a: matchup.score_a,
    score_b: matchup.score_b,
  });

  // Compare with the true FPL Gameweek to override stalled DB statuses
  let effectiveStatus = matchup.status;
  if (currentFplGw > matchup.gameweek) {
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

  const myTeamSide =
    myTeamId === teamAId ? 'a' : myTeamId === teamBId ? 'b' : null;

  // Poll for live score updates every 60 seconds when live
  useEffect(() => {
    if (!isLive) return;

    const poll = async () => {
      try {
        const res = await fetch(
          `/api/leagues/${matchup.league_id}/matchups/${matchup.id}/score`,
        );
        if (res.ok) {
          const data = await res.json();
          setLiveScore({ score_a: data.score_a, score_b: data.score_b });
        }
      } catch {
        // Silently ignore poll errors
      }
    };

    const interval = setInterval(poll, 60_000);
    return () => clearInterval(interval);
  }, [isLive, matchup.id, matchup.league_id]);

  const scoreA = liveScore.score_a;
  const scoreB = liveScore.score_b;
  const aWins = isCompleted && scoreA > scoreB;
  const bWins = isCompleted && scoreB > scoreA;

  return (
    <Link
      href={`/league/${matchup.league_id}/matchups/${matchup.id}`}
      className={styles.matchupCardLink}
    >
    <div
      className={[
        styles.matchupCard,
        isLive ? styles.live : '',
        isCompleted ? styles.completed : '',
        myTeamSide ? styles.myMatchup : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className={styles.statusBadge}>
        {isLive && <span className={styles.livePulse} />}
        {effectiveStatus.toUpperCase()}
      </div>

      <div className={styles.matchupTeams}>
        {/* Team A */}
        <div
          className={[
            styles.team,
            aWins ? styles.winner : '',
            myTeamSide === 'a' ? styles.myTeam : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.teamName}>
            {aHasCup && <span title="Also playing a Cup fixture this week" style={{ marginRight: '6px' }}>🏆</span>}
            {teamAName}
          </span>
          <span className={styles.score}>{scoreA.toFixed(1)}</span>
        </div>

        <div className={styles.vs}>VS</div>

        {/* Team B */}
        <div
          className={[
            styles.team,
            bWins ? styles.winner : '',
            myTeamSide === 'b' ? styles.myTeam : '',
          ]
            .filter(Boolean)
            .join(' ')}
        >
          <span className={styles.score}>{scoreB.toFixed(1)}</span>
          <span className={styles.teamName}>
            {teamBName}
            {bHasCup && <span title="Also playing a Cup fixture this week" style={{ marginLeft: '6px' }}>🏆</span>}
          </span>
        </div>
      </div>

      {/* Live indicator */}
      {isLive && (
        <p className={styles.liveNote}>Scores update every minute</p>
      )}
    </div>
    </Link>
  );
}
