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
import { getValueTier } from '@/lib/notifications/valueTiers';

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
    pushTitle: `Outbid on ${playerName} by ${abbr}`,
    content: `**${name}** have gone to **${euro(amount)}** for **${playerName}**. ${action}`,
    pushBody: left
      ? left === 'closing now'
        ? `${playerName} now ${euro(amount)}. Closing now.`
        : `${playerName} now ${euro(amount)}. ${left} to bid.`
      : `${playerName} now ${euro(amount)}. Bid to take the lead.`,
  };
}

export function bidRaisedNotice(
  bidder: ClubRef,
  playerName: string,
  amount: number,
  yourBid?: number | null,
  expiresAt?: ExpiresAt,
): Notice {
  const name = clubName(bidder);
  const abbr = clubAbbr(bidder);
  const left = timeLeft(expiresAt);
  const action = left
    ? left === 'closing now'
      ? 'Closing now. Bid to take the lead.'
      : `${left} to bid.`
    : 'Bid to take the lead.';
  const yourBidClause = yourBid ? ` (your bid: **${euro(yourBid)}**)` : '';
  return {
    title: `${abbr} raise to ${euro(amount)} for ${playerName}`,
    pushTitle: `${abbr} raise on ${playerName}`,
    content: `**${name}** have raised the top bid for **${playerName}** to **${euro(amount)}**${yourBidClause}. ${action}`,
    pushBody: left
      ? left === 'closing now'
        ? `${playerName} top bid ${euro(amount)} (${abbr}). Closing now.`
        : `${playerName} top bid ${euro(amount)} (${abbr}). ${left} to bid.`
      : `${playerName} top bid ${euro(amount)} (${abbr}). Bid to lead.`,
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

export function closingInNotice(
  leader: ClubRef,
  playerName: string,
  amount: number,
  marketValue?: number | null,
  expiresAt?: ExpiresAt,
): Notice {
  const name = clubName(leader);
  const abbr = clubAbbr(leader);
  const left = timeLeft(expiresAt);
  const tier = getValueTier(Math.max(amount, Number(marketValue || 0)));

  if (tier === 'galactico') {
    return {
      title: `ADVANCING: ${abbr} closing in on ${playerName}`,
      pushTitle: `ADVANCING: ${playerName} · ${abbr}`,
      content: `**BREAKING:** **${name}** are in advanced stages to complete a marquee deal for **${playerName}** (**${euro(amount)}**). ${left ? `${left} on the open market` : 'Final hours'} before the agreement is sealed.`,
      pushBody: `ADVANCING: ${playerName} to ${abbr} (${euro(amount)}). Final call to bid.`,
    };
  }

  if (tier === 'blockbuster') {
    return {
      title: `Closing in: ${abbr} on verge of ${playerName}`,
      pushTitle: `Closing in: ${playerName} · ${abbr}`,
      content: `**${name}** are closing in on a blockbuster agreement for **${playerName}** at **${euro(amount)}**. ${left ? `${left} to submit` : 'Final hours to submit'} a competing offer.`,
      pushBody: `${abbr} closing in on ${playerName} (${euro(amount)}). Final call to bid.`,
    };
  }

  return {
    title: `${abbr} closing in on ${playerName}`,
    pushTitle: `${abbr} closing in on ${playerName}`,
    content: `**${name}** lead the race for **${playerName}** at **${euro(amount)}**. ${left ? `${left} before` : 'Final countdown before'} the gavel falls.`,
    pushBody: `${playerName} to ${abbr} (${euro(amount)}). Gavel falling soon.`,
  };
}

export function buyNowTriggeredNotice(
  buyer: ClubRef,
  playerName: string,
  amount: number,
  marketValue?: number | null,
): Notice {
  const name = clubName(buyer);
  const abbr = clubAbbr(buyer);
  const tier = getValueTier(Math.max(amount, Number(marketValue || 0)));

  if (tier === 'galactico') {
    return {
      title: `Galactico! ${abbr} trigger release clause for ${playerName}`,
      pushTitle: `Galactico!`,
      content: `**BREAKING:** **${name}** have triggered the **${euro(amount)}** release clause for **${playerName}**! Direct agreement completed... HERE WE GO!`,
      pushBody: `BREAKING: ${playerName} to ${abbr} (${euro(amount)}). Release clause triggered.`,
    };
  }

  if (tier === 'blockbuster') {
    return {
      title: `Blockbuster! ${abbr} trigger release clause for ${playerName}`,
      pushTitle: `Blockbuster!`,
      content: `**${name}** have triggered the **${euro(amount)}** release clause for **${playerName}**! Agreement sealed, HERE WE GO!`,
      pushBody: `Blockbuster: ${playerName} to ${abbr} (${euro(amount)}). Release clause triggered.`,
    };
  }

  return {
    title: `${abbr} buy out ${playerName}`,
    pushTitle: `${abbr} buy out ${playerName}`,
    content: `**${name}** have triggered the **${euro(amount)}** buyout for **${playerName}**. Agreement completed, here we go!`,
    pushBody: `${playerName} to ${abbr} for ${euro(amount)}.`,
  };
}

export function tradeCancelledByAuctionNotice(playerName: string): Notice {
  return {
    title: `Trade for ${playerName} called off`,
    pushTitle: `Trade called off`,
    content: `**${playerName}** has gone into an open auction on the market, so this trade is off.`,
    pushBody: `${playerName} went to auction — the trade is off.`,
  };
}

export function listingUnsoldNotice(playerName: string): Notice {
  return {
    title: `Listing for ${playerName} expired`,
    pushTitle: `Listing expired`,
    content: `No one bid on **${playerName}** before the listing closed. He stays on your squad.`,
    pushBody: `No bids for ${playerName} — listing closed.`,
  };
}

export function loanFinalWeekNotice(
  playerName: string,
  lender: ClubRef,
  borrower: ClubRef,
  endGw: number,
): Notice {
  return {
    title: `${playerName}'s loan enters its final week`,
    pushTitle: `Loan entering final week`,
    content: `**${playerName}** is entering the final matchweek (GW${endGw}) of their loan spell at **${clubName(borrower)}** before returning to **${clubName(lender)}**.`,
    pushBody: `${playerName} loan at ${clubAbbr(borrower)} ends after GW${endGw}.`,
  };
}

