/**
 * Gaffa — Activity-Based Auction Timer
 *
 * expires_at = quietHoursGuard( max(first + 24h, last + timeout(age)) )
 *
 * There is no hard ceiling. The previous formula was
 *
 *   min(first + MAX, max(first + 24h, last + 12h))
 *
 * and the min() against a fixed wall made the anti-snipe property conditional:
 * while last + 12h sat below the ceiling every bid pushed the close out, but
 * once it crossed, expires_at FROZE and no further bid moved it — so the final
 * 12 hours became a hard, publicly visible deadline. The auctions that reach a
 * ceiling are the contested ones, so the protection failed exactly where it was
 * needed, and the "Closing inside the hour" facet handed snipers the list.
 *
 * Instead the inactivity timeout decays. Duration is bounded in practice rather
 * than by a wall: sustaining an auction past 96 hours needs a bid every hour,
 * and 079_unified_bid_rpc.sql rejects any bid that does not STRICTLY exceed the
 * current high — so the price climbs monotonically and the auction ends when
 * someone stops paying, which is the correct termination condition for an
 * auction rather than an arbitrary clock.
 *
 * The quiet-hours guard is separate and non-negotiable. Nothing in the old
 * formula protected the time of day: its docblock claimed "a 3am bid cannot
 * close at 4am — it must stay open until at least 3pm", but MIN_DURATION is 24h,
 * so a 3am first bid floored at 3am the NEXT day. The ceiling landed at
 * first + 72h (same clock time) and the inactivity close at last + 12h, so a 3pm
 * last bid closed at 3am. Roughly half of all closes landed overnight.
 *
 * What this guarantees:
 * - Every auction stays open at least MIN_DURATION after the first real bid.
 * - Every bid moves the close later. There is no timeable instant.
 * - No auction resolves inside the league's quiet window.
 *
 * Design doc: docs/superpowers/specs/2026-07-30-transfer-market-pricing-design.md
 */

export const MIN_DURATION_MS = 24 * 60 * 60 * 1000; // 24h floor after the first bid

/**
 * How long a seeded auction sits before anyone bids. One value for every
 * seeding path — previously five places stamped this field with three different
 * durations (48h in seedHighValueAuctions, 96h in seasonKickoff, 72/96h here,
 * 48/96h in executeDrop and again in the 062 resolver), so whichever path
 * created the auction silently decided how long it lasted.
 */
export const INITIAL_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Inactivity timeout by auction age. Shrinking rather than capped: this is what
 * replaces the hard ceiling.
 */
const DECAY_BANDS: readonly { readonly untilAgeMs: number; readonly timeoutMs: number }[] = [
    { untilAgeMs: 48 * 60 * 60 * 1000, timeoutMs: 12 * 60 * 60 * 1000 },
    { untilAgeMs: 72 * 60 * 60 * 1000, timeoutMs: 4 * 60 * 60 * 1000 },
    { untilAgeMs: 96 * 60 * 60 * 1000, timeoutMs: 2 * 60 * 60 * 1000 },
    { untilAgeMs: Infinity, timeoutMs: 1 * 60 * 60 * 1000 },
];

export interface QuietHours {
    /** 'HH:MM' local wall-clock time the window opens. */
    start: string;
    /** 'HH:MM' local wall-clock time the window closes. */
    end: string;
    /** IANA zone, e.g. 'America/New_York'. Must match where the managers live. */
    timeZone: string;
}

export const DEFAULT_QUIET_HOURS: QuietHours = {
    start: '00:00',
    end: '08:00',
    timeZone: 'Europe/London',
};

/**
 * The inactivity timeout for an auction of the given age.
 * Never zero — a zero timeout would reintroduce a timeable instant.
 */
export function inactivityTimeoutMs(ageMs: number): number {
    const age = Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
    for (const band of DECAY_BANDS) {
        if (age < band.untilAgeMs) return band.timeoutMs;
    }
    // Unreachable: the last band is Infinity. Kept so the function is total.
    return DECAY_BANDS[DECAY_BANDS.length - 1].timeoutMs;
}

/** Minutes since local midnight, in the given zone, for an absolute instant. */
function localMinutesOfDay(timestampMs: number, timeZone: string): number {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date(timestampMs));
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    // Intl can render midnight as 24 in some locales/zones; normalise.
    return (hour % 24) * 60 + minute;
}

function parseHHMM(value: string): number {
    const [h, m] = value.split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Move a timestamp out of the quiet window, forward to the window's end.
 * Handles a window that wraps midnight (e.g. 22:00–06:00).
 *
 * DST safety: advancing by a wall-clock delta can land back inside the window
 * if a transition occurs in between, so the result is re-checked. Bounded at
 * three passes, which is more than any real transition needs.
 */
export function applyQuietHours(timestampMs: number, quiet: QuietHours | null): number {
    if (!quiet) return timestampMs;

    const startMin = parseHHMM(quiet.start);
    const endMin = parseHHMM(quiet.end);
    if (startMin === endMin) return timestampMs; // zero-length window

    const wraps = startMin > endMin;
    const inWindow = (minutes: number) =>
        wraps ? minutes >= startMin || minutes < endMin : minutes >= startMin && minutes < endMin;

    let result = timestampMs;
    for (let pass = 0; pass < 3; pass++) {
        const minutes = localMinutesOfDay(result, quiet.timeZone);
        if (!inWindow(minutes)) return result;
        // Minutes forward to the window's end, wrapping across midnight.
        const delta = (endMin - minutes + 1440) % 1440;
        result += (delta === 0 ? 1440 : delta) * 60_000;
    }
    return result;
}

/**
 * When an auction should close, given its bidding activity.
 *
 * @param firstBidTime Unix ms of the first real (non-system-seed) bid.
 * @param lastBidTime  Unix ms of the most recent bid — pass the current bid's time.
 * @param quiet        League quiet hours, or null to disable the guard.
 */
export function calculateExpiresAt(
    firstBidTime: number,
    lastBidTime: number,
    quiet: QuietHours | null = DEFAULT_QUIET_HOURS,
): string {
    const age = lastBidTime - firstBidTime;
    const inactivityEnd = lastBidTime + inactivityTimeoutMs(age);
    const minClose = firstBidTime + MIN_DURATION_MS;
    return new Date(applyQuietHours(Math.max(minClose, inactivityEnd), quiet)).toISOString();
}

/**
 * The initial expires_at for a newly seeded auction with no bids yet. The bid
 * route overwrites it via calculateExpiresAt when the first real bid arrives.
 *
 * @param now   Unix ms. Passed in rather than read from Date.now() so this is testable.
 * @param quiet League quiet hours, or null to disable the guard.
 */
export function initialAuctionExpiry(
    now: number,
    quiet: QuietHours | null = DEFAULT_QUIET_HOURS,
): string {
    return new Date(applyQuietHours(now + INITIAL_WINDOW_MS, quiet)).toISOString();
}
