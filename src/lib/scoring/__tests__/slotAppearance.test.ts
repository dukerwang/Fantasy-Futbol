/**
 * Matchup chips have to show the score at the slot the player was fielded in,
 * not the stored primary-position number. Szoboszlai at RB is the motivating
 * case: his AM game is ~29, the same appearance at RB (with the OOP haircut)
 * is ~18, and painting the AM figure on an RB chip is the bug.
 *
 * Points include the OOP penalty (what the team is awarded). Display rating
 * does not — same split as the player card.
 */

import { describe, it, expect } from 'vitest';
import { calculateMatchRating, DEFAULT_REFERENCE_STATS } from '../matchRating';
import { attachLineupSlotScores, scoreAppearanceAtSlot } from '../matchups';
import { CASES } from './fixtures';

const oop = CASES.find((c) => c.name === 'oop-striker-at-cb')!;
const storedPrimary = calculateMatchRating(oop.stats, 'ST');

describe('scoreAppearanceAtSlot', () => {
    it('keeps the sync-written primary numbers when the slot is the primary', () => {
        const result = scoreAppearanceAtSlot(
            oop.stats,
            'ST',
            'ST',
            DEFAULT_REFERENCE_STATS,
            { points: 99, rating: 9.9 },
        );
        expect(result).toEqual({ points: 99, rating: 9.9 });
    });

    it('re-scores at the lineup slot, with OOP on points but not display rating', () => {
        const atCb = scoreAppearanceAtSlot(
            oop.stats,
            'CB',
            'ST',
            DEFAULT_REFERENCE_STATS,
            { points: storedPrimary.fantasyPoints, rating: storedPrimary.rating },
        );
        const expectedPts = calculateMatchRating(oop.stats, 'CB', DEFAULT_REFERENCE_STATS, 'ST');
        const expectedRtg = calculateMatchRating(oop.stats, 'CB', DEFAULT_REFERENCE_STATS);
        expect(atCb.points).toBe(expectedPts.fantasyPoints);
        expect(atCb.rating).toBe(expectedRtg.rating);
        expect(atCb.points).toBeLessThan(storedPrimary.fantasyPoints);
        expect(atCb.rating).not.toBe(expectedPts.rating);
    });

    it('returns zero points when the player recorded no minutes', () => {
        const result = scoreAppearanceAtSlot(
            { ...oop.stats, minutes_played: 0 },
            'CB',
            'ST',
            DEFAULT_REFERENCE_STATS,
            { points: 12, rating: 7 },
        );
        expect(result.points).toBe(0);
    });

    it('keeps stored points when stats are missing, so a missing JSON cannot zero a starter', () => {
        const result = scoreAppearanceAtSlot(
            null,
            'CB',
            'ST',
            DEFAULT_REFERENCE_STATS,
            { points: 12, rating: 7 },
        );
        expect(result).toEqual({ points: 12, rating: 7 });
    });
});

describe('attachLineupSlotScores', () => {
    it('writes the slot score onto the starter and leaves bench at primary', () => {
        const detailMap = {
            striker: {
                points: storedPrimary.fantasyPoints,
                rating: storedPrimary.rating,
                stats: oop.stats,
            },
            benchie: {
                points: 20,
                rating: 7.5,
                stats: oop.stats,
            },
        };

        attachLineupSlotScores(
            detailMap,
            [{
                starters: [{ player_id: 'striker', slot: 'CB' }],
                bench: [{ player_id: 'benchie', slot: 'DEF' }],
            }],
            { striker: 'ST', benchie: 'ST' },
            DEFAULT_REFERENCE_STATS,
        );

        const expectedPts = calculateMatchRating(oop.stats, 'CB', DEFAULT_REFERENCE_STATS, 'ST');
        const expectedRtg = calculateMatchRating(oop.stats, 'CB', DEFAULT_REFERENCE_STATS);

        expect(detailMap.striker.points).toBe(expectedPts.fantasyPoints);
        expect(detailMap.striker.rating).toBe(expectedRtg.rating);
        expect(detailMap.striker.bySlot?.CB.points).toBe(expectedPts.fantasyPoints);

        // Bench bonus is not a slot — stored primary stays on `points`.
        expect(detailMap.benchie.points).toBe(20);
        expect(detailMap.benchie.bySlot?.CB.points).toBe(expectedPts.fantasyPoints);
    });
});

describe('Szoboszlai GW1 — AM stored vs RB slot', () => {
    // Real 2026-27 GW1 row. Stored fantasy_points is the AM score (29.06);
    // fielded at RB the matchup chip must show the OOP-haircut RB score, not 29.
    const stats = {
        ...oop.stats,
        minutes_played: 90,
        goals: 1,
        assists: 0,
        bps: 29,
        influence: 43.3,
        creativity: 29.5,
        threat: 45.3,
        ict_index: 11.8,
        expected_goals: 0.85,
        expected_assists: 0.27,
        expected_goals_conceded: 1.43,
        fpl_tackles: 1,
        fpl_cbi: 2,
        fpl_recoveries: 4,
        fpl_def_contrib: 7,
        clean_sheet: false,
    };

    it('does not paint the AM score on an RB chip', () => {
        const am = calculateMatchRating(stats, 'AM');
        const atRb = scoreAppearanceAtSlot(
            stats,
            'RB',
            'AM',
            DEFAULT_REFERENCE_STATS,
            { points: am.fantasyPoints, rating: am.rating },
        );
        expect(atRb.points).toBeLessThan(am.fantasyPoints);
        expect(atRb.points).toBe(
            calculateMatchRating(stats, 'RB', DEFAULT_REFERENCE_STATS, 'AM').fantasyPoints,
        );
        expect(atRb.rating).toBe(
            calculateMatchRating(stats, 'RB', DEFAULT_REFERENCE_STATS).rating,
        );
    });
});
