/**
 * The stored-snapshot rule (migration 140).
 *
 * The point of persisting the bands is that a completed match keeps being
 * explained by the engine that scored it. These guard the two halves of that:
 * the snapshot is used when it applies, and is NOT used when it doesn't.
 */
import { describe, expect, it } from 'vitest';
import type { RawStats } from '@/types';
import { buildLineupPerformance, type MatchupPlayerDetail } from '../matchups';
import { DEFAULT_REFERENCE_STATS } from '../engine';

const STATS = {
    minutes_played: 90, goals: 1, assists: 0, clean_sheet: false,
    expected_goals: 0.4, expected_assists: 0.1, creativity: 20,
} as unknown as RawStats;

/** A snapshot no live re-score could ever produce, so its use is unambiguous. */
const SNAPSHOT = [
    { key: 'attacking', label: 'Attacking', band: 'best', width: 88, verdict: 'FROM-THE-SNAPSHOT', evidence: '' },
] as any;

const refStats = DEFAULT_REFERENCE_STATS as any;

function detail(over: Partial<MatchupPlayerDetail> = {}): Record<string, MatchupPlayerDetail> {
    return { p1: { points: 10, rating: 7, stats: STATS, ...over } };
}

describe('stored performance snapshot', () => {
    it('uses the snapshot when the fielded slot is the stored primary', () => {
        const out = buildLineupPerformance(
            detail({ perf: SNAPSHOT, primaryPosition: 'ST' }),
            [{ starters: [{ player_id: 'p1', slot: 'ST' }] }],
            refStats,
        );
        expect(out.p1[0].verdict).toBe('FROM-THE-SNAPSHOT');
    });

    it('rebuilds when he was fielded somewhere else', () => {
        // The stored block was banded under ST's weights and group order; at CB
        // both differ, so reusing it would describe the wrong performance.
        const out = buildLineupPerformance(
            detail({ perf: SNAPSHOT, primaryPosition: 'ST' }),
            [{ starters: [{ player_id: 'p1', slot: 'CB' }] }],
            refStats,
        );
        expect(out.p1[0].verdict).not.toBe('FROM-THE-SNAPSHOT');
        expect(out.p1[0].key).toBe('defending'); // CB leads with defending
    });

    it('rebuilds for a row written before the column existed', () => {
        const out = buildLineupPerformance(
            detail({ perf: null, primaryPosition: 'ST' }),
            [{ starters: [{ player_id: 'p1', slot: 'ST' }] }],
            refStats,
        );
        expect(out.p1.length).toBeGreaterThan(0);
        expect(out.p1[0].verdict).not.toBe('FROM-THE-SNAPSHOT');
    });

    it('skips a player who did not appear, snapshot or not', () => {
        const out = buildLineupPerformance(
            { p1: { points: 0, stats: { minutes_played: 0 } as RawStats, perf: SNAPSHOT, primaryPosition: 'ST' } },
            [{ starters: [{ player_id: 'p1', slot: 'ST' }] }],
            refStats,
        );
        expect(out.p1).toBeUndefined();
    });
});
