'use client';

import { useRouter } from 'next/navigation';
import styles from './matchups.module.css';

interface Props {
    targetGw: number;
    gameweeks: number[];
    leagueId: string;
}

export default function GameweekSelector({ targetGw, gameweeks, leagueId }: Props) {
    const router = useRouter();
    const idx = gameweeks.indexOf(targetGw);
    const prevGw = idx > 0 ? gameweeks[idx - 1] : null;
    const nextGw = idx < gameweeks.length - 1 ? gameweeks[idx + 1] : null;

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
                value={targetGw}
                onChange={(e) => navigate(Number(e.target.value))}
            >
                {gameweeks.map((wk) => (
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
