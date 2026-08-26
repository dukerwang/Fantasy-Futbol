'use client';

import type { PerfBand, PerfGroup } from '@/lib/scoring/perfBand';
import styles from './PerformanceBlock.module.css';

/**
 * The performance block — what a manager is told about a match.
 *
 * Four display groups (three for a keeper) over the engine's eight components,
 * BANDED rather than numbered, with the public raw evidence carrying the
 * detail. See src/lib/scoring/perfBand.ts for the disclosure rule this exists
 * to enforce, and the `Gaffa 2.0 Performance Block` doc in the Claude Design
 * system project for the derivation.
 *
 * Takes groups already banded by the server. It receives no scores and cannot
 * render one.
 */

/* best / elite / supreme deliberately share one colour. The ramp's five stops
   are contrast-solved across every palette pair, and a sixth would either
   break that or crowd the feat blues; the escalation is carried by the WORD
   and the bar length instead. */
const BAND_CLASS: Record<PerfBand, string> = {
    poor: styles.bPoor,
    low: styles.bLow,
    mid: styles.bMid,
    good: styles.bGood,
    best: styles.bBest,
    elite: styles.bBest,
    supreme: styles.bBest,
    feat: styles.bFeat,
    feat2: styles.bFeat2,
};

/** Four-point star. currentColor, so it takes the row's band. Never an emoji. */
function FeatMark() {
    return (
        <svg className={styles.mark} viewBox="0 0 12 12" aria-hidden="true">
            <path d="M6 0 L7.35 4.65 L12 6 L7.35 7.35 L6 12 L4.65 7.35 L0 6 L4.65 4.65 Z" />
        </svg>
    );
}

/**
 * The block at glyph size — one quantised bar per group, ~16px tall.
 *
 * For a list row, where the question is "which of these games was the good
 * one?" and there is no room to answer it in words. Same bands, same colours,
 * same quantised geometry as the full block, so scanning a column of these and
 * then opening one tells a consistent story.
 *
 * Carries a text alternative rather than aria-hidden: in a list this is the
 * ONLY summary of the performance, unlike inside the block where the rows
 * beneath say it in words.
 */
export function PerformanceSignature({ groups, label }: { groups: PerfGroup[]; label?: string }) {
    if (!groups.length) return null;
    const text = label ?? groups.map((g) => `${g.label} ${g.verdict}`).join(', ');
    return (
        <span className={`${styles.ramp} ${styles.signatureInline}`} role="img" aria-label={text}>
            {groups.map((g) => (
                <i
                    key={g.key}
                    className={BAND_CLASS[g.band]}
                    style={{ height: `${Math.round(3 + (g.width / 100) * 13)}px` }}
                />
            ))}
        </span>
    );
}

export interface PerformanceBlockProps {
    groups: PerfGroup[];
    /** e.g. "Centre line is the median for a centre-back". Omit to hide. */
    note?: string;
    /** Overrides the anchor the server put on each group — for a surface that
     *  ranks against a different pool (a league, a gameweek) rather than the
     *  season's position pool. Only supply anchors ABOVE the median; below it
     *  they say nothing the band has not, and "bottom 40%" is unpleasant
     *  without being actionable. */
    ranks?: Partial<Record<PerfGroup['key'], string>>;
}

export default function PerformanceBlock({ groups, note, ranks }: PerformanceBlockProps) {
    if (!groups.length) return null;

    return (
        <div className={styles.ramp}>
            <div className={styles.block}>
                {/* Under 200px the rows give way to this. */}
                <div className={styles.signature} aria-hidden="true">
                    {groups.map((g) => (
                        <i
                            key={g.key}
                            className={BAND_CLASS[g.band]}
                            style={{ height: `${Math.round(3 + (g.width / 100) * 13)}px` }}
                        />
                    ))}
                </div>

                <div className={styles.rows}>
                    {groups.map((g) => {
                        const isFeat = g.band === 'feat' || g.band === 'feat2';
                        const rank = ranks?.[g.key] ?? g.rank;
                        return (
                            <div
                                key={g.key}
                                className={`${styles.row} ${BAND_CLASS[g.band]} ${g.width < 50 ? styles.under : ''}`}
                            >
                                <span className={styles.label}>{g.label}</span>
                                <div className={styles.track}>
                                    <div className={`g-track ${styles.bar}`}>
                                        <div
                                            className={styles.ink}
                                            style={{ ['--v' as string]: `${g.width}%` }}
                                        />
                                    </div>
                                    <div className={styles.tick} />
                                </div>
                                <span className={styles.verdict}>
                                    {isFeat && <FeatMark />}
                                    {g.verdict}
                                </span>
                                {(g.evidence || rank) && (
                                    <div className={styles.foot}>
                                        {/* Guarded: `involvement` returns an empty string for an
                                            ordinary 90-minute starter, and an empty <p> would
                                            still claim a line box next to the anchor. */}
                                        {g.evidence && <p className={styles.evidence}>{g.evidence}</p>}
                                        {rank && <span className={styles.rank}>{rank}</span>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
            {note && <p className={styles.note}>{note}</p>}
        </div>
    );
}
