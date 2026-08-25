/**
 * Notification copy — transfer-news voice, not system alerts.
 *
 * Clubs take a plural verb throughout, matching describeDeal / hereWeGo
 * ("Arsenal have bid", not "Arsenal has bid"). Titles and push titles use
 * the club abbreviation when space is tight; bodies use the full name so
 * the actor is never anonymous.
 */
import { clubAbbr, clubName, type ClubRef } from '@/lib/notifications/clubRef';

export type Notice = {
  title: string;
  pushTitle: string;
  content: string;
};

function euro(n: number): string {
  return `€${n}m`;
}

export function bidPlacedNotice(bidder: ClubRef, playerName: string, amount: number): Notice {
  const name = clubName(bidder);
  const abbr = clubAbbr(bidder);
  return {
    title: `${abbr} bid for ${playerName}`,
    pushTitle: `${abbr} ${euro(amount)}`,
    content: `**${name}** have bid **${euro(amount)}** for **${playerName}**.`,
  };
}

export function outbidNotice(bidder: ClubRef, playerName: string, amount: number): Notice {
  const name = clubName(bidder);
  const abbr = clubAbbr(bidder);
  return {
    title: `Outbid by ${abbr}`,
    pushTitle: `Outbid · ${abbr}`,
    content: `**${name}** have gone to **${euro(amount)}** for **${playerName}**. You no longer hold the high bid.`,
  };
}

export function listedNotice(seller: ClubRef, playerName: string, priceLine: string): Notice {
  const name = clubName(seller);
  const abbr = clubAbbr(seller);
  return {
    title: `${abbr} list ${playerName}`,
    pushTitle: `${abbr} listed`,
    content: `**${name}** have listed **${playerName}** for sale${priceLine}.`,
  };
}

export function droppedNotice(club: ClubRef, playerName: string): Notice {
  const name = clubName(club);
  const abbr = clubAbbr(club);
  return {
    title: `${abbr} release ${playerName}`,
    pushTitle: `${abbr} released`,
    content: `**${name}** have released **${playerName}** into the auction pool. A 72-hour auction is now open.`,
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
  };
}
