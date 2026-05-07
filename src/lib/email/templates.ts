// HTML Email Templates for Gaffa

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

export const getTradeProposedEmail = (proposerName: string, giving: string[], receiving: string[], leagueUrl: string) => {
  const body = `
    <h2 style="font-family: 'Georgia', serif; font-size: 1.5em; margin-top: 0;">New Proposal from ${proposerName}</h2>
    <p>The boardroom is buzzing. <strong>${proposerName}</strong> has submitted a formal trade proposal for your consideration.</p>
    
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
    <a href="${leagueUrl}/trades" class="button">Enter Negotiations</a>
  `;
  return baseTemplate('Formal Trade Proposal Received', body);
};

export const getTradeAcceptedEmail = (clubA: string, clubB: string, leagueUrl: string) => {
  const body = `
    <p>A blockbuster trade has just been completed in your league between <strong>${clubA}</strong> and <strong>${clubB}</strong>.</p>
    <p>Head to the transaction log to see the details.</p>
    <a href="${leagueUrl}/activity" class="button">View League Activity</a>
  `;
  return baseTemplate('Trade Completed', body);
};

export const getPlayerDroppedEmail = (clubName: string, playerName: string, leagueUrl: string) => {
  const body = `
    <p><strong>${clubName}</strong> has dropped <strong>${playerName}</strong>.</p>
    <p>A 48-hour FAAB waiver auction has automatically begun. If you want to claim this player, head to the Free Agency market to place your bid.</p>
    <a href="${leagueUrl}/players" class="button">View Player Market</a>
  `;
  return baseTemplate('Player Dropped to Waivers', body);
};

export const getSystemAuctionsEmail = (players: { name: string; value: number }[], isSummerKickoff: boolean, leagueUrl: string) => {
  const title = isSummerKickoff ? 'The Season Has Begun!' : 'Transfer Window Alert';
  const preamble = isSummerKickoff 
    ? `The commissioner has officially started the new season. <strong>${players.length} new players</strong> have been added to the FAAB Auction Block.`
    : `FPL has added <strong>${players.length} new players</strong> to the database who meet the £40m valuation threshold. They have been placed on waivers.`;
    
  const body = `
    <p>${preamble}</p>
    <ul>
      ${players.map(p => `<li>${p.name} (£${p.value}m)</li>`).join('')}
    </ul>
    <p>You have 48 hours to place your FAAB bids on these players.</p>
    <a href="${leagueUrl}/players" class="button">View Player Market</a>
  `;
  return baseTemplate(title, body);
};

export const getAuctionWonEmail = (
  playerName: string, 
  winnerClub: string, 
  winningBid: number, 
  bidderCount: number, 
  droppedPlayerName: string | null, 
  droppedByClub: string | null,
  leagueUrl: string
) => {
  let intensity = 'Uncontested Signing';
  let intensityDesc = 'A straightforward negotiation with no competing interest.';
  let headline = `${winnerClub} Secures ${playerName}`;
  
  if (bidderCount === 2 || bidderCount === 3) {
    intensity = 'Contested Auction';
    intensityDesc = 'Moderate interest from multiple clubs.';
    headline = `${winnerClub} Wins the Race for ${playerName}`;
  } else if (bidderCount >= 4) {
    intensity = 'A Bidding War for the Ages';
    intensityDesc = 'The boardroom was a battlefield as multiple teams fought for the signature.';
    headline = `${winnerClub} Prevails in Epic Bidding War`;
  }

  if (winningBid >= 100) {
    headline = `Record-Breaking Move: ${playerName} Joins ${winnerClub}`;
  }

  const sourceInfo = droppedByClub 
    ? `previously released by <strong>${droppedByClub}</strong>` 
    : 'a new arrival to the league';

  const body = `
    <h2 style="font-family: 'Georgia', serif; font-size: 1.5em; margin-top: 0;">${headline}</h2>
    <p>The deal is finalized. <strong>${playerName}</strong> has officially put pen to paper for <strong>${winnerClub}</strong>.</p>
    <div style="background-color: #f8f9fa; padding: 20px; border-radius: 8px; border-left: 4px solid #1a1a1a; margin: 20px 0;">
      <p style="margin-top: 0; font-size: 0.9em; text-transform: uppercase; color: #666;">Auction Details</p>
      <p><strong>Winning Bid:</strong> £${winningBid}m</p>
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

export const getOutbidEmail = (playerName: string, currentHighBid: number, leagueUrl: string) => {
  const body = `
    <p>You have been outbid for <strong>${playerName}</strong>.</p>
    <p>The current high bid is now <strong>£${currentHighBid}m</strong>.</p>
    <p>If you want to stay in the race, you'll need to increase your bid before the auction expires.</p>
    <a href="${leagueUrl}/players" class="button">Return to Auction</a>
  `;
  return baseTemplate('You have been outbid!', body);
};

export const getDraftStartedEmail = (leagueName: string, draftUrl: string) => {
  const body = `
    <p>The commissioner has officially started the draft for <strong>${leagueName}</strong>!</p>
    <p>The "War Room" is now open. Head over immediately to start making your picks.</p>
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
