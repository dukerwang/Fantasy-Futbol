// HTML Email Templates for Gaffa
//
// Colors, radii and fonts mirror the Gaffa 2.0 "Cream Editorial" light theme
// tokens in src/app/globals.css. Email has no dark-mode media query support
// worth relying on, so the container is always styled against the light
// palette regardless of the recipient's mail client theme.

import { getValueTier, TIER_COPY } from '@/lib/notifications/valueTiers';
import { buildHereWeGo } from '@/lib/notifications/hereWeGo';

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://gaffa.live';
const LOGO_URL = `${BASE_URL}/brand/gaffa-mark.png`;

/** Mirrors src/app/globals.css :root (light theme) custom properties. */
const INK = '#1C1A17'; // --color-text-primary
const TEXT_SECONDARY = '#4A453D'; // --color-text-secondary
const TEXT_MUTED = '#6B6356'; // --color-text-muted
const BORDER = '#C8C3BC'; // --color-border
const BORDER_SUBTLE = '#D9D4CD'; // --color-border-subtle
const BG_PAGE = '#F7F3ED'; // --color-bg-primary
const BG_CARD = '#FDFCF9'; // --color-bg-card
const BG_ELEVATED = '#EDE8DE'; // --color-bg-elevated
const ACCENT = '#146B40'; // --color-accent
const ON_ACCENT = '#FFFFFF'; // --color-on-accent

/** Thin gold rule/text — mirrors the app's --color-gold convention (globals.css):
 *  reserved for standout figures, never a filled badge. */
const GOLD = '#8A6A1F';

/** Matches --font-serif / --font-sans fallback chains, with the actual Google
 *  Fonts faces layered on top for the mail clients that render web fonts
 *  (Apple Mail, most webmail). Clients that strip @font-face (Gmail, Outlook
 *  desktop) fall straight back to Georgia / system sans, same as before. */
const FONT_SERIF = `'Newsreader', Georgia, 'Times New Roman', serif`;
const FONT_SANS = `'Hanken Grotesk', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif`;

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
    @import url('https://fonts.googleapis.com/css2?family=Newsreader:ital,wght@0,400;0,600;0,700;1,400&family=Hanken+Grotesk:wght@400;500;600;700&display=swap');
    body { font-family: ${FONT_SANS}; background-color: ${BG_PAGE}; margin: 0; padding: 20px; color: ${INK}; }
    .container { max-width: 600px; margin: 0 auto; background: ${BG_CARD}; border-radius: 8px; padding: 32px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05); }
    .header { border-bottom: 2px solid ${INK}; padding-bottom: 16px; margin-bottom: 24px; }
    .brand { margin-bottom: 12px; }
    .brand img { display: inline-block; width: 20px; height: 20px; vertical-align: middle; margin-right: 8px; }
    .brandName { display: inline-block; vertical-align: middle; font-family: ${FONT_SERIF}; font-size: 13px; font-weight: 700; letter-spacing: 0.12em; text-transform: uppercase; color: ${INK}; line-height: 20px; }
    .title { font-family: ${FONT_SERIF}; font-size: 24px; font-weight: bold; margin: 0; color: ${INK}; }
    .content { font-size: 16px; line-height: 1.6; color: ${TEXT_SECONDARY}; }
    .content strong { color: ${INK}; }
    .button { display: inline-block; background-color: ${ACCENT}; color: ${ON_ACCENT}; padding: 12px 24px; text-decoration: none; border-radius: 4px; font-weight: bold; margin-top: 24px; }
    .footer { margin-top: 32px; font-size: 12px; color: ${TEXT_MUTED}; text-align: center; border-top: 1px solid ${BORDER_SUBTLE}; padding-top: 16px; }
    ul { list-style-type: none; padding-left: 0; }
    li { background: ${BG_ELEVATED}; padding: 12px; margin-bottom: 8px; border-radius: 4px; border-left: 4px solid ${INK}; color: ${INK}; }
    .strong { font-weight: 600; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div class="brand">
        <img src="${LOGO_URL}" width="20" height="20" alt="" />
        <span class="brandName">Gaffa</span>
      </div>
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

export const getSystemAuctionsEmail = (
  players: { name: string; value: number }[],
  isSummerKickoff: boolean,
  leagueUrl: string,
  thresholdM: number,
) => {
  const count = players.length;
  const top = [...players].sort((a, b) => b.value - a.value)[0];
  const topTier = top ? getValueTier(top.value) : 'standard';

  let title = 'Transfer Window Alert';
  if (isSummerKickoff) {
    title = 'The Season Has Begun!';
  } else if (topTier === 'galactico') {
    title = 'Galáctico on the Market';
  } else if (topTier === 'blockbuster') {
    title = 'Blockbuster Signing Available';
  }

  let preamble = '';
  if (isSummerKickoff) {
    preamble = `The commissioner has officially started the season. <strong>${count} summer arrival${count === 1 ? '' : 's'}</strong> have been placed on the auction block.`;
  } else if (count === 1 && top) {
    preamble = `A new high-profile signing has entered the Premier League. <strong>${top.name}</strong> (€${top.value}m) is now available on the open market.`;
  } else {
    preamble = `The transfer market is heating up. <strong>${count} marquee signings</strong> (€${thresholdM}m+ valuation) have just been posted to the auction board.`;
  }

  const standard = players.filter((p) => getValueTier(p.value) === 'standard');
  const featured = players
    .filter((p) => getValueTier(p.value) !== 'standard')
    .sort((a, b) => b.value - a.value);

  const featuredHtml = featured
    .map((p) => {
      const copy = TIER_COPY[getValueTier(p.value)]!;
      return `
        <div style="background-color: ${BG_CARD}; padding: 20px; border-radius: 8px; border-left: 4px solid ${GOLD}; margin: 0 0 16px;">
          ${tierEyebrowHtml(p.value)}
          <p style="margin: 0; font-family: ${FONT_SERIF}; font-size: 1.3em; font-weight: bold; color: ${INK};">${p.name}</p>
          <p style="margin: 4px 0 8px; font-size: 1.1em; color: ${INK};">€${p.value}m</p>
          <p style="margin: 0; font-size: 0.9em; color: ${TEXT_MUTED};">${copy.description}</p>
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
    <p>Auctions are live on the transfer board. Bids are paid from your Club Balance and dynamic clocks are active.</p>
    <a href="${leagueUrl}/transfers/auctions" class="button">Enter the Bidding</a>
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
    <p style="font-family: ${FONT_SERIF}; font-size: 1.2em; margin-top: 0; color: ${INK};">${lead}</p>
    <div style="background-color: ${BG_ELEVATED}; padding: 20px; border-radius: 8px; border-left: 4px solid ${tier === 'standard' ? INK : GOLD}; margin: 20px 0;">
      <p style="margin-top: 0; font-size: 0.9em; text-transform: uppercase; color: ${TEXT_MUTED};">Auction Details</p>
      <p><strong>Winning Bid:</strong> €${winningBid}m</p>
      <p style="margin-bottom: 0;"><strong>Atmosphere:</strong> ${intensity}</p>
      <p style="font-size: 0.85em; color: ${TEXT_MUTED}; margin-top: 4px;">${intensityDesc} (${bidderCount} active bidder${bidderCount === 1 ? '' : 's'})</p>
    </div>
    <p>The player was ${sourceInfo}.</p>
    ${droppedPlayerName ? `
      <div style="background-color: ${BG_PAGE}; padding: 20px; border-radius: 8px; margin: 20px 0; border: 1px dashed ${BORDER};">
        <p style="margin: 0;">To make room, ${winnerClub} have released <strong>${droppedPlayerName}</strong> into the auction pool.</p>
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
    <p style="font-family: ${FONT_SERIF}; font-size: 1.2em; margin-top: 0; color: ${INK};">${lead}</p>
    <a href="${leagueUrl}/team" class="button">View Your Team</a>
  `;
  return baseTemplate('Player Sold!', body);
};

export const getDraftStartedEmail = (leagueName: string, draftUrl: string) => {
  const body = `
    <p>The commissioner has officially started the draft for <strong>${leagueName}</strong>!</p>
    <p>The Draft Room is now open. Head over immediately to start making your picks.</p>
    <div style="background-color: ${BG_PAGE}; padding: 20px; border-radius: 8px; border: 2px solid ${INK}; text-align: center; margin: 24px 0;">
      <p style="font-family: ${FONT_SERIF}; font-size: 1.2em; font-weight: bold; margin-top: 0; color: ${INK};">DRAFT IS LIVE</p>
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
    <div style="border-bottom: 1px solid ${BORDER_SUBTLE}; padding: 12px 0; display: flex; justify-content: space-between; align-items: center;">
      <div style="flex: 1; text-align: right; color: ${INK}; ${r.winner === r.teamA ? 'font-weight: bold;' : ''}">${r.teamA}</div>
      <div style="width: 80px; text-align: center; font-family: 'Courier New', monospace; font-weight: bold; color: ${INK};">${r.scoreA} - ${r.scoreB}</div>
      <div style="flex: 1; text-align: left; color: ${INK}; ${r.winner === r.teamB ? 'font-weight: bold;' : ''}">${r.teamB}</div>
    </div>
  `).join('');

  const body = `
    <p style="text-transform: uppercase; letter-spacing: 2px; font-size: 0.8em; color: ${TEXT_MUTED}; margin-bottom: 4px;">Monday Review • Gameweek ${gameweek}</p>
    <h1 style="font-family: ${FONT_SERIF}; font-size: 2em; margin-top: 0; line-height: 1.1; color: ${INK};">${highScorer.teamName} Sets the Pace in ${leagueName}</h1>

    <p>The dust has settled on another weekend of action. Here is how your league fared:</p>

    <div style="margin: 24px 0; border-top: 2px solid ${INK}; border-bottom: 2px solid ${INK}; padding: 8px 0;">
      ${resultsHtml}
    </div>

    <div style="background-color: ${BG_ELEVATED}; padding: 20px; border-radius: 8px; margin: 24px 0;">
      <p style="margin-top: 0; font-weight: bold; text-transform: uppercase; font-size: 0.9em; color: ${INK};">Performance of the Week</p>
      <p style="font-size: 1.1em; margin-bottom: 0;"><strong>${highScorer.teamName}</strong> dominated the field with a massive <strong>${highScorer.score.toFixed(2)}</strong> points.</p>
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
    <div style="background-color: ${BG_PAGE}; padding: 20px; border-radius: 8px; border: 2px solid ${INK}; text-align: center; margin: 24px 0;">
      <p style="font-size: 0.9em; text-transform: uppercase; color: ${TEXT_MUTED}; margin-top: 0;">Scheduled Kickoff Time</p>
      <p style="font-family: ${FONT_SERIF}; font-size: 1.4em; font-weight: bold; margin: 8px 0; color: ${INK};">${scheduledTime}</p>
      <a href="${lobbyUrl}" class="button" style="margin-top: 12px;">Go to League lobby</a>
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
      <a href="${lobbyUrl}" class="button">Go to League lobby</a>
    </div>
  `;
  return baseTemplate(`Draft Schedule Cancelled: ${leagueName}`, body);
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


