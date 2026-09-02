/**
 * src/lib/players/playerMapping.ts
 *
 * Checks whether a player has completed ingestion and mapping from both
 * external reference sources:
 * 1. SoFIFA (position mapping & tactical taxonomy)
 * 2. Transfermarkt (market valuation & pricing)
 *
 * A brand-new Premier League arrival holds "N/A" for both position and value
 * until both sources have mapped him.
 */

import { FPL_POSITION_OVERRIDES } from '@/lib/fpl/positionMap';

export interface PlayerMappingFields {
  name?: string | null;
  web_name?: string | null;
  primary_position?: string | null;
  secondary_positions?: string[] | null;
  market_value?: number | null;
  market_value_updated_at?: string | null;
  sofifa_common_name?: string | null;
  transfermarkt_id?: string | null;
}

/**
 * Does this player have an explicitly curated FPL position override?
 */
export function hasCuratedPositionOverride(player: PlayerMappingFields): boolean {
  const full = (player.name ?? '').toLowerCase().trim();
  const web = (player.web_name ?? '').toLowerCase().trim();
  return (
    (!!full && Object.prototype.hasOwnProperty.call(FPL_POSITION_OVERRIDES, full)) ||
    (!!web && Object.prototype.hasOwnProperty.call(FPL_POSITION_OVERRIDES, web))
  );
}

/**
 * Has this player been position-mapped by SoFIFA (or has an explicit override)?
 */
export function isPlayerPositionMapped(player: PlayerMappingFields): boolean {
  if (!player.primary_position) return false;
  // If player has a verified SoFIFA common name or a curated override, they are position-mapped.
  if (player.sofifa_common_name != null && player.sofifa_common_name.trim().length > 0) return true;
  if (hasCuratedPositionOverride(player)) return true;
  // If they have secondary positions populated, that also comes strictly from SoFIFA.
  if (player.secondary_positions && player.secondary_positions.length > 0) return true;
  return false;
}

/**
 * Has this player received a real Transfermarkt market valuation?
 */
export function isPlayerValueMapped(player: PlayerMappingFields): boolean {
  return (
    player.market_value != null &&
    Number(player.market_value) > 0 &&
    player.market_value_updated_at != null
  );
}

/**
 * Is this player fully synced across both SoFIFA and Transfermarkt?
 */
export function isPlayerMapped(player: PlayerMappingFields): boolean {
  return isPlayerPositionMapped(player) && isPlayerValueMapped(player);
}
