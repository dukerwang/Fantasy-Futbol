/**
 * Gaffa — Activity-Based Auction Timer with Market Value Tiers & Smart Overnight Protection
 *
 * expires_at = quietHoursGuard( max(first + tierFloor(marketValue), last + timeout(age)) )
 *
 * Design features:
 * 1. Market Value Tiers:
 *    - Tier 1 (< €25m): 12h initial floor (allows fast streaming / matchday moves).
 *    - Tier 2 (€25m – €50m): 24h initial floor (guaranteed 1 full day of notice).
 *    - Tier 3 (€50m – €80m): 48h initial floor (marquee signings get 2 full days).
 *    - Tier 4 (≥ €80m): 72h initial floor (superstar assets get 3 full days).
 *
 * 2. Activity-Based Inactivity Timeout:
 *    - Base timeout: 6 hours (decaying to 4h at 48h age, 2h at 72h age, 1h at 96h+).
 *    - Guarantees anti-snipe protection while allowing auctions to converge.
 *
 * 3. Smart Overnight & Weekend Matchday Protection:
 *    - Overnight Deadzone: 11:00 PM – 8:00 AM local league time.
 *    - Contested / High-Value (≥ €20m or 2+ bids) or Weekdays: Pushed to 12:00 PM (Noon) local time.
 *    - Uncontested Weekend Streamers (< €20m and 1 bid on Saturday/Sunday): Pushed to 6:45 AM local time
 *      (45 minutes before the early 7:30 AM EST kickoff).
 */

export const TIER_1_MAX_MV = 25;
export const TIER_2_MAX_MV = 50;
export const TIER_3_MAX_MV = 80;

export const TIER_1_FLOOR_MS = 12 * 60 * 60 * 1000; // 12h
export const TIER_2_FLOOR_MS = 24 * 60 * 60 * 1000; // 24h
export const TIER_3_FLOOR_MS = 48 * 60 * 60 * 1000; // 48h
export const TIER_4_FLOOR_MS = 72 * 60 * 60 * 1000; // 72h

export const MIN_DURATION_MS = TIER_2_FLOOR_MS; // 24h default floor

/**
 * Default initial window for seeded auctions before any bid.
 */
export const INITIAL_WINDOW_MS = 72 * 60 * 60 * 1000;

/**
 * Shelf life of a manager listing before any bid.
 */
export const LISTING_INITIAL_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

/**
 * Returns the initial auction floor duration in ms based on player market value.
 */
export function tierInitialFloorMs(marketValue: number = 0): number {
    const mv = Number.isFinite(marketValue) && marketValue > 0 ? marketValue : 0;
    if (mv < TIER_1_MAX_MV) return TIER_1_FLOOR_MS;
    if (mv < TIER_2_MAX_MV) return TIER_2_FLOOR_MS;
    if (mv < TIER_3_MAX_MV) return TIER_3_FLOOR_MS;
    return TIER_4_FLOOR_MS;
}

/**
 * Inactivity timeout by auction age.
 */
const DECAY_BANDS: readonly { readonly untilAgeMs: number; readonly timeoutMs: number }[] = [
    { untilAgeMs: 48 * 60 * 60 * 1000, timeoutMs: 6 * 60 * 60 * 1000 },
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

export interface AuctionTimerOptions {
    /** Real-world market value of player in €m. */
    marketValue?: number;
    /** Total number of bids placed in the auction so far (including current). */
    bidCount?: number;
}

/**
 * The inactivity timeout for an auction of the given age.
 * Never zero — a zero timeout would reintroduce a timeable instant.
 */
export function inactivityTimeoutMs(ageMs: number): number {
    const age = Number.isFinite(ageMs) && ageMs > 0 ? ageMs : 0;
    for (const band of DECAY_BANDS) {
        if (age < band.untilAgeMs) return band.timeoutMs;
    }
    return DECAY_BANDS[DECAY_BANDS.length - 1].timeoutMs;
}

/** Local wall-clock day and minutes since midnight in the given timezone. */
function localTimeDetails(timestampMs: number, timeZone: string): {
    weekday: string;
    minutes: number;
} {
    const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone,
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date(timestampMs));
    const weekday = parts.find((p) => p.type === 'weekday')?.value ?? 'Wed';
    const hour = Number(parts.find((p) => p.type === 'hour')?.value ?? '0');
    const minute = Number(parts.find((p) => p.type === 'minute')?.value ?? '0');
    return {
        weekday,
        minutes: (hour % 24) * 60 + minute,
    };
}

function parseHHMM(value: string): number {
    const [h, m] = value.split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

/**
 * Smart Quiet Hours & Overnight Protection:
 * - Deadzone: 11:00 PM (23:00) to 8:00 AM (08:00) local time.
 * - Uncontested weekend streamers (< €20m, 1 bid on Sat/Sun): pushed to 6:45 AM local time.
 * - All other overnight resolutions: pushed to 12:00 PM (Noon) local time.
 */
export function applyQuietHours(
    timestampMs: number,
    quiet: QuietHours | null,
    options?: AuctionTimerOptions,
): number {
    if (!quiet) return timestampMs;

    const startMin = parseHHMM(quiet.start);
    const endMin = parseHHMM(quiet.end);
    if (startMin === endMin) return timestampMs; // zero-length window

    const wraps = startMin > endMin;
    const inQuietWindow = (minutes: number) =>
        wraps ? minutes >= startMin || minutes < endMin : minutes >= startMin && minutes < endMin;

    // Overnight includes 11:00 PM onwards or anytime in the quiet window (e.g. up to 8:00 AM)
    const isOvernight = (minutes: number) => minutes >= 23 * 60 || inQuietWindow(minutes);

    const { weekday, minutes } = localTimeDetails(timestampMs, quiet.timeZone);
    if (!isOvernight(minutes)) return timestampMs;

    // If an overnight bid happens late at night (>= 23:00), the target morning is the NEXT day.
    const targetWeekday =
        minutes >= 23 * 60
            ? weekday === 'Mon'
                ? 'Tue'
                : weekday === 'Tue'
                  ? 'Wed'
                  : weekday === 'Wed'
                    ? 'Thu'
                    : weekday === 'Thu'
                      ? 'Fri'
                      : weekday === 'Fri'
                        ? 'Sat'
                        : weekday === 'Sat'
                          ? 'Sun'
                          : 'Mon'
            : weekday;

    const isWeekend = targetWeekday === 'Sat' || targetWeekday === 'Sun';
    const isStreamer = (options?.marketValue ?? 0) < 20 && (options?.bidCount ?? 1) <= 1;

    // Target settlement time: 6:45 AM (405m) for weekend streamers, 12:00 PM Noon (720m) for all others
    const targetMins = isWeekend && isStreamer ? 6 * 60 + 45 : 12 * 60;

    let result = timestampMs;
    // Minutes forward to the target time
    const delta = (targetMins - minutes + 1440) % 1440;
    result += (delta === 0 ? 1440 : delta) * 60_000;

    // Re-check for DST boundary crossing (up to 2 passes)
    for (let pass = 0; pass < 2; pass++) {
        const check = localTimeDetails(result, quiet.timeZone);
        if (check.minutes === targetMins) break;
        const adj = (targetMins - check.minutes + 1440) % 1440;
        if (adj === 0) break;
        result += adj * 60_000;
    }

    return result;
}

/**
 * When an auction should close, given its bidding activity and player tier.
 *
 * @param firstBidTime Unix ms of the first real (non-system-seed) bid.
 * @param lastBidTime  Unix ms of the most recent bid — pass the current bid's time.
 * @param quiet        League quiet hours, or null to disable the guard.
 * @param options      Player market value and bid count for tiering and streamer protection.
 */
export function calculateExpiresAt(
    firstBidTime: number,
    lastBidTime: number,
    quiet: QuietHours | null = DEFAULT_QUIET_HOURS,
    options?: AuctionTimerOptions,
): string {
    const age = lastBidTime - firstBidTime;
    const inactivityEnd = lastBidTime + inactivityTimeoutMs(age);
    const minClose = firstBidTime + tierInitialFloorMs(options?.marketValue ?? 0);
    const naturalExpiry = Math.max(minClose, inactivityEnd);
    return new Date(applyQuietHours(naturalExpiry, quiet, options)).toISOString();
}

/**
 * The initial expires_at for a newly seeded auction with no bids yet.
 *
 * @param now         Unix ms.
 * @param quiet       League quiet hours, or null to disable the guard.
 * @param marketValue Optional player market value for tier-based duration.
 */
export function initialAuctionExpiry(
    now: number,
    quiet: QuietHours | null = DEFAULT_QUIET_HOURS,
    marketValue?: number,
): string {
    const initialWindow = marketValue != null && marketValue > 0 ? tierInitialFloorMs(marketValue) : INITIAL_WINDOW_MS;
    return new Date(applyQuietHours(now + initialWindow, quiet, { marketValue, bidCount: 0 })).toISOString();
}
