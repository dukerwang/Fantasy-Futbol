/**
 * Gaffa — bench depth bonus
 *
 * The multiplier was a bare literal duplicated in the resolver
 * (calculateTeamScore) and in the live breakdown UI (MatchupPitch), with no
 * test asserting either. It was changed 0.20 → 0.25 and the whole suite still
 * passed, which means the two copies could have drifted and shown managers a
 * breakdown that didn't add up to their score. Both now read
 * BENCH_DEPTH_BONUS from @/types, and these tests pin the value and the four
 * behaviours around it.
 *
 * Every fixture here sets `stats: null` so getSlotPoints() takes its
 * fantasyPoints fallback instead of calling the rating engine. That keeps the
 * arithmetic exact and independent of reference stats, which is what lets these
 * assert a precise total rather than a range.
 */

import { describe, it, expect } from 'vitest';
import { calculateTeamScore } from '../matchups';
import type { PlayerScoreRecord } from '../matchups';
import { BENCH_DEPTH_BONUS, BENCH_DEPTH_BONUS_LABEL } from '@/types';

/** One fixture's worth of pre-computed points. `stats: null` ⇒ fantasyPoints path. */
function record(minutes: number, fantasyPoints: number): PlayerScoreRecord {
    return { fixtures: [{ minutes, fantasyPoints, stats: null }] };
}

function score(
    lineup: { starters: { player_id: string; slot: string }[]; bench: { player_id: string; slot: string }[] },
    records: Record<string, PlayerScoreRecord>,
    positions: Record<string, string[]>,
    finished = false,
): number {
    return calculateTeamScore(
        lineup,
        new Map(Object.entries(records)),
        new Map(Object.entries(positions)),
        new Map(),
        {},
        finished,
        new Set(),
    );
}

describe('bench depth bonus', () => {
    it('is 25%, and the UI label agrees with the constant', () => {
        expect(BENCH_DEPTH_BONUS).toBe(0.25);
        expect(BENCH_DEPTH_BONUS_LABEL).toBe('25%');
    });

    it('credits an unused bench player who played at exactly BENCH_DEPTH_BONUS of his points', () => {
        const total = score(
            {
                starters: [{ player_id: 'starter', slot: 'CM' }],
                bench: [{ player_id: 'benchie', slot: 'MID' }],
            },
            { starter: record(90, 10), benchie: record(90, 20) },
            { starter: ['CM'], benchie: ['CM'] },
        );

        // 10 (starter) + 20 × 0.25 (unused bench) = 15
        expect(total).toBe(10 + 20 * BENCH_DEPTH_BONUS);
        expect(total).toBe(15);
    });

    it('gives nothing for a bench player who did not play', () => {
        const total = score(
            {
                starters: [{ player_id: 'starter', slot: 'CM' }],
                bench: [{ player_id: 'benchie', slot: 'MID' }],
            },
            { starter: record(90, 10), benchie: record(0, 20) },
            { starter: ['CM'], benchie: ['CM'] },
        );

        expect(total).toBe(10);
    });

    it('pays a bench player who was consumed as an auto-sub in full, not at the bonus rate', () => {
        // The starter recorded zero minutes, so `benchie` is substituted in and
        // must be credited at 100%. Double-counting him — full points for the
        // slot AND the depth bonus — is the bug this guards.
        const total = score(
            {
                starters: [{ player_id: 'starter', slot: 'CM' }],
                bench: [{ player_id: 'benchie', slot: 'MID' }],
            },
            { starter: record(0, 0), benchie: record(90, 20) },
            { starter: ['CM'], benchie: ['CM'] },
            true,
        );

        expect(total).toBe(20);
        expect(total).not.toBe(20 + 20 * BENCH_DEPTH_BONUS);
    });

    it('accumulates the bonus across every unused bench player who played', () => {
        const total = score(
            {
                starters: [{ player_id: 'starter', slot: 'CM' }],
                bench: [
                    { player_id: 'b1', slot: 'MID' },
                    { player_id: 'b2', slot: 'ATT' },
                    { player_id: 'b3', slot: 'DEF' },
                ],
            },
            {
                starter: record(90, 10),
                b1: record(90, 8),
                b2: record(45, 4),
                b3: record(0, 100), // did not play — contributes nothing
            },
            { starter: ['CM'], b1: ['CM'], b2: ['ST'], b3: ['CB'] },
        );

        // 10 + (8 + 4) × 0.25 = 13
        expect(total).toBe(10 + (8 + 4) * BENCH_DEPTH_BONUS);
        expect(total).toBe(13);
    });
});
