/**
 * Gaffa — Gameweek Settlement Timing
 *
 * Shared logic for deciding whether a gameweek's FPL data is trustworthy
 * enough to (a) keep live-syncing player_stats, and (b) lock matchup scores.
 * Both decisions must agree on the same grace window — see
 * FINISHED_PROVISIONAL_GRACE_MINUTES for why.
 */

/**
 * How long to keep treating a gameweek as "still settling" after its LAST
 * fixture kicks off, once FPL has flagged it finished_provisional (all
 * fixtures blew full-time) but not yet finished (bonus points locked).
 *
 * FPL doesn't publish bonus points — or the influence/creativity/threat/
 * ict_index triad the scoring engine weighs — the instant full-time whistles
 * blow; that data lands sometime after, and per FPL's own rules isn't
 * guaranteed until ~1h after the LAST match of the gameweek (see the
 * 2026-08-21 Arsenal v Coventry investigation, where this gap zeroed out
 * Declan Rice's DM rating). 180 min ≈ a full match + stoppage (~120 min)
 * plus a ~60 min buffer for that post-match pass, while still settling
 * same-day rather than waiting on `finished`, which can occasionally take
 * until the next morning.
 *
 * This window governs TWO things that must stay in sync:
 *   - the live-stats sync (route.ts) keeps polling every ~2 min through it,
 *     so it actually has a chance to catch the real bonus/ICT data once
 *     published, instead of self-skipping the moment finished_provisional
 *     flips true;
 *   - the matchup locker (matchupProcessor.ts) waits for it before marking
 *     a matchup 'completed', so it isn't locking in whatever the sync
 *     captured on its last poll before the window closed.
 * Widening this constant delays *both* — it doesn't just make people wait
 * longer for the same stale numbers, it also buys the sync more chances to
 * fetch the corrected ones first.
 */
export const FINISHED_PROVISIONAL_GRACE_MINUTES = 180;

/**
 * Latest kickoff_time across a gameweek's fixtures, or null if the fixtures
 * fetch fails or none have a kickoff_time yet.
 */
export async function getLatestKickoffForGameweek(gw: number): Promise<Date | null> {
    try {
        const res = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${gw}`, {
            next: { revalidate: 0 },
            headers: { 'User-Agent': 'FantasyFutbol/1.0' },
        });
        if (!res.ok) return null;
        const fixtures = (await res.json()) as { kickoff_time: string | null }[];
        const kickoffs = fixtures
            .map(f => f.kickoff_time)
            .filter((t): t is string => !!t)
            .map(t => new Date(t).getTime());
        if (kickoffs.length === 0) return null;
        return new Date(Math.max(...kickoffs));
    } catch {
        return null;
    }
}

/**
 * True once FINISHED_PROVISIONAL_GRACE_MINUTES have passed since the
 * gameweek's last kickoff. Callers only need this once a GW is
 * finished_provisional but not yet finished — see the constant's doc for
 * why both the sync gate and the lock gate must use it identically.
 *
 * Fails "open" (false — i.e. keep treating the GW as settling) if the
 * fixtures fetch fails, so a transient FPL API error can't fast-track a
 * lock past data the sync never actually got a chance to refresh.
 */
export async function isFinishedProvisionalGraceElapsed(gw: number): Promise<boolean> {
    const latestKickoff = await getLatestKickoffForGameweek(gw);
    if (!latestKickoff) return false;
    const minutesSinceKickoff = (Date.now() - latestKickoff.getTime()) / 60000;
    return minutesSinceKickoff >= FINISHED_PROVISIONAL_GRACE_MINUTES;
}
