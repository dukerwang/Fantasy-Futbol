import type { OutlookContextBag } from '../types/outlook';

/**
 * Deterministic search vectors — no LLM call to generate them.
 *
 * Every query here becomes its own Google-Search-grounded request, and grounded
 * requests are billed per request and dominate the cost of a run. The original
 * four per player worked out at 1,728 grounded calls for a 432-player regen.
 *
 * Two changes halve that with nothing lost:
 *
 * 1. Availability and transfer news were separate queries asking the same
 *    corner of the web about the same player. They are one query now.
 * 2. The head-coach query is about the CLUB, not the player — it was identical
 *    for every Chelsea player and ran once per player anyway, roughly 412
 *    redundant grounded calls per full run. It is split out so a batch can
 *    resolve it once per club.
 */

/** Player-specific vectors. One grounded request each. */
export function buildOutlookPlayerQueries(bag: OutlookContextBag): string[] {
  const player = bag.display_name;
  const club = bag.club;
  const season = bag.current_season;
  const year = bag.simulation_date.slice(0, 4);

  return [
    `${player} ${club} injury availability fitness transfer exit ${season} ${year} latest news`,
    `${player} ${club} role minutes set pieces squad position tactical ${season}`,
  ];
}

/**
 * Club context — the same answer for every player at the club, so a batch
 * should resolve it once and reuse it. Keyed on club name.
 */
export function buildClubContextQuery(bag: OutlookContextBag): string {
  const year = bag.simulation_date.slice(0, 4);
  return `${bag.club} head coach manager appointment ${year} ${bag.current_season} current`;
}

/**
 * @deprecated Use buildOutlookPlayerQueries plus buildClubContextQuery, which
 * lets the club query be shared. Kept so a caller outside this package does not
 * break silently.
 */
export function buildOutlookSearchQueries(bag: OutlookContextBag): string[] {
  return [...buildOutlookPlayerQueries(bag), buildClubContextQuery(bag)];
}
