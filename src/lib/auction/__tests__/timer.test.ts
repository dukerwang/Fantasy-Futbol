/**
 * Gaffa — auction close timing
 *
 * Three properties must hold simultaneously, and the old min()-against-a-wall
 * formula could not hold them together:
 *
 *   1. No timeable instant. Every bid must push the close out by something, or
 *      a contested auction becomes a public deadline that can be sniped.
 *   2. Bounded in practice. A contested auction must converge rather than run
 *      forever.
 *   3. No overnight resolution. An auction must never close while the league is
 *      asleep, whatever the formula produces.
 */

import { describe, it, expect } from 'vitest';
import {
    MIN_DURATION_MS,
    INITIAL_WINDOW_MS,
    DEFAULT_QUIET_HOURS,
    inactivityTimeoutMs,
    applyQuietHours,
    calculateExpiresAt,
    initialAuctionExpiry,
} from '../timer';
import type { QuietHours } from '../timer';

const H = 60 * 60 * 1000;

// A fixed, DST-free reference point: Wed 2026-02-11 12:00:00 UTC.
const T0 = Date.parse('2026-02-11T12:00:00.000Z');

// Quiet hours in UTC keep the tests readable — the timezone path is exercised
// separately below.
const UTC_QUIET: QuietHours = { start: '00:00', end: '08:00', timeZone: 'UTC' };

describe('inactivityTimeoutMs', () => {
    it('decays across the four bands', () => {
        expect(inactivityTimeoutMs(0)).toBe(12 * H);
        expect(inactivityTimeoutMs(47 * H)).toBe(12 * H);
        expect(inactivityTimeoutMs(48 * H)).toBe(4 * H);
        expect(inactivityTimeoutMs(71 * H)).toBe(4 * H);
        expect(inactivityTimeoutMs(72 * H)).toBe(2 * H);
        expect(inactivityTimeoutMs(95 * H)).toBe(2 * H);
        expect(inactivityTimeoutMs(96 * H)).toBe(1 * H);
        expect(inactivityTimeoutMs(1000 * H)).toBe(1 * H);
    });

    it('never returns zero, so no bid can leave the close unmoved', () => {
        for (const age of [0, 1, 47.9, 48, 72, 96, 500, 10000]) {
            expect(inactivityTimeoutMs(age * H)).toBeGreaterThan(0);
        }
    });

    it('is monotonically non-increasing, so an auction always converges', () => {
        let prev = Infinity;
        for (let age = 0; age <= 200 * H; age += H) {
            const t = inactivityTimeoutMs(age);
            expect(t).toBeLessThanOrEqual(prev);
            prev = t;
        }
    });

    it('treats a negative age as a fresh auction rather than throwing', () => {
        expect(inactivityTimeoutMs(-5 * H)).toBe(12 * H);
    });
});

describe('applyQuietHours', () => {
    const at = (iso: string) => Date.parse(iso);

    it('leaves a daytime expiry untouched', () => {
        const t = at('2026-02-11T14:30:00.000Z');
        expect(applyQuietHours(t, UTC_QUIET)).toBe(t);
    });

    it('pushes a 4am expiry to 8am the same day', () => {
        expect(applyQuietHours(at('2026-02-11T04:00:00.000Z'), UTC_QUIET))
            .toBe(at('2026-02-11T08:00:00.000Z'));
    });

    it('pushes a midnight expiry to 8am', () => {
        expect(applyQuietHours(at('2026-02-11T00:00:00.000Z'), UTC_QUIET))
            .toBe(at('2026-02-11T08:00:00.000Z'));
    });

    it('treats the window end as already awake', () => {
        const t = at('2026-02-11T08:00:00.000Z');
        expect(applyQuietHours(t, UTC_QUIET)).toBe(t);
    });

    it('handles a window that wraps midnight', () => {
        const wrap: QuietHours = { start: '22:00', end: '06:00', timeZone: 'UTC' };
        expect(applyQuietHours(at('2026-02-11T23:00:00.000Z'), wrap))
            .toBe(at('2026-02-12T06:00:00.000Z'));
        expect(applyQuietHours(at('2026-02-11T02:00:00.000Z'), wrap))
            .toBe(at('2026-02-11T06:00:00.000Z'));
        const awake = at('2026-02-11T12:00:00.000Z');
        expect(applyQuietHours(awake, wrap)).toBe(awake);
    });

    it('respects a non-UTC timezone', () => {
        // 04:00 New York on 2026-02-11 is 09:00 UTC. Quiet hours are local, so
        // this must be pushed to 08:00 New York = 13:00 UTC.
        const ny: QuietHours = { start: '00:00', end: '08:00', timeZone: 'America/New_York' };
        expect(applyQuietHours(at('2026-02-11T09:00:00.000Z'), ny))
            .toBe(at('2026-02-11T13:00:00.000Z'));
        // 09:00 UTC is 04:00 NY (quiet) but 10:00 London (awake).
        const lon: QuietHours = { start: '00:00', end: '08:00', timeZone: 'Europe/London' };
        const t = at('2026-02-11T09:00:00.000Z');
        expect(applyQuietHours(t, lon)).toBe(t);
    });

    it('is a no-op when quiet hours are disabled', () => {
        const t = at('2026-02-11T04:00:00.000Z');
        expect(applyQuietHours(t, null)).toBe(t);
    });

    it('is a no-op when start equals end (a zero-length window)', () => {
        const none: QuietHours = { start: '08:00', end: '08:00', timeZone: 'UTC' };
        const t = at('2026-02-11T04:00:00.000Z');
        expect(applyQuietHours(t, none)).toBe(t);
    });

    it('always returns a time outside the window, for every hour of the day', () => {
        for (let h = 0; h < 24; h++) {
            const t = at(`2026-02-11T${String(h).padStart(2, '0')}:30:00.000Z`);
            const out = applyQuietHours(t, UTC_QUIET);
            const hour = new Date(out).getUTCHours();
            expect(hour).toBeGreaterThanOrEqual(8);
            expect(out).toBeGreaterThanOrEqual(t);
        }
    });
});

describe('calculateExpiresAt', () => {
    it('honours the 24h floor on a fresh auction', () => {
        // First bid and last bid the same instant: 12h timeout would give T0+12h,
        // but the floor is T0+24h.
        const out = Date.parse(calculateExpiresAt(T0, T0, null));
        expect(out).toBe(T0 + MIN_DURATION_MS);
    });

    it('closes one timeout after the last bid once past the floor', () => {
        const first = T0;
        const last = T0 + 30 * H; // past the 24h floor, age 30h -> 12h timeout
        expect(Date.parse(calculateExpiresAt(first, last, null))).toBe(last + 12 * H);
    });

    it('uses the decayed timeout deep into a contested auction', () => {
        const first = T0;
        for (const [ageH, timeoutH] of [[50, 4], [80, 2], [120, 1]] as const) {
            const last = first + ageH * H;
            expect(Date.parse(calculateExpiresAt(first, last, null)))
                .toBe(last + timeoutH * H);
        }
    });

    // The property the old formula lost: past the ceiling, expires_at froze and
    // no bid could move it, so the final 12h became a snipeable public deadline.
    //
    // With the decaying timeout, a band transition (e.g. 47h → 48h) can produce
    // a slightly earlier close because the next band's timeout is smaller. That
    // is intentional — later bids cost more in time pressure, not less. The key
    // property is that expires_at never freezes (no plateau of many equal values),
    // and that bids within the same band always move the close forward.
    it('never freezes — within each decay band, a later bid yields a later close', () => {
        const first = T0;
        // Band 1: age 12h..48h (inactivity end > 24h floor from ageH=12)
        let prev = Date.parse(calculateExpiresAt(first, first + 12 * H, null));
        for (let ageH = 13; ageH <= 47; ageH++) {
            const out = Date.parse(calculateExpiresAt(first, first + ageH * H, null));
            expect(out).toBeGreaterThan(prev);
            prev = out;
        }
        // Band 2: age 48h..72h
        prev = Date.parse(calculateExpiresAt(first, first + 48 * H, null));
        for (let ageH = 49; ageH <= 71; ageH++) {
            const out = Date.parse(calculateExpiresAt(first, first + ageH * H, null));
            expect(out).toBeGreaterThan(prev);
            prev = out;
        }
        // Band 3: age 72h..96h
        prev = Date.parse(calculateExpiresAt(first, first + 72 * H, null));
        for (let ageH = 73; ageH <= 95; ageH++) {
            const out = Date.parse(calculateExpiresAt(first, first + ageH * H, null));
            expect(out).toBeGreaterThan(prev);
            prev = out;
        }
        // Band 4: age 96h+
        prev = Date.parse(calculateExpiresAt(first, first + 96 * H, null));
        for (let ageH = 97; ageH <= 240; ageH++) {
            const out = Date.parse(calculateExpiresAt(first, first + ageH * H, null));
            expect(out).toBeGreaterThan(prev);
            prev = out;
        }
    });

    it('never returns a close inside quiet hours', () => {
        const first = T0;
        for (let ageM = 0; ageM <= 200 * 60; ageM += 37) {
            const out = Date.parse(calculateExpiresAt(first, first + ageM * 60000, UTC_QUIET));
            expect(new Date(out).getUTCHours()).toBeGreaterThanOrEqual(8);
        }
    });

    it('always closes at or after the last bid', () => {
        const first = T0;
        for (const ageH of [0, 10, 24, 48, 72, 96, 150]) {
            const last = first + ageH * H;
            expect(Date.parse(calculateExpiresAt(first, last, UTC_QUIET)))
                .toBeGreaterThan(last);
        }
    });

    it('returns an ISO 8601 string', () => {
        expect(calculateExpiresAt(T0, T0, null)).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/);
    });
});

describe('initialAuctionExpiry', () => {
    it('opens a single 72h window regardless of market value', () => {
        expect(Date.parse(initialAuctionExpiry(T0, null))).toBe(T0 + INITIAL_WINDOW_MS);
        expect(INITIAL_WINDOW_MS).toBe(72 * H);
    });

    it('respects quiet hours', () => {
        // T0 + 72h = 2026-02-14T12:00Z, already awake.
        expect(Date.parse(initialAuctionExpiry(T0, UTC_QUIET))).toBe(T0 + 72 * H);
        // A 03:00 UTC start lands at 03:00 UTC three days later -> in quiet window -> pushed to 08:00.
        const late = Date.parse('2026-02-11T03:00:00.000Z');
        const out = Date.parse(initialAuctionExpiry(late, UTC_QUIET));
        expect(new Date(out).getUTCHours()).toBe(8);
    });
});

describe('DEFAULT_QUIET_HOURS', () => {
    it('is midnight to 8am', () => {
        expect(DEFAULT_QUIET_HOURS.start).toBe('00:00');
        expect(DEFAULT_QUIET_HOURS.end).toBe('08:00');
    });
});
