/**
 * Notification copy — transfer-news voice, not system alerts.
 *
 * Clubs take a plural verb throughout, matching describeDeal / hereWeGo
 * ("Arsenal have bid", not "Arsenal has bid"). Titles and push titles use
 * the club abbreviation when space is tight; bodies use the full name so
 * the actor is never anonymous.
 *
 * Actionable Gaffa state (auction open, time left, waiting on you) lives in
 * a short trailing clause. Push bodies are a separate one-liner — iOS shows
 * roughly two lines and appends " from Gaffa" to the title.
 */
import { clubAbbr, clubName, type ClubRef } from '@/lib/notifications/clubRef';

export type Notice = {
  title: string;
  pushTitle: string;
  content: string;
  pushBody: string;
};

export type ExpiresAt = string | Date | number | null | undefined;

function euro(n: number): string {
  return `€${n}m`;
}

/**
 * Coarse remaining time for a banner. Hours below a day and a half, days
 * after that — the auction timer is hour-native (24h floor, 72h window) but
 * "3d left" fits a push line where "72h left" does not.
 */
export function timeLeft(expiresAt: ExpiresAt, now = Date.now()): string | null {
  if (expiresAt == null || expiresAt === '') return null;
  const t = typeof expiresAt === 'number' ? expiresAt : Date.parse(String(expiresAt));
  if (!Number.isFinite(t)) return null;
  const ms = t - now;
  if (ms <= 0) return null;
  const mins = Math.round(ms / 60_000);
  if (mins < 2) return 'closing now';
  if (mins < 90) return `${mins}m left`;
  const hours = Math.round(mins / 60);
  if (hours < 36) return `${hours}h left`;
  return `${Math.round(hours / 24)}d left`;
}

export function bidPlacedNotice(
  bidder: ClubRef,
  playerName: string,
  amount: number,
  expiresAt?: ExpiresAt,
): Notice {
  const name = clubName(bidder);
  const abbr = clubAbbr(bidder);
  const left = timeLeft(expiresAt);
  const clock = left ? ` Auction open — ${left}.` : ' Auction now open.';
  const headline = `${abbr} bid for ${playerName}`;
  return {
    title: headline,
    // Same as inbox title — "CFC €50m" alone reads like a stock ticker on the lock screen.
    pushTitle: headline,
    content: `**${name}** have bid **${euro(amount)}** for **${playerName}**.${clock}`,
    pushBody: left
      ? `${euro(amount)} · auction open, ${left}`
      : `${euro(amount)} · auction now open`,
  };
}

export function outbidNotice(
  bidder: ClubRef,
  playerName: string,
  amount: number,
  expiresAt?: ExpiresAt,
): Notice {
  const name = clubName(bidder);
  const abbr = clubAbbr(bidder);
  const left = timeLeft(expiresAt);
  const action = left
    ? left === 'closing now'
      ? 'Closing now. Bid to take the lead.'
      : `${left} to bid.`
    : 'Bid again to take the lead.';
  return {
    title: `Outbid by ${abbr}`,
    pushTitle: `Outbid · ${abbr}`,
    content: `**${name}** have gone to **${euro(amount)}** for **${playerName}**. ${action}`,
    pushBody: left
      ? left === 'closing now'
        ? `${playerName} now ${euro(amount)}. Closing now.`
        : `${playerName} now ${euro(amount)}. ${left} to bid.`
      : `${playerName} now ${euro(amount)}. Bid to take the lead.`,
  };
}

export function listedNotice(
  seller: ClubRef,
  playerName: string,
  priceLine: string,
  opts?: { expiresAt?: ExpiresAt; auctionOpen?: boolean },
): Notice {
  const name = clubName(seller);
  const abbr = clubAbbr(seller);
  const left = opts?.auctionOpen ? timeLeft(opts.expiresAt) : null;
  const clock = opts?.auctionOpen
    ? left
      ? ` Auction open — ${left}.`
      : ' Auction now open.'
    : '';
  const headline = `${abbr} list ${playerName}`;
  return {
    title: headline,
    pushTitle: headline,
    content: `**${name}** have listed **${playerName}** for sale${priceLine}.${clock}`,
    pushBody: left
      ? `${playerName} listed. ${left} to bid.`
      : `${playerName} is listed.`,
  };
}

export function droppedNotice(club: ClubRef, playerName: string, expiresAt?: ExpiresAt): Notice {
  const name = clubName(club);
  const abbr = clubAbbr(club);
  const left = timeLeft(expiresAt);
  const clock = left ? `Auction open — ${left}.` : 'A 72-hour auction is now open.';
  const headline = `${abbr} release ${playerName}`;
  return {
    title: headline,
    pushTitle: headline,
    content: `**${name}** have released **${playerName}** into the auction pool. ${clock}`,
    pushBody: left
      ? `${playerName} in auction. ${left} to bid.`
      : `${playerName} in auction. Bid now.`,
  };
}

export function auctionLostNotice(
  winner: ClubRef,
  playerName: string,
  winnerBid: number,
  yourBid: number,
): Notice {
  const name = clubName(winner);
  const abbr = clubAbbr(winner);
  return {
    title: `Lost to ${abbr}`,
    pushTitle: `Lost to ${abbr}`,
    content: `**${name}** signed **${playerName}** for **${euro(winnerBid)}**. Your bid of **${euro(yourBid)}** wasn't enough.`,
    pushBody: `${playerName} to ${abbr} for ${euro(winnerBid)}.`,
  };
}
