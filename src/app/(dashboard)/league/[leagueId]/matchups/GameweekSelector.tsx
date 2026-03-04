'use client';

import styles from './matchups.module.css';

interface Props {
    targetGw: number;
    gameweeks: number[];
}

export default function GameweekSelector({ targetGw, gameweeks }: Props) {
    return (
        <form className={styles.gwSelector}>
            <label htmlFor="gw" className={styles.gwLabel}>Jump to Gameweek:</label>
            <select
                id="gw"
                name="gw"
                className={styles.gwSelect}
                defaultValue={targetGw}
                onChange={(e) => {
                    const url = new URL(window.location.href);
                    url.searchParams.set('gw', e.target.value);
                    window.location.href = url.toString();
                }}
            >
                {gameweeks.map((wk) => (
                    <option key={wk} value={wk}>GW {wk}</option>
                ))}
            </select>
        </form>
    );
}
