/**
 * Gaffa — Transfer Recirculation (Solidarity + Scout's Fee)
 *
 * A winning free-agent bid, a drop severance fee and the loan slot buyback
 * were all previously destroyed outright — migration 060 comments the buyback
 * as "Deduct and burn fee". That made every large signing remove liquidity
 * from the league permanently, which is why a big transfer felt unrecoverable:
 * your squad is only sellable if somebody else still holds cash.
 *
 * This splits a share of the burned amount back into the league:
 *   - `share` of the amount forms a pool (default 20%).
 *   - `scoutShare` of that pool goes to the auction initiator (default 50%),
 *     so the scout receives 10% of the bid, uncapped.
 *   - The rest of the pool is split equally among the other non-winners.
 *   - Everything left burns, so a genuine drain survives.
 *
 * Football does this twice over: FIFA's solidarity mechanism distributes a
 * slice of every transfer fee to a player's former clubs, and the Premier
 * League's central pot is largely an equal share.
 *
 * Why 20% and not more: after this change free-agent bids are the ONLY
 * remaining sink, so `share` sets the league-wide signing spend needed to
 * break even — EUR 149m per team at 20%, EUR 178m at 33%, which no realistic
 * season reaches. 20% is close to the ceiling.
 *
 * This is the reference implementation. Migration 093 reimplements the same
 * arithmetic in PL/pgSQL, because the money must move atomically inside the
 * auction resolver. The tests beside this file are what keep the two honest —
 * change one and you must change the other.
 *
 * Design doc: docs/superpowers/specs/2026-07-29-economy-rebalance-design.md
 */

/** Fraction of a burned amount that returns to the league. */
export const DEFAULT_SOLIDARITY_SHARE = 0.20;

/** Fraction OF THE POOL paid to the auction initiator. */
export const DEFAULT_SCOUT_SHARE = 0.50;

export interface SolidarityRates {
    share: number;
    scoutShare: number;
}

export interface SolidarityDistribution {
    /** Total returned to the league, before splitting. */
    pool: number;
    /** Paid to the auction initiator. Zero when there is no eligible scout. */
    scout: number;
    /** Paid to EACH of the other non-winning clubs. */
    perOtherClub: number;
    /** How many clubs receive `perOtherClub`. */
    otherClubCount: number;
    /** Destroyed: the un-recirculated share plus any rounding remainder. */
    burned: number;
}

/**
 * @param amount      The sum being taken from a club (winning bid, severance, buyback fee).
 * @param totalClubs  Number of clubs in the league, including the payer.
 * @param hasScout    True when an auction initiator exists AND is not the winner.
 *                    A Buy Now with no prior manager bid, or an auction the
 *                    initiator went on to win, both pass false.
 */
export function computeSolidarity(
    amount: number,
    totalClubs: number,
    hasScout: boolean,
    rates: SolidarityRates = { share: DEFAULT_SOLIDARITY_SHARE, scoutShare: DEFAULT_SCOUT_SHARE },
): SolidarityDistribution {
    if (!Number.isFinite(amount) || amount < 0) {
        throw new Error(`computeSolidarity: amount must be >= 0, got ${amount}`);
    }

    const pool = Math.floor(amount * rates.share);
    const scout = hasScout ? Math.floor(pool * rates.scoutShare) : 0;

    // The payer is always excluded. The scout, when there is one, is paid
    // separately and so is excluded from the equal split too.
    const otherClubCount = Math.max(0, totalClubs - (hasScout ? 2 : 1));
    const perOtherClub = otherClubCount > 0 ? Math.floor((pool - scout) / otherClubCount) : 0;

    const handedOut = scout + perOtherClub * otherClubCount;
    return { pool, scout, perOtherClub, otherClubCount, burned: amount - handedOut };
}
