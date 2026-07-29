import { getPlayerDisplayName } from '@/lib/players/displayName';

function hashId(id: string): number {
  if (!id) return 0;
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

export interface MatchReport {
  headline: string;
  byline: string;
  leadParagraph: string;
  starHighlight: string;
  disappointmentHighlight: string;
}

export function generateMatchReport(
  matchup: any,
  lineupA: any,
  lineupB: any,
  playerMap: Record<string, any>,
  detailMap: Record<string, { points: number; stats?: any }>
): MatchReport {
  const hash = hashId(matchup.id);
  const teamAName = matchup.team_a?.team_name ?? 'Team A';
  const teamBName = matchup.team_b?.team_name ?? 'Team B';
  const gw = matchup.gameweek;

  // Bylines to pick from
  const bylines = [
    'By Gaffa Lead Reporter',
    'From the Gaffa Sports Desk',
    'By Gaffa Roster Analyst',
    'By Gaffa Press Association',
    'Gaffa Matchday Special Report',
    'By Gaffa Pitchside Correspondent',
    'From Gaffa Boardroom Chronicles',
    'By Gaffa League Historian',
    'Gaffa Tactical Review Desk',
    'By Gaffa Editorial Team'
  ];
  const byline = bylines[hash % bylines.length];

  // 1. Preview State
  if (matchup.status === 'scheduled' || (matchup.status !== 'completed' && matchup.status !== 'live')) {
    const headlines = [
      `High Stakes Loom as **${teamAName}** Prepare to Face **${teamBName}**`,
      `Tactical Duel Looming Between **${teamAName}** and **${teamBName}**`,
      `**${teamAName}** and **${teamBName}** Battle for Boardroom Supremacy`,
      `Can **${teamAName}** Outmaneuver **${teamBName}** in Gameweek ${gw}?`,
      `**${teamBName}** Face Tough Road Test Against **${teamAName}**`,
      `Roster Selections Key for **${teamAName}** vs **${teamBName}**`,
      `Managers Refine Roster Strategies for Big **${teamAName}** vs **${teamBName}** Clash`,
      `**${teamAName}** vs **${teamBName}** Matchday Preview`,
      `Tactical Setup Crucial for **${teamAName}** and **${teamBName}**`,
      `League Standings at Stake in **${teamAName}** vs **${teamBName}**`
    ];
    const leads = [
      `Anticipation is building in the league office as **${teamAName}** prepares to host **${teamBName}** for their Gameweek ${gw} matchup. Both boards have been active in waiver training all week.`,
      `A tactical chess match is brewing between **${teamAName}** and **${teamBName}**. Managers have finalized their team sheets, and supporters are locking in predictions.`,
      `With league standings beginning to solidify, the upcoming encounter between **${teamAName}** and **${teamBName}** carries massive implications for the mid-season standings.`,
      `The boardrooms are quiet as preparation concludes. **${teamAName}** and **${teamBName}** are set to face off in what analysts predict will be a tight, low-margin match.`,
      `Manager tactics will be under the spotlight this weekend as **${teamAName}** and **${teamBName}** clash in a critical Gameweek ${gw} fixture.`
    ];

    return {
      headline: headlines[hash % headlines.length],
      byline,
      leadParagraph: leads[hash % leads.length],
      starHighlight: 'Scouts are monitoring team selections. Key starter ratings will be tracked live once the match kickoff begins.',
      disappointmentHighlight: 'Roster managers must watch for late injury alerts and taxi-squad adjustments before locks go into effect.'
    };
  }

  // 2. Active Matchup Scores
  const isLive = matchup.status === 'live';
  let computedScoreA = 0;
  lineupA?.starters.forEach((s: any) => { computedScoreA += detailMap[s.player_id]?.points || 0; });
  let computedScoreB = 0;
  lineupB?.starters.forEach((s: any) => { computedScoreB += detailMap[s.player_id]?.points || 0; });

  const scoreA = matchup.status === 'completed' ? Number(matchup.score_a) : computedScoreA;
  const scoreB = matchup.status === 'completed' ? Number(matchup.score_b) : computedScoreB;

  const margin = Math.abs(scoreA - scoreB);
  const isDraw = Math.abs(scoreA - scoreB) <= 10;
  const aWins = !isDraw && scoreA > scoreB;
  const bWins = !isDraw && scoreB > scoreA;

  const winner = aWins ? teamAName : (bWins ? teamBName : '');
  const loser = aWins ? teamBName : (bWins ? teamAName : '');
  const winnerScore = aWins ? scoreA : (bWins ? scoreB : scoreA);
  const loserScore = aWins ? scoreB : (bWins ? scoreA : scoreB);

  // Identify Star Player (highest scoring starter across both teams)
  let starPlayerId = '';
  let starPlayerPoints = -Infinity;
  let starPlayerTeamName = '';

  const scanStarters = (starters: any[], teamName: string) => {
    starters.forEach((s: any) => {
      const pts = detailMap[s.player_id]?.points ?? 0;
      if (pts > starPlayerPoints) {
        starPlayerPoints = pts;
        starPlayerId = s.player_id;
        starPlayerTeamName = teamName;
      }
    });
  };

  if (lineupA?.starters) scanStarters(lineupA.starters, teamAName);
  if (lineupB?.starters) scanStarters(lineupB.starters, teamBName);

  const starPlayer = starPlayerId ? playerMap[starPlayerId] : null;
  const starPlayerName = starPlayer ? `**p:${starPlayerId}:${getPlayerDisplayName(starPlayer as any, 'full')}**` : 'a standout performer';

  // Identify Disappointment (starter on losing team or draw team with lowest score, prioritizing who actually played)
  let flopPlayerId = '';
  let flopPlayerPoints = Infinity;
  let flopPlayerTeamName = '';

  const flopCandidates = (loser === teamAName || isDraw) ? (lineupA?.starters ?? []) : (lineupB?.starters ?? []);
  const flopTeamName = (loser === teamAName || isDraw) ? teamAName : teamBName;

  // Heuristic: search for negative scores first, then low scores (0 to 2), then general lowest
  let selectedFlop = false;

  // Step 1: Negative points
  for (const s of flopCandidates) {
    const pts = detailMap[s.player_id]?.points ?? 0;
    if (pts < 0 && pts < flopPlayerPoints) {
      flopPlayerPoints = pts;
      flopPlayerId = s.player_id;
      flopPlayerTeamName = flopTeamName;
      selectedFlop = true;
    }
  }

  // Step 2: Low positive points (between 0.1 and 2.0)
  if (!selectedFlop) {
    for (const s of flopCandidates) {
      const pts = detailMap[s.player_id]?.points ?? 0;
      const stats = detailMap[s.player_id]?.stats ?? {};
      const played = stats.minutes_played ? Number(stats.minutes_played) > 0 : pts !== 0;
      if (played && pts <= 2 && pts < flopPlayerPoints) {
        flopPlayerPoints = pts;
        flopPlayerId = s.player_id;
        flopPlayerTeamName = flopTeamName;
        selectedFlop = true;
      }
    }
  }

  // Step 3: Any lowest points
  if (!selectedFlop && flopCandidates.length > 0) {
    for (const s of flopCandidates) {
      const pts = detailMap[s.player_id]?.points ?? 0;
      if (pts < flopPlayerPoints) {
        flopPlayerPoints = pts;
        flopPlayerId = s.player_id;
        flopPlayerTeamName = flopTeamName;
      }
    }
  }

  const flopPlayer = flopPlayerId ? playerMap[flopPlayerId] : null;
  const flopPlayerName = flopPlayer ? `**p:${flopPlayerId}:${getPlayerDisplayName(flopPlayer as any, 'full')}**` : 'underperforming starter';

  // Generate highlight summaries
  const starHighlight = starPlayerId 
    ? `Man of the Match honors go to ${starPlayerName} of **${starPlayerTeamName}**, who delivered a sterling performance, scoring **${starPlayerPoints.toFixed(1)} points** to anchor the team sheet.`
    : `A balanced team effort was key, as no single player dominated the scores.`;

  const disappointmentHighlight = flopPlayerId
    ? `Conversely, **${flopPlayerTeamName}** suffered from a difficult outing by ${flopPlayerName}, who returned just **${flopPlayerPoints.toFixed(1)} points**, leaving the board to regret the starting selection.`
    : `Roster managers kept errors to a minimum, with no major lineup errors reported on either team sheet.`;

  // Live Matchup
  if (isLive) {
    const headlines = [
      `Tense Battle Unfolding Between **${teamAName}** and **${teamBName}**`,
      `Roster Scores Active for **${teamAName}** vs **${teamBName}**`,
      `**${teamAName}** and **${teamBName}** Locked in Tight Matchweek Duel`,
      `Star Performance Dictates Play for **${teamAName}** vs **${teamBName}**`,
      `**${teamAName}** Holding Narrow Lead Over **${teamBName}**`,
      `Boards Watch Tensely as **${teamAName}** Clashes with **${teamBName}**`,
      `**${teamBName}** Mounts Fightback Against **${teamAName}**`,
      `High Stakes in Gameweek ${gw} Matchup`,
      `Roster Points Fluctuating in **${teamAName}** vs **${teamBName}**`,
      `Real-Time Scores Updating for **${teamAName}** and **${teamBName}**`
    ];
    
    const leadVerb = scoreA > scoreB ? `leads` : (scoreB > scoreA ? `trail` : `are locked in a stalemate with`);
    const leadTarget = scoreA > scoreB ? teamBName : (scoreB > scoreA ? teamAName : '');
    const currentDiff = Math.abs(scoreA - scoreB).toFixed(2);

    const leads = [
      `The action is underway and points are updating in real-time. Currently, **${teamAName}** ${leadVerb} **${leadTarget || teamBName}** in a fluid Gameweek ${gw} matchup, with a margin of **${currentDiff} points** separating them.`,
      `Matches are updating live. **${teamAName}** and **${teamBName}** are locked in a closely-contested battle, with scoreboard shifts expected as bonus point calculations finalize.`,
      `Roster points are compiling as matches progress. **${teamAName}**'s board is celebrating early point hauls, while **${teamBName}** relies on late fixtures to close the gap.`,
      `The matchday is live. Managers are monitoring the benches closely as the live score stands at **${scoreA.toFixed(2)} - ${scoreB.toFixed(2)}** in favor of ${scoreA > scoreB ? `**${teamAName}**` : `**${teamBName}**`}.`,
      `A thrilling afternoon sees **${teamAName}** and **${teamBName}** trading blow-for-blow. Current gap: **${currentDiff} points**.`
    ];

    return {
      headline: headlines[hash % headlines.length],
      byline,
      leadParagraph: leads[hash % leads.length],
      starHighlight: starPlayerId 
        ? `Live standout ${starPlayerName} of **${starPlayerTeamName}** is currently setting the pace with **${starPlayerPoints.toFixed(1)} points**.`
        : starHighlight,
      disappointmentHighlight: flopPlayerId
        ? `Manager adjustments may be needed as ${flopPlayerName} struggles to return value, sitting on just **${flopPlayerPoints.toFixed(1)} points**.`
        : disappointmentHighlight
    };
  }

  // 3. Completed State
  if (isDraw) {
    const headlines = [
      `Tense Stalemate Between **${teamAName}** and **${teamBName}**`,
      `**${teamAName}** and **${teamBName}** Split Points in Stalemate`,
      `**${teamAName}** and **${teamBName}** Draw **${scoreA.toFixed(1)} - ${scoreB.toFixed(1)}**`,
      `Tactical Clashes End in Draw for **${teamAName}** and **${teamBName}**`,
      `Points Divided After Grinding Match at Gaffa Desk`,
      `No Separation: **${teamAName}** and **${teamBName}** Split Gameweek ${gw} Spoils`,
      `Tactical Draw: Scoreboards Finalize on Stalemate for **${teamAName}** vs **${teamBName}**`,
      `Both Boards Collect Draw Point in Tight Roster Duel`,
      `**${teamAName}** and **${teamBName}** Finish Even in Gameweek ${gw}`,
      `Deadlock Unbroken Between **${teamAName}** and **${teamBName}**`
    ];
    
    const leads = [
      `A grueling Gameweek ${gw} battle has ended without a victor, as **${teamAName}** and **${teamBName}** finalized a hard-fought stalemate with the final board reading **${scoreA.toFixed(2)} to ${scoreB.toFixed(2)}**.`,
      `Neither manager could secure the decisive breakthrough this weekend, resulting in a tense **${scoreA.toFixed(2)} - ${scoreB.toFixed(2)}** draw that leaves both boardrooms reflecting on missed opportunities.`,
      `The points are shared at the whistle. **${teamAName}** and **${teamBName}** finished level on points, ending a match that fluctuated with every clean sheet confirmation.`,
      `A tactical stalemate ended in a draw, with the margin separating **${teamAName}** and **${teamBName}** settling at a narrow **${margin.toFixed(2)} points**—well within the league's draw parameters.`,
      `Gameweek ${gw} concludes with a division of spoils. The final tally finished **${scoreA.toFixed(2)} - ${scoreB.toFixed(2)}**, leaving both clubs to collect one point in the standings.`
    ];

    return {
      headline: headlines[hash % headlines.length],
      byline,
      leadParagraph: leads[hash % leads.length],
      starHighlight,
      disappointmentHighlight
    };
  }

  // Completed Win/Loss
  if (margin > 30) {
    // Blowout
    const headlines = [
      `**${winner}** Dismantles **${loser}** in Boardroom Masterclass`,
      `**${winner}** Outclasses **${loser}** in Blowout Victory`,
      `**${winner}** Crushes **${loser}** with Massive Gameweek Performance`,
      `No Mercy as **${winner}** Dismantle **${loser}** in Gameweek ${gw}`,
      `**${winner}** Demolishes **${loser}** by **${margin.toFixed(0)} Points**`,
      `**${winner}** Leaves **${loser}** in the Dust after Scoreboard Surge`,
      `**${winner}** Cruises to Comfortable Blowout Over **${loser}**`,
      `**${winner}** Dominates Roster Sheet Against **${loser}**`,
      `**${winner}** Runs Riot in Huge Win Over **${loser}**`,
      `**${winner}** Dismantle **${loser}** in Blockbuster Showing`
    ];
    
    const leads = [
      `It was a total mismatch at the boardroom level this week. **${winner}** put on a masterclass in roster management, completely outclassing **${loser}** in a convincing **${winnerScore.toFixed(2)} to ${loserScore.toFixed(2)}** rout.`,
      `The boardrooms are silent at **${loser}** following a comprehensive dismantling by **${winner}**, who claimed the three points with an emphatic **${margin.toFixed(2)}-point** margin of victory.`,
      `**${winner}** ran riot in Gameweek ${gw}, posting a massive score of **${winnerScore.toFixed(2)}** and leaving a shell-shocked **${loser}** board with massive questions to answer.`,
      `A dominant performance from starting sheets secured a comfortable victory for **${winner}** as they completely overmatched **${loser}** from kickoff to final bonus calculations.`,
      `Roster selections clicked perfectly for **${winner}** as they cruised to a commanding **${winnerScore.toFixed(2)} - ${loserScore.toFixed(2)}** blowout victory over rival **${loser}**.`
    ];

    return {
      headline: headlines[hash % headlines.length],
      byline,
      leadParagraph: leads[hash % leads.length],
      starHighlight,
      disappointmentHighlight
    };
  } else if (margin > 15) {
    // Comfortable Win
    const headlines = [
      `**${winner}** Outpaces **${loser}** Comfortably in Roster Duel`,
      `**${winner}** Claims Crucial Points Against **${loser}**`,
      `**${winner}** Controls the Play to Defeat **${loser}**`,
      `**${winner}** Cruises Past **${loser}** in Gameweek ${gw}`,
      `**${winner}** Outmaneuvers **${loser}** in Comfortable Fashion`,
      `**${winner}** Defeats **${loser}** **${winnerScore.toFixed(0)} - ${loserScore.toFixed(0)}**`,
      `**${winner}** Secures Clinical Victory Over **${loser}**`,
      `**${winner}** Starters Deliver in Win Over **${loser}**`,
      `**${winner}** Outscores **${loser}** by Comfortable Margin`,
      `**${winner}** Records Comfortable Victory Over **${loser}**`
    ];
    
    const leads = [
      `A professional and calculated display saw **${winner}** secure all three points, defeating **${loser}** in a convincing **${winnerScore.toFixed(2)} - ${loserScore.toFixed(2)}** showing in Gameweek ${gw}.`,
      `Manager tactics paid dividends for **${winner}**, who maintained a comfortable cushion throughout the weekend to seal a **${margin.toFixed(2)}-point** win over **${loser}**.`,
      `**${winner}** collected a vital victory in their campaign, outpacing **${loser}** comfortably with a final score of **${winnerScore.toFixed(2)}** points to their rival's **${loserScore.toFixed(2)}**.`,
      `There were few nervous moments for **${winner}** as they dispatched **${loser}** in comfortable fashion, demonstrating superior lineup optimization.`,
      `A solid foundation of starting returns guided **${winner}** to a comfortable dispatch of **${loser}** in their weekly boardroom duel.`
    ];

    return {
      headline: headlines[hash % headlines.length],
      byline,
      leadParagraph: leads[hash % leads.length],
      starHighlight,
      disappointmentHighlight
    };
  } else {
    // Narrow Win
    const headlines = [
      `**${winner}** Edges Out **${loser}** in Nerve-Wracking Finish`,
      `**${winner}** Squeaks Past **${loser}** in Gameweek ${gw} Thriller`,
      `**${winner}** Survives Late Surge to Defeat **${loser}**`,
      `**${winner}** Wins Tight Encounter Against **${loser}**`,
      `**${winner}** Defeats **${loser}** by a Mere **${margin.toFixed(1)} Points**`,
      `**${winner}** Secures Narrow Victory Over Rival **${loser}**`,
      `**${winner}** Edges **${loser}** in Nerve-Wracking Finish`,
      `Late Bonus Points Seal Victory for **${winner}** Over **${loser}**`,
      `**${winner}** Outscores **${loser}** in Gameweek ${gw} Close Call`,
      `**${winner}** Claims Tight Win in Hard-Fought Duel Against **${loser}**`
    ];
    
    const leads = [
      `A dramatic Gameweek ${gw} encounter went down to the final whistle as **${winner}** narrowly edged out **${loser}** in a nerve-wracking **${winnerScore.toFixed(2)} - ${loserScore.toFixed(2)}** finish.`,
      `Only **${margin.toFixed(2)} points** separated the two sides in the end, as **${winner}** survived a late scoring surge from **${loser}** to secure a vital close-run victory.`,
      `Supporters were on the edge of their seats as **${winner}** squeaked past **${loser}** in a close-run matchup that could have gone either way depending on late substitution choices.`,
      `A highly contested boardroom battle ended in celebrations for **${winner}**, who claimed a narrow **${winnerScore.toFixed(2)} - ${loserScore.toFixed(2)}** win over a disappointed **${loser}** squad.`,
      `Roster optimizations proved decisive as **${winner}** managed to scratch out a narrow victory over **${loser}** in a game decided by thin margins.`
    ];

    return {
      headline: headlines[hash % headlines.length],
      byline,
      leadParagraph: leads[hash % leads.length],
      starHighlight,
      disappointmentHighlight
    };
  }
}
