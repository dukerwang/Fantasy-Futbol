'use client';

import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import styles from './matchups.module.css';

interface Props {
    targetGw: number;
    gameweeks: number[];
    leagueId: string;
}

/** When ?gw= / default GW is not in this league's schedule, align with matchups/page snap logic */
function snapToScheduledGw(sorted: number[], gw: number): number {
    if (sorted.length === 0) return gw;
    if (sorted.includes(gw)) return gw;
    return sorted.find((g) => g >= gw) ?? sorted[sorted.length - 1]!;
}

export default function GameweekSelector({ targetGw, gameweeks, leagueId }: Props) {
    const router = useRouter();
    const sorted = useMemo(() => [...gameweeks].sort((a, b) => a - b), [gameweeks]);
    const effectiveGw = snapToScheduledGw(sorted, targetGw);

    useEffect(() => {
        if (effectiveGw === targetGw) return;
        router.replace(`/league/${leagueId}/matchups?gw=${effectiveGw}`);
    }, [effectiveGw, targetGw, leagueId, router]);

    const idx = sorted.indexOf(effectiveGw);
    const prevGw = idx > 0 ? sorted[idx - 1] : null;
    const nextGw = idx < sorted.length - 1 ? sorted[idx + 1] : null;

    const navigate = (gw: number) => {
        router.push(`/league/${leagueId}/matchups?gw=${gw}`);
    };

    return (
        <div className={styles.gwSelectorBar}>
            <button
                className={styles.gwArrow}
                onClick={() => prevGw !== null && navigate(prevGw)}
                disabled={prevGw === null}
                aria-label="Previous gameweek"
            >
                ←
            </button>
            <div className={styles.gwSeparator} />
            <select
                className={styles.gwPill}
                value={effectiveGw}
                onChange={(e) => navigate(Number(e.target.value))}
            >
                {sorted.map((wk) => (
                    <option key={wk} value={wk}>GW {wk}</option>
                ))}
            </select>
            <div className={styles.gwSeparator} />
            <button
                className={styles.gwArrow}
                onClick={() => nextGw !== null && navigate(nextGw)}
                disabled={nextGw === null}
                aria-label="Next gameweek"
            >
                →
            </button>
        </div>
    );
}
