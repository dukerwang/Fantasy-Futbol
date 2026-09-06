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
import { roleArticle } from '@/lib/scoring/perfBand';
import { getValueTier } from '@/lib/notifications/valueTiers';
import { buildHereWeGo, pushTitleForEyebrow } from '@/lib/notifications/hereWeGo';

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
    pushTitle: headline,
    content: `**${name}** have bid **${euro(amount)}** for **${playerName}**.${clock}`,
    pushBody: left
      ? `${abbr} bid ${euro(amount)} for ${playerName}. Auction open, ${left}.`
      : `${abbr} bid ${euro(amount)} for ${playerName}. Auction open.`,
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
        ? `${abbr} outbid you on ${playerName} at ${euro(amount)}. Closing now. Bid to lead.`
        : `${abbr} outbid you on ${playerName} at ${euro(amount)}. ${left} to bid.`
      : `${abbr} outbid you on ${playerName} at ${euro(amount)}. Bid to lead.`,
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
        ? `${abbr} raised the top bid on ${playerName} to ${euro(amount)}. Closing now.`
        : `${abbr} raised the top bid on ${playerName} to ${euro(amount)}. ${left} to bid.`
      : `${abbr} raised the top bid on ${playerName} to ${euro(amount)}. Bid to lead.`,
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
      ? `${playerName} is listed by ${abbr}. ${left} to bid.`
      : `${playerName} is listed by ${abbr}.`,
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
      ? `${abbr} released ${playerName}. Auction open — ${left}.`
      : `${abbr} released ${playerName}. 72h open auction started.`,
  };
}

export function auctionLostNotice(
  winner: ClubRef,
  playerName: string,
  winnerBid: number,
  yourBid: number,
  marketValue?: number | null,
): Notice {
  const name = clubName(winner);
  const abbr = clubAbbr(winner);
  const tierValue = Math.max(winnerBid, Number(marketValue || 0));

  const detailPlain = `${playerName} to ${abbr} for ${euro(winnerBid)}`;
  const detailMd = `**${playerName}** to **${name}** for **${euro(winnerBid)}**`;

  const { lead: pushBody } = buildHereWeGo('signing', detailPlain, tierValue);
  const { eyebrow, lead: contentLead } = buildHereWeGo('signing', detailMd, tierValue);

  return {
    title: `Lost to ${abbr}`,
    pushTitle: pushTitleForEyebrow(eyebrow, `Lost to ${abbr}`),
    content: `${contentLead} Your bid was **${euro(yourBid)}**.`,
    pushBody,
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
  const timeClause = left ? (left === 'closing now' ? 'Closing now' : `${left} to bid`) : 'Final call to bid';

  if (tier === 'galactico') {
    return {
      title: `ADVANCING: ${abbr} closing in on ${playerName}`,
      pushTitle: `ADVANCING: ${playerName} · ${abbr}`,
      content: `**BREAKING:** **${name}** are in advanced stages to complete a marquee deal for **${playerName}** (**${euro(amount)}**). ${left ? `${left} on the open market` : 'Final hours'} before the agreement is sealed.`,
      pushBody: `ADVANCING: ${playerName} to ${abbr} (${euro(amount)}). ${timeClause}!`,
    };
  }

  if (tier === 'blockbuster') {
    return {
      title: `Closing in: ${abbr} on verge of ${playerName}`,
      pushTitle: `Closing in: ${playerName} · ${abbr}`,
      content: `**${name}** are closing in on a blockbuster agreement for **${playerName}** at **${euro(amount)}**. ${left ? `${left} to submit` : 'Final hours to submit'} a competing offer.`,
      pushBody: `Closing in: ${abbr} lead for ${playerName} at ${euro(amount)}. ${timeClause}!`,
    };
  }

  return {
    title: `${abbr} closing in on ${playerName}`,
    pushTitle: `${abbr} closing in on ${playerName}`,
    content: `**${name}** lead the race for **${playerName}** at **${euro(amount)}**. ${left ? `${left} before` : 'Final countdown before'} the gavel falls.`,
    pushBody: `Closing in: ${abbr} lead for ${playerName} at ${euro(amount)}. ${timeClause}.`,
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
      pushBody: `BREAKING: ${playerName} to ${abbr} (${euro(amount)}). Release clause triggered... HERE WE GO!`,
    };
  }

  if (tier === 'blockbuster') {
    return {
      title: `Blockbuster! ${abbr} trigger release clause for ${playerName}`,
      pushTitle: `Blockbuster!`,
      content: `**${name}** have triggered the **${euro(amount)}** release clause for **${playerName}**! Agreement sealed, HERE WE GO!`,
      pushBody: `Blockbuster: ${playerName} to ${abbr} (${euro(amount)}). Release clause triggered, HERE WE GO!`,
    };
  }

  return {
    title: `${abbr} buy out ${playerName}`,
    pushTitle: `${abbr} buy out ${playerName}`,
    content: `**${name}** have triggered the **${euro(amount)}** buyout for **${playerName}**. Agreement completed, here we go!`,
    pushBody: `${playerName} to ${abbr} for ${euro(amount)} buyout, here we go!`,
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
    pushBody: `${playerName}'s loan at ${clubAbbr(borrower)} ends after GW${endGw}.`,
  };
}


// ── Targets (153) ─────────────────────────────────────────────
//
// The demand side. `listedNotice` above tells the whole league a player is
// available; these tell the specific clubs who said they wanted him, which is
// a different reader and deserves a different sentence. All four keep the
// transfer-news voice and the plural club verb.

/** A player somebody named as a target has become gettable. */
export function targetAvailableNotice(
  seller: ClubRef,
  playerName: string,
  opts?: { expiresAt?: ExpiresAt; auctionOpen?: boolean },
): Notice {
  const name = clubName(seller);
  const left = opts?.auctionOpen ? timeLeft(opts.expiresAt) : null;
  const clock = left ? ` Bidding is open, ${left} left.` : '';
  return {
    title: `${playerName} is available`,
    pushTitle: `${playerName} is available`,
    content: `**${name}** have listed **${playerName}**, one of your targets.${clock}`,
    pushBody: left
      ? `${playerName} is listed. ${left} to bid.`
      : `${playerName}, one of your targets, is listed.`,
  };
}

/**
 * A player matching a POSITION somebody is looking for has become gettable.
 * Named separately from the notice above because "a left-back has hit the
 * market" is a weaker claim than "the player you asked for is available", and
 * flattening the two would cry wolf on every squad-filler at that position.
 */
export function targetProfileMatchNotice(
  seller: ClubRef,
  playerName: string,
  position: string,
  opts?: { expiresAt?: ExpiresAt; auctionOpen?: boolean },
): Notice {
  const name = clubName(seller);
  const left = opts?.auctionOpen ? timeLeft(opts.expiresAt) : null;
  const clock = left ? ` Bidding is open, ${left} left.` : '';

  // "a left-back", not "a LB". The phrase (article included) comes from
  // roleArticle so this reads identically to the player card and the matchup
  // breakdown, and so nobody has to remember that "an LB" takes "an".
  const role = roleArticle(position);
  const Role = role.charAt(0).toUpperCase() + role.slice(1);

  return {
    title: `${Role} has hit the market`,
    pushTitle: `${Role} is available`,
    content: `**${name}** have listed **${playerName}**. You're looking for ${role}.${clock}`,
    pushBody: left
      ? `${playerName} is listed. ${left} to bid.`
      : `${playerName} is listed. You're looking for ${role}.`,
  };
}

/**
 * Somebody has publicly named YOUR player as a target.
 *
 * The demand-side counterpart of `listedNotice`, and the message most likely
 * to start a deal. Only public, named targets reach here — a private target
 * tells nobody, and a positional profile would spam every club that owns one.
 */
export function targetDeclaredNotice(
  suitor: ClubRef,
  playerName: string,
  stanceLine: string,
): Notice {
  const name = clubName(suitor);
  const abbr = clubAbbr(suitor);
  const stance = stanceLine ? ` ${stanceLine}.` : '';
  return {
    title: `${abbr} want ${playerName}`,
    pushTitle: `${abbr} want ${playerName}`,
    content: `**${name}** have made **${playerName}** a target.${stance}`,
    pushBody: `${name} want your player ${playerName}.`,
  };
}

/**
 * Both sides have already said yes to talking: this club listed the player,
 * that club was targeting him. Worth more than a badge — nobody has to be
 * talked into the conversation.
 */
export function targetTwoSidedNotice(
  other: ClubRef,
  playerName: string,
  stanceLine: string,
  side: 'seller' | 'suitor',
): Notice {
  const name = clubName(other);
  const abbr = clubAbbr(other);
  const stance = stanceLine ? ` ${stanceLine}.` : '';

  if (side === 'seller') {
    return {
      title: `${abbr} want a player you've listed`,
      pushTitle: `${abbr} want ${playerName}`,
      content: `You've listed **${playerName}** and **${name}** are targeting him.${stance}`,
      pushBody: `${name} are targeting ${playerName}, who you've listed.`,
    };
  }

  return {
    title: `${playerName} is listed — and you want him`,
    pushTitle: `${playerName} is listed`,
    content: `**${name}** have listed **${playerName}**, one of your targets.${stance}`,
    pushBody: `${playerName}, one of your targets, is listed by ${name}.`,
  };
}
