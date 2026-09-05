/**
 * Summarizes a trade proposal or counter-offer for a mobile push notification banner.
 *
 * Rules:
 * - 1 or 2 assets on a side are named explicitly (e.g. "Cole Palmer and €20m").
 * - 3 or more players on a side lead with the first player + count (e.g. "Cole Palmer + 2 players").
 * - Counter offers lead with "[Club] countered: ...".
 * - Fits within mobile lock-screen limits (~110 characters).
 */

export interface TradePushParams {
  proposerAbbr: string;
  offeredPlayerNames: string[];
  requestedPlayerNames: string[];
  offeredFaab?: number;
  requestedFaab?: number;
  offeredRightsCount?: number;
  requestedRightsCount?: number;
  isCounter?: boolean;
}

function formatSide(players: string[], faab = 0, rightsCount = 0): string {
  const parts: string[] = [];

  if (players.length > 0) {
    if (players.length <= 2) {
      parts.push(players.join(' and '));
    } else {
      parts.push(`${players[0]} + ${players.length - 1} players`);
    }
  }

  if (rightsCount > 0) {
    parts.push(rightsCount === 1 ? '1 retained right' : `${rightsCount} retained rights`);
  }

  if (faab > 0) {
    parts.push(`€${faab}m`);
  }

  if (parts.length === 0) return 'nothing';
  if (parts.length === 1) return parts[0];
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

export function summarizeTradeForPush(params: TradePushParams): string {
  const {
    proposerAbbr,
    offeredPlayerNames,
    requestedPlayerNames,
    offeredFaab = 0,
    requestedFaab = 0,
    offeredRightsCount = 0,
    requestedRightsCount = 0,
    isCounter = false,
  } = params;

  const offeredStr = formatSide(offeredPlayerNames, offeredFaab, offeredRightsCount);
  const requestedStr = formatSide(requestedPlayerNames, requestedFaab, requestedRightsCount);

  if (isCounter) {
    return `${proposerAbbr} countered: ${offeredStr} for ${requestedStr}.`;
  }

  return `${proposerAbbr} offered ${offeredStr} for ${requestedStr}.`;
}
