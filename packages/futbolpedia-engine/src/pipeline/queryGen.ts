import type { OutlookContextBag } from '../types/outlook';

/**
 * Deterministic search vectors for a named player — mirrors Futbolpedia's
 * skip-query-gen optimization for profile requests (no extra LLM call).
 */
export function buildOutlookSearchQueries(bag: OutlookContextBag): string[] {
  const player = bag.display_name;
  const club = bag.club;
  const season = bag.current_season;
  const year = bag.simulation_date.slice(0, 4);

  return [
    `${player} ${club} injury availability fitness ${season} latest news`,
    `${player} ${club} role minutes set pieces squad position ${season}`,
    `${club} head coach manager appointment ${year} ${season} current`,
    `${player} ${club} transfer exit leave join Premier League ${season} ${year}`,
  ];
}
