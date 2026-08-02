// HTML Email Templates for Gaffa

import { getValueTier, TIER_COPY } from '@/lib/notifications/valueTiers';
import { buildHereWeGo } from '@/lib/notifications/hereWeGo';

/** Thin gold rule/text — mirrors the app's --color-gold convention (globals.css):
 *  reserved for standout figures, never a filled badge. */
const GOLD = '#93702F';

const tierEyebrowHtml = (marketValue: number) => {
  const copy = TIER_COPY[getValueTier(marketValue)];
  if (!copy) return '';
  return `<p style="margin: 0 0 4px; font-size: 0.75em; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: ${GOLD};">${copy.eyebrow}</p>`;
};

const baseTemplate = (title: string, body: string) => `
<!DOCTYPE html>
<html>
<head>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; background-color: #F7F3ED; margin: 0; padding: 20px; color: #1a1a1a; }
    .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 8px; padding: 32px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); }
    .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 16px; margin-bottom: 24px; }
    .title { font-family: "Georgia", serif; font-size: 24px; font-weight: bold; margin: 0; color: #1a1a1a; }
    .content { font-size: 16px; line-height: 1.6; }
    .button { display: inline-block; background-color: #1a1a1a; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 24px; }
    .footer { margin-top: 32px; font-size: 12px; color: #666; text-align: center; border-top: 1px solid #eee; padding-top: 16px; }
    ul { list-style-type: none; padding-left: 0; }
    li { background: #F7F3ED; padding: 12px; margin-bottom: 8px; border-radius: 4px; border-left: 4px solid #1a1a1a; }
    .strong { font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1 class="title">${title}</h1>
    </div>
    <div class="content">
      ${body}
    </div>
    <div class="footer">
      Sent by Gaffa — The Dynasty Sports Platform
    </div>
  </div>
</body>
</html>
`;

/** `dealName` is the derived shape of the offer — "A bid", "A part-exchange" —
 *  from `describeDeal`, so the subject line matches what the Deals page will
 *  call the same proposal when they open it. */
export const getTradeProposedEmail = (
  proposerName: string,
  giving: string[],
  receiving: string[],
  leagueUrl: string,
  dealName = 'An offer',
) => {
  const body = `
    <h2 style="font-family: 'Georgia', serif; font-size: 1.5em; margin-top: 0;">${dealName} from ${proposerName}</h2>
    <p>The boardroom is buzzing. <strong>${proposerName}</strong> has put ${dealName.toLowerCase()} on the table for your consideration.</p>

    <div style="display: flex; gap: 20px; margin: 24px 0;">
      <div style="flex: 1; background-color: #F7F3ED; padding: 15px; border-radius: 8px;">
        <p style="font-size: 0.8em; text-transform: uppercase; color: #666; margin-top: 0;">You Receive</p>
        <p style="font-weight: bold; margin-bottom: 0;">${giving.join(', ')}</p>
      </div>
      <div style="flex: 1; background-color: #f0f0f0; padding: 15px; border-radius: 8px;">
        <p style="font-size: 0.8em; text-transform: uppercase; color: #666; margin-top: 0;">You Give Up</p>
        <p style="font-weight: bold; margin-bottom: 0;">${receiving.join(', ')}</p>
      </div>
    </div>

    <p>A response is expected. Review the terms and decide the future of your squad.</p>
    <a href="${leagueUrl}/transfers/deals" class="button">Enter Negotiations</a>
  `;
  return baseTemplate('Formal Trade Proposal Received', body);
};

export const getTradeAcceptedEmail = (params: {
  /** True when this is really a listing purchase (one side paid cash for a listed player), not a genuine two-way trade. */
  isListingSale: boolean;
  /** Buyer when isListingSale, otherwise team A. */
  teamA: string;
  /** Seller when isListingSale, otherwise team B. */
  teamB: string;
  /** Listing sale only — the bought player's name. */
  playerName?: string;
  /** Listing sale only — the price paid. */
  dealAmount?: number;
  /** Genuine trade only — pre-formatted asset lists, e.g. "Sam Rook and €10m" (see formatAssetList). */
  offeredAssets?: string;
  requestedAssets?: string;
  /** Drives tier escalation — the higher of the actual transaction amount and any moved player's real-world market value. */
  tierValue: number;
  /** Deferred until the gameweek ends rather than resolved immediately. */
  pending: boolean;
  leagueUrl: string;
}) => {
  const { isListingSale, teamA, teamB, playerName, dealAmount, offeredAssets, requestedAssets, tierValue, pending, leagueUrl } = params;
  const detail = isListingSale
    ? `<strong>${playerName}</strong> to <strong>${teamA}</strong> for €${dealAmount}m`
    : `<strong>${teamA}</strong> send ${offeredAssets} to <strong>${teamB}</strong> for ${requestedAssets}`;

  const { eyebrow, lead } = buildHereWeGo(isListingSale ? 'signing' : 'trade', detail, tierValue, pending);
  const title = isListingSale ? 'Official: Signing Confirmed' : 'Official: Trade Completed';

  const body = `
    ${eyebrow ? `<p style="margin: 0 0 4px; font-size: 0.75em; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: ${GOLD};">${eyebrow}</p>` : ''}
    <p>${lead}</p>
    <a href="${leagueUrl}/activity" class="button">View League Activity</a>
  `;
  return baseTemplate(title, body);
};

export const getPlayerDroppedEmail = (clubName: string, playerName: string, leagueUrl: string) => {
  const body = `
    <p><strong>${clubName}</strong> has dropped <strong>${playerName}</strong>.</p>
    <p>A 48-hour transfer auction has automatically begun. If you want to claim this player, head to the Free Agency market to place your bid.</p>
    <a href="${leagueUrl}/players" class="button">View Player Market</a>
  `;
  return baseTemplate('Player Dropped to Waivers', body);
};

export const getSystemAuctionsEmail = (
  players: { name: string; value: number }[],
  isSummerKickoff: boolean,
  leagueUrl: string,
  thresholdM: number,
) => {
  const title = isSummerKickoff ? 'The Season Has Begun!' : 'Transfer Window Alert';
  const preamble = isSummerKickoff
    ? `The commissioner has officially started the new season. <strong>${players.length} new players</strong> have been added to the Transfer Auction Block.`
    : `FPL has added <strong>${players.length} new players</strong> to the database who meet the €${thresholdM}m valuation threshold. They have been placed on waivers.`;

  const standard = players.filter((p) => getValueTier(p.value) === 'standard');
  const featured = players
    .filter((p) => getValueTier(p.value) !== 'standard')
    .sort((a, b) => b.value - a.value);

  const featuredHtml = featured
    .map((p) => {
      const copy = TIER_COPY[getValueTier(p.value)]!;
      return `
        <div style="background-color: #fff; padding: 20px; border-radius: 8px; border-left: 4px solid ${GOLD}; margin: 0 0 16px;">
          ${tierEyebrowHtml(p.value)}
          <p style="margin: 0; font-family: 'Georgia', serif; font-size: 1.3em; font-weight: bold;">${p.name}</p>
          <p style="margin: 4px 0 8px; font-size: 1.1em;">€${p.value}m</p>
          <p style="margin: 0; font-size: 0.9em; color: #666;">${copy.description}</p>
        </div>
      `;
    })
    .join('');

  const standardHtml = standard.length
    ? `<ul>${standard.map((p) => `<li>${p.name} (€${p.value}m)</li>`).join('')}</ul>`
    : '';

  const body = `
    <p>${preamble}</p>
    ${featuredHtml}
    ${standardHtml}
    <p>You have 48 hours to place your bids on these players.</p>
    <a href="${leagueUrl}/players" class="button">View Player Market</a>
  `;
  return baseTemplate(title, body);
};

export const getAuctionWonEmail = (
  playerName: string,
  winnerClub: string,
  winningBid: number,
  /** The higher of winningBid and the player's real-world market value — drives tier escalation. */
  tierValue: number,
  bidderCount: number,
  droppedPlayerName: string | null,
  droppedByClub: string | null,
  leagueUrl: string
) => {
  let intensity = 'Uncontested Signing';
  let intensityDesc = 'A straightforward negotiation with no competing interest.';

  if (bidderCount === 2 || bidderCount === 3) {
    intensity = 'Contested Auction';
    intensityDesc = 'Moderate interest from multiple clubs.';
  } else if (bidderCount >= 4) {
    intensity = 'A Bidding War for the Ages';
    intensityDesc = 'The boardroom was a battlefield as multiple teams fought for the signature.';
  }

  const tier = getValueTier(tierValue);
  const sourceInfo = droppedByClub
    ? `previously released by <strong>${droppedByClub}</strong>`
    : 'a new arrival to the league';

  const detail = `<strong>${playerName}</strong> to <strong>${winnerClub}</strong> for €${winningBid}m`;
  const { eyebrow, lead } = buildHereWeGo('signing', detail, tierValue);

  const body = `
    ${eyebrow ? `<p style="margin: 0 0 4px; font-size: 0.75em; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: ${GOLD};">${eyebrow}</p>` : ''}
    <p style="font-family: 'Georgia', serif; font-size: 1.2em; margin-top: 0;">${lead}</p>
    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid ${tier === 'standard' ? '#1a1a1a' : GOLD}; margin: 20px 0;">
      <p style="margin-top: 0; font-size: 0.9em; text-transform: uppercase; color: #666;">Auction Details</p>
      <p><strong>Winning Bid:</strong> €${winningBid}m</p>
      <p style="margin-bottom: 0;"><strong>Atmosphere:</strong> ${intensity}</p>
      <p style="font-size: 0.85em; color: #666; margin-top: 4px;">${intensityDesc} (${bidderCount} active bidder${bidderCount === 1 ? '' : 's'})</p>
    </div>
    <p>The player was ${sourceInfo}.</p>
    ${droppedPlayerName ? `
      <div style="background-color: #F7F3ED; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px dashed #d1d1d1;">
        <p style="margin: 0;"><strong>The Clearing:</strong> To complete the registration, ${winnerClub} has released <strong>${droppedPlayerName}</strong> into the waiver pool.</p>
      </div>
    ` : ''}
    <a href="${leagueUrl}/activity" class="button">Read the Transaction Log</a>
  `;
  return baseTemplate('Official: Auction Concluded', body);
};

export const getPlayerSoldEmail = (
  playerName: string,
  buyerClub: string,
  price: number,
  /** The higher of price and the player's real-world market value — drives tier escalation. */
  tierValue: number,
  leagueUrl: string,
) => {
  const detail = `<strong>${playerName}</strong> to <strong>${buyerClub}</strong> for €${price}m`;
  const { eyebrow, lead } = buildHereWeGo('signing', detail, tierValue);

  const body = `
    ${eyebrow ? `<p style="margin: 0 0 4px; font-size: 0.75em; font-weight: 700; text-transform: uppercase; letter-spacing: 1.5px; color: ${GOLD};">${eyebrow}</p>` : ''}
    <p style="font-family: 'Georgia', serif; font-size: 1.2em; margin-top: 0;">${lead}</p>
    <a href="${leagueUrl}/team" class="button">View Your Team</a>
  `;
  return baseTemplate('Player Sold!', body);
};

export const getOutbidEmail = (playerName: string, currentHighBid: number, leagueUrl: string) => {
  const body = `
    <p>You have been outbid for <strong>${playerName}</strong>.</p>
    <p>The current high bid is now <strong>€${currentHighBid}m</strong>.</p>
    <p>If you want to stay in the race, you'll need to increase your bid before the auction expires.</p>
    <a href="${leagueUrl}/players" class="button">Return to Auction</a>
  `;
  return baseTemplate('You have been outbid!', body);
};

export const getDraftStartedEmail = (leagueName: string, draftUrl: string) => {
  const body = `
    <p>The commissioner has officially started the draft for <strong>${leagueName}</strong>!</p>
    <p>The Draft Room is now open. Head over immediately to start making your picks.</p>
    <div style="background-color: #F7F3ED; padding: 20px; border-radius: 8px; border: 2px solid #1a1a1a; text-align: center; margin: 24px 0;">
      <p style="font-family: 'Georgia', serif; font-size: 1.2em; font-weight: bold; margin-top: 0;">DRAFT IS LIVE</p>
      <a href="${draftUrl}" class="button" style="margin-top: 0;">Enter Draft Room</a>
    </div>
    <p>Good luck, and may your scouting pay off.</p>
  `;
  return baseTemplate('The Draft is Starting!', body);
};

export const getMatchweekSummaryEmail = (
  leagueName: string,
  gameweek: number,
  results: { teamA: string; scoreA: number; teamB: string; scoreB: number; winner: string | null }[],
  highScorer: { teamName: string; score: number },
  leagueUrl: string
) => {
  const resultsHtml = results.map(r => `
    <div style="border-bottom: 1px solid #e0e0e0; padding: 12px 0; display: flex; justify-content: space-between; align-items: center;">
      <div style="flex: 1; text-align: right; ${r.winner === r.teamA ? 'font-weight: bold;' : ''}">${r.teamA}</div>
      <div style="width: 80px; text-align: center; font-family: 'Courier New', monospace; font-weight: bold;">${r.scoreA} - ${r.scoreB}</div>
      <div style="flex: 1; text-align: left; ${r.winner === r.teamB ? 'font-weight: bold;' : ''}">${r.teamB}</div>
    </div>
  `).join('');

  const body = `
    <p style="text-transform: uppercase; letter-spacing: 2px; font-size: 0.8em; color: #666; margin-bottom: 4px;">Monday Review • Gameweek ${gameweek}</p>
    <h1 style="font-family: 'Georgia', serif; font-size: 2em; margin-top: 0; line-height: 1.1;">${highScorer.teamName} Sets the Pace in ${leagueName}</h1>
    
    <p>The dust has settled on another weekend of action. Here is how your league fared:</p>
    
    <div style="margin: 24px 0; border-top: 2px solid #1a1a1a; border-bottom: 2px solid #1a1a1a; padding: 8px 0;">
      ${resultsHtml}
    </div>

    <div style="background-color: #F7F3ED; padding: 20px; border-radius: 8px; margin: 24px 0;">
      <p style="margin-top: 0; font-weight: bold; text-transform: uppercase; font-size: 0.9em;">Performance of the Week</p>
      <p style="font-size: 1.1em; margin-bottom: 0;"><strong>${highScorer.teamName}</strong> dominated the field with a massive <strong>${highScorer.score.toFixed(1)}</strong> points.</p>
    </div>

    <p style="text-align: center;">
      <a href="${leagueUrl}" class="button">View Full Standings</a>
    </p>
  `;
  return baseTemplate(`GW${gameweek} Summary: ${leagueName}`, body);
};

export const getDraftScheduledEmail = (leagueName: string, scheduledTime: string, lobbyUrl: string) => {
  const body = `
    <p>The commissioner has scheduled the draft for <strong>${leagueName}</strong>!</p>
    <div style="background-color: #F7F3ED; padding: 20px; border-radius: 8px; border: 2px solid #1a1a1a; text-align: center; margin: 24px 0;">
      <p style="font-size: 0.9em; text-transform: uppercase; color: #666; margin-top: 0;">Scheduled Kickoff Time</p>
      <p style="font-family: 'Georgia', serif; font-size: 1.4em; font-weight: bold; margin: 8px 0;">${scheduledTime}</p>
      <a href="${lobbyUrl}" class="button" style="margin-top: 12px;">Enter Pre-Draft Lobby</a>
    </div>
    <p>Please review your queue, research players, and ensure you are in the Draft Room before the timer hits zero!</p>
  `;
  return baseTemplate(`Draft Scheduled for ${leagueName}`, body);
};

export const getDraftCancelledEmail = (leagueName: string, lobbyUrl: string) => {
  const body = `
    <p>The draft schedule for <strong>${leagueName}</strong> has been cancelled or postponed by the commissioner.</p>
    <p>The league status remains in the Pre-Draft setup phase. A new scheduled time will be determined by your commissioner.</p>
    <div style="text-align: center; margin: 24px 0;">
      <a href="${lobbyUrl}" class="button">Go to League Lobby</a>
    </div>
  `;
  return baseTemplate(`Draft Schedule Cancelled: ${leagueName}`, body);
};

export const getLoanProposedEmail = (lenderName: string, playerName: string, loanFee: number, startGw: number, endGw: number, leagueUrl: string) => {
  const body = `
    <h2 style="font-family: 'Georgia', serif; font-size: 1.5em; margin-top: 0;">Loan Proposal from ${lenderName}</h2>
    <p>A loan proposal has been submitted. <strong>${lenderName}</strong> offers to loan out <strong>${playerName}</strong> to your club.</p>
    
    <div style="background-color: #F7F3ED; padding: 20px; border-radius: 8px; border-left: 4px solid #1a1a1a; margin: 20px 0;">
      <p style="margin-top: 0; font-size: 0.9em; text-transform: uppercase; color: #666;">Loan Details</p>
      <p><strong>Player:</strong> ${playerName}</p>
      <p><strong>Term:</strong> GW${startGw} to GW${endGw} (${endGw - startGw} gameweeks)</p>
      <p style="margin-bottom: 0;"><strong>Loan Fee:</strong> €${loanFee}m</p>
    </div>

    <p>Please review the details and accept or reject the proposal.</p>
    <a href="${leagueUrl}/transfers/deals" class="button">Review Loan Offer</a>
  `;
  return baseTemplate('Player Loan Proposal Received', body);
};

export const getLoanAcceptedEmail = (lenderName: string, borrowerName: string, playerName: string, startGw: number, endGw: number, leagueUrl: string) => {
  const detail = `<strong>${borrowerName}</strong> agree a loan for <strong>${playerName}</strong> from <strong>${lenderName}</strong>, GW${startGw} to GW${endGw}`;
  const { lead } = buildHereWeGo('loan', detail);

  const body = `
    <p>${lead}</p>
    <a href="${leagueUrl}/transfers/deals" class="button">View Active Loans</a>
  `;
  return baseTemplate('Loan Agreement Finalized', body);
};


