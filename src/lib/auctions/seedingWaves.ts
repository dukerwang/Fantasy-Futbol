/**
 * Gaffa — staggered elite-tier release at season kickoff
 *
 * Kickoff used to open an auction for every unowned player at or above the
 * elite threshold simultaneously. In a 6-team league that is 14-25 live
 * auctions against six managers, so nobody had to outbid anyone and every
 * price settled on the floor.
 *
 * Releasing in waves forces managers onto the same targets, which is the only
 * thing that pushes a price past market value — a floor can only guarantee a
 * minimum. Descending by market value puts the marquee names out first, while
 * every manager still holds a full budget, which is where competition should
 * peak. Later waves meet depleted budgets and clear cheaper, which is the
 * correct structure: the best players command premiums and the rest do not. It
 * also matches how a real window unfolds, with the biggest business early.
 *
 * Only the elite tier is staggered. Promoted-club players are numerous (50-70)
 * and cheap, are not the scarcity problem, and holding them back would block
 * routine roster building. Mid-season arrivals need no staggering either — the
 * nightly sweep already surfaces them one or two at a time.
 *
 * Design doc: docs/superpowers/specs/2026-07-30-transfer-market-pricing-design.md
 */

/** Gap between waves. Matches the 72h initial window, so a wave has largely resolved before the next lands. */
export const WAVE_INTERVAL_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * Players per wave: about half the league, so roughly two managers are chasing
 * each live elite auction whatever the league size. Never below 2 — a
 * single-player wave is a monopoly, not an auction.
 */
export function waveSizeForLeague(teamCount: number): number {
    const half = Math.round((Number.isFinite(teamCount) ? teamCount : 0) / 2);
    return Math.max(2, half);
}

/**
 * Sort candidates by descending market value and assign each a release time.
 * The first wave gets `null`, meaning "open immediately" — the same value every
 * non-kickoff seeding path writes.
 *
 * Does not mutate the input.
 */
export function assignReleaseWaves<T extends { marketValue: number }>(
    candidates: T[],
    teamCount: number,
    startMs: number,
): (T & { opensAtMs: number | null })[] {
    const size = waveSizeForLeague(teamCount);
    return [...candidates]
        .sort((a, b) => b.marketValue - a.marketValue)
        .map((c, i) => {
            const wave = Math.floor(i / size);
            return { ...c, opensAtMs: wave === 0 ? null : startMs + wave * WAVE_INTERVAL_MS };
        });
}
