import { describe, expect, it } from 'vitest';
import { lastDatedKickoffHasPassed } from '../lockout';

const ko = (iso: string | null) => ({ kickoff_time: iso });

describe('lastDatedKickoffHasPassed', () => {
    const now = new Date('2026-08-24T19:00:00.000Z');

    it('does not flip when there are no fixtures', () => {
        expect(lastDatedKickoffHasPassed([], now)).toBe(false);
    });

    it('does not flip when every kickoff is null (postponed / unscheduled)', () => {
        expect(lastDatedKickoffHasPassed([ko(null), ko(null)], now)).toBe(false);
    });

    it('does not flip while a later dated kickoff is still in the future', () => {
        expect(
            lastDatedKickoffHasPassed(
                [ko('2026-08-23T15:30:00.000Z'), ko('2026-08-24T19:00:01.000Z')],
                now,
            ),
        ).toBe(false);
    });

    it('flips at the last dated kickoff, ignoring nulls', () => {
        expect(
            lastDatedKickoffHasPassed(
                [ko('2026-08-23T15:30:00.000Z'), ko(null), ko('2026-08-24T19:00:00.000Z')],
                now,
            ),
        ).toBe(true);
    });

    it('does not flip one millisecond before the last kickoff', () => {
        expect(
            lastDatedKickoffHasPassed(
                [ko('2026-08-24T19:00:00.001Z')],
                now,
            ),
        ).toBe(false);
    });
});
