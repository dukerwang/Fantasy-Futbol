import { formatPlayerName } from '@/lib/formatName';

// Deterministic hash helper to select template variants consistently based on item ID
function hashId(id: string): number {
  if (!id) return 0;
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return Math.abs(hash);
}

interface MiniPlayer {
  web_name: string | null;
  name: string;
  primary_position?: string;
  pl_team?: string | null;
}

interface MiniTeam {
  team_name: string;
}

interface MiniTx {
  id: string;
  type: string;
  faab_bid: number | null;
  compensation_amount: string | number | null;
  notes: string | null;
  team: MiniTeam | null;
  player: MiniPlayer | null;
}

export function generateTransactionHeadline(tx: MiniTx): string {
  const hash = hashId(tx.id);
  const teamName = tx.team?.team_name ?? 'Unknown Club';
  const player = tx.player;
  const playerName = player ? formatPlayerName(player as any, 'initial_last') : 'Unknown Player';
  const faab = tx.faab_bid ?? 0;
  const comp = tx.compensation_amount ? Number(tx.compensation_amount) : 0;

  switch (tx.type) {
    case 'waiver_claim': {
      if (faab >= 40) {
        const templates = [
          `BLOCKBUSTER: ${teamName} smashes contract records to sign ${playerName}!`,
          `MEGA DEAL: ${teamName} splurges €${faab}m to secure ${playerName}`,
          `BOARDROOM STRIKE: ${teamName} wins intense race for ${playerName} in €${faab}m coup`,
          `BIG SPENDER: ${playerName} puts pen to paper on €${tx.faab_bid}m move to ${teamName}`,
          `MARQUEE MOVE: ${teamName} pulls off massive signing, welcoming ${playerName}`,
          `LUCRATIVE BID: ${teamName} prevails in bidding war for superstar ${playerName}`,
          `STATEMENT SIGNING: ${teamName} adds defensive/offensive reinforcement ${playerName} for €${faab}m`,
          `TREASURY DEPLOYED: ${teamName} splashes cash to bring in ${playerName}`,
          `HIGH VALUATION: ${playerName} seals big-money transfer to ${teamName}`,
          `CAPITAL VENTURE: ${teamName} wins high-stakes bidding for ${playerName}`
        ];
        return templates[hash % templates.length];
      } else {
        const templates = [
          `OFFICIAL: ${teamName} secures the signature of ${playerName} (€${faab}m)`,
          `AUCTION CAPTURE: ${playerName} joins ${teamName} after board approval`,
          `ACQUISITION: ${teamName} adds roster depth with ${playerName} (€${faab}m)`,
          `BOARDROOM DECISION: ${teamName} secures ${playerName} in auction process`,
          `DEAL SIGNED: ${playerName} finalized by ${teamName} on a €${faab}m deal`,
          `AUCTION CONCLUDED: ${playerName} makes the switch to ${teamName}`,
          `CONTRACT AGREED: ${teamName} completes deal for ${playerName}`,
          `MARKET MOVE: ${playerName} drafted into ${teamName} starting pool`,
          `TRANSFER COMPLETED: ${playerName} headed to ${teamName} following auction`,
          `WAIVER SUCCESS: ${teamName} welcomes ${playerName} after successful waiver claim`
        ];
        return templates[hash % templates.length];
      }
    }

    case 'free_agent_pickup': {
      const templates = [
        `BARGAIN HUNT: ${teamName} snaps up ${playerName} on a free transfer`,
        `FREE ACQUISITION: ${playerName} joins ${teamName} to bolster bench strength`,
        `ROSTER UPGRADE: ${teamName} secures free agent ${playerName}`,
        `SQUAD DEPTH: ${playerName} signs deal with ${teamName} out of free agency`,
        `BARGAIN SIGNING: ${teamName} adds ${playerName} on a free deal`,
        `TACTICAL ADDITION: ${teamName} welcomes free agent ${playerName} to the squad`,
        `FREE TRANSFER: ${playerName} seals move to ${teamName} roster`,
        `OPPORTUNISTIC SIGNING: ${teamName} picks up ${playerName} from free agency`,
        `BENCH REINFORCEMENT: ${playerName} completes free transfer to ${teamName}`,
        `SIGNING ANNOUNCED: Free agent ${playerName} puts pen to paper for ${teamName}`
      ];
      return templates[hash % templates.length];
    }

    case 'drop': {
      if (comp > 0) {
        const templates = [
          `CONTRACT TERMINATION: ${playerName} released by ${teamName} (Paid €${comp}m)`,
          `ROSTER PURGE: ${teamName} cuts ties with ${playerName} at €${comp}m severance cost`,
          `SHOCK DEPARTURE: ${playerName} shown the exit door at ${teamName} after severance payout`,
          `MUTUAL RELEASE: ${teamName} terminates contract for ${playerName}, paying contract clause`,
          `BOARD ACTIONS: ${teamName} clears roster spot, paying €${comp}m severance for ${playerName}`,
          `EXPENSIVE CLEARANCE: ${teamName} pays €${comp}m to release ${playerName} to waivers`,
          `SQUAD SHUFFLE: ${playerName} released from ${teamName} duties after buyout fee`,
          `ROSTER CUT: ${playerName} waived by ${teamName} following €${comp}m severance agreement`,
          `OFFICIAL RELEASE: ${teamName} releases ${playerName} into waiver pool, absorbing buyout`,
          `DEAL LIQUIDATED: ${teamName} pays contract severance to release ${playerName}`
        ];
        return templates[hash % templates.length];
      } else {
        const templates = [
          `WAIVED: ${playerName} released by ${teamName} to free agency`,
          `ROSTER ADJUSTMENT: ${teamName} cuts ties with ${playerName}`,
          `SQUAD REDUCTION: ${playerName} parted ways with ${teamName}`,
          `INTO THE MARKET: ${teamName} drops ${playerName} to the waiver pool`,
          `OFFICIAL DEPARTURE: ${playerName} released from ${teamName} roster`,
          `ROSTER CLEARANCE: ${teamName} waives backup player ${playerName}`,
          `SQUAD VACANCY: ${playerName} shown exit door by ${teamName}`,
          `CONTRACT RELEASE: ${playerName} sent to free agency by ${teamName}`,
          `TACTICAL SHIFT: ${teamName} drops defender/midfielder ${playerName}`,
          `DROPPED: ${playerName} released into waivers by ${teamName}`
        ];
        return templates[hash % templates.length];
      }
    }

    case 'transfer_out': {
      const templates = [
        `CONTINENTAL MOVE: ${playerName} departs PL; ${teamName} recovers €${comp}m`,
        `DEPARTURE: ${playerName} leaves the league, returning budget to ${teamName}`,
        `PL EXIT: ${playerName} transferred out of Premier League; €${comp}m refunded`,
        `ROSTER DEPARTURE: ${playerName} departs; ${teamName} collects €${comp}m compensation`,
        `OFFICIAL EXIT: ${playerName} leaves division, returning €${comp}m to ${teamName} vault`,
        `BUDGET RECOVERED: ${playerName} transfers abroad; ${teamName} receives €${comp}m`,
        `SQUAD LEAVETAKING: ${playerName} bids farewell to PL; €${comp}m returned to ${teamName}`,
        `COMPENSATED EXIT: ${playerName} departs the league, returning contract equity`,
        `TRANSFERRED OUT: ${playerName} exits English top flight; €${comp}m refunded`,
        `PL TRANSFER: ${playerName} transferred out; ${teamName} pockets €${comp}m return`
      ];
      return templates[hash % templates.length];
    }

    case 'trade': {
      const templates = [
        `BLOCKBUSTER TRADE: ${teamName} completes player swap deal`,
        `BOARDROOM HANDSHAKE: Managers finalize roster swap involving ${teamName}`,
        `TRADE AGREEMENT: Swap deal resolved for ${teamName}`,
        `ROSTER SHAKEUP: ${teamName} executes trade to rebuild starting depth`,
        `COMPLETED TRANSACTION: Trade paperwork signed for ${teamName}`,
        `OFFICIAL SWAP: ${teamName} completes trade negotiations`,
        `BOARD AGREEMENT: Trade confirmed for ${teamName}`,
        `MUTUAL AGREEMENT: Teams finalize trade package`,
        `SWAP DEAL: ${teamName} executes trade swap`,
        `NEGOTIATIONS FINALIZED: Trade completed by ${teamName}`
      ];
      return templates[hash % templates.length];
    }

    case 'transfer_compensation': {
      return `COMPENSATION: ${teamName} received €${comp}m budget return for ${playerName}`;
    }

    case 'rebate': {
      return `SCOUT REBATE: ${teamName} refunded €${comp || faab}m for player release`;
    }

    case 'draft_pick': {
      const templates = [
        `DRAFT PICK: ${teamName} selects ${playerName}`,
        `WAR ROOM CHOICE: ${teamName} locks in ${playerName} during draft`,
        `OFFICIAL PICK: ${playerName} selected by ${teamName}`,
        `DRAFT BOARD UPDATE: ${teamName} recruits prospect ${playerName}`,
        `ROSTER ENTRY: ${playerName} drafted by ${teamName} board`,
        `DRAFT SELECTION: ${teamName} registers ${playerName} into active squad`,
        `SQUAD INITIATION: ${playerName} joins ${teamName} via draft system`,
        `DRAFT SELECTION COMPLETE: ${playerName} added to ${teamName}`,
        `ROSTER SEEDING: ${teamName} locks in draft choice ${playerName}`,
        `NEW TALENT: ${playerName} joins ${teamName} following draft selection`
      ];
      return templates[hash % templates.length];
    }

    case 'prize_payout': {
      return `FINANCIAL WINDFALL: ${teamName} received prize payout (+€${faab}m)`;
    }

    default: {
      return tx.notes || `TRANSACTION: ${teamName} processed type ${tx.type}`;
    }
  }
}

export function generateTransactionBody(tx: MiniTx): string {
  const hash = hashId(tx.id);
  const teamName = tx.team?.team_name ?? 'the club';
  const player = tx.player;
  const playerName = player ? formatPlayerName(player as any, 'full') : 'the player';
  const pos = player?.primary_position ?? 'player';
  const plTeam = player?.pl_team ?? 'PL club';
  const faab = tx.faab_bid ?? 0;
  const comp = tx.compensation_amount ? Number(tx.compensation_amount) : 0;

  switch (tx.type) {
    case 'waiver_claim': {
      if (faab >= 40) {
        const templates = [
          `The boardroom was buzzing as ${teamName} shelled out €${faab}m to secure the signing of ${playerName}. The high-profile ${pos} is expected to make an immediate impact.`,
          `FC Gaffa confirms that ${playerName} has officially put pen to paper in a blockbusting €${faab}m transfer to ${teamName}, outbidding rivals in the waiver process.`,
          `${teamName} manager deployed significant club resources to secure the signature of ${playerName} from the waiver block. The €${faab}m fee sets a new precedent for the squad.`,
          `Following intense bidding, ${playerName} has completed his registration with ${teamName}. The €${faab}m transaction indicates the board's high ambitions.`,
          `Reinforcing the starting eleven, ${teamName} has finalized the €${faab}m acquisition of ${plTeam}'s ${playerName}. Supporters are eagerly awaiting his first match.`
        ];
        return templates[hash % templates.length];
      } else {
        const templates = [
          `${teamName} secured the signature of ${playerName} (${pos}) with a well-placed €${faab}m waiver claim, bolstering their squad options.`,
          `Official registry logs confirm ${playerName} has signed with ${teamName}. The €${faab}m deal was processed successfully through the auction room.`,
          `Adding depth to the lineup, ${teamName} has finalized the registration of ${playerName} for €${faab}m following the close of the waiver window.`,
          `${playerName} has joined ${teamName} for an auction fee of €${faab}m. The ${plTeam} player will report to training immediately.`,
          `A successful €${faab}m bid was enough for ${teamName} to lock down the registration of ${playerName} to their active roster.`
        ];
        return templates[hash % templates.length];
      }
    }

    case 'free_agent_pickup': {
      const templates = [
        `In a low-risk roster addition, ${teamName} snapped up ${playerName} from the free agency pool. The ${plTeam} ${pos} will provide vital cover.`,
        `${teamName} took advantage of the free transfer market to recruit ${playerName}. The deal costs nothing in FAAB budget.`,
        `Adding squad depth, ${teamName} has registered free agent ${playerName} to their bench ahead of the upcoming matchweek.`,
        `With squad positions available, ${teamName} completed the registration of ${playerName} on a free transfer from the open market.`,
        `${playerName} has agreed terms on a free agent move to ${teamName}. The experienced ${pos} adds depth at a zero-cost budget.`
      ];
      return templates[hash % templates.length];
    }

    case 'drop': {
      if (comp > 0) {
        const templates = [
          `To facilitate new signings, ${teamName} has released ${playerName} into the waiver pool, absorbing a contract buyout fee of €${comp}m in contract severance.`,
          `Roster space comes at a price. ${teamName} paid €${comp}m in contract severance to cut ties with ${playerName}, who now enters free agency.`,
          `In a decisive boardroom move, ${teamName} paid off ${playerName}'s remaining contract value of €${comp}m to free up an active squad slot.`,
          `Official: ${playerName} has been waived by ${teamName}. The club was forced to pay a contract severance fee of €${comp}m to complete the transaction.`,
          `Clearing squad capacity, ${teamName} terminated the registration of ${playerName}, resolving the release with a €${comp}m severance payout.`
        ];
        return templates[hash % templates.length];
      } else {
        const templates = [
          `${teamName} has waived ${playerName}, releasing him into the open market. Other managers now have 48 hours to claim the player on waivers.`,
          `To adjust roster capacity, ${teamName} has released ${playerName} to free agency. The player is now available on the open transfer market.`,
          `The contract has been dissolved. ${teamName} dropped ${playerName} into waivers, clearing space on their bench for future acquisitions.`,
          `Official release papers were filed today as ${teamName} parted ways with ${playerName}. He is now a free agent.`,
          `Roster adjustments completed: ${teamName} dropped ${playerName} to the waiver pool, ending his tenure with the club.`
        ];
        return templates[hash % templates.length];
      }
    }

    case 'transfer_out': {
      const templates = [
        `Since ${playerName} has transferred out of the Premier League, ${teamName} has been refunded €${comp}m, representing 80% of his original market value.`,
        `${playerName} has departed English shores. As a result, ${teamName} receives €${comp}m in league compensation, boosting their transfer budget.`,
        `Roster entry dissolved: ${playerName} leaves the division, and ${teamName} receives a contract compensation refund of €${comp}m.`,
        `Following ${playerName}'s transfer to a foreign league, the commissioner refunded €${comp}m back into ${teamName}'s club balance.`,
        `A budget windfall of €${comp}m was deposited to ${teamName} after ${playerName} exited the league. The roster entry has been deleted.`
      ];
      return templates[hash % templates.length];
    }

    case 'trade': {
      return tx.notes 
        ? `Trade terms finalized: ${tx.notes}. The paperwork has been validated and roster entries swapped.`
        : `A swap deal was executed by ${teamName}. Active roster positions have been updated accordingly.`;
    }

    case 'transfer_compensation': {
      return `League administration refunded €${comp}m to ${teamName} following a player transfer out of the division.`;
    }

    case 'rebate': {
      return `A refund of €${comp || faab}m scout's rebate was credited to ${teamName}'s active club balance following waiver resolution.`;
    }

    case 'draft_pick': {
      const templates = [
        `With their selection in the draft, ${teamName} has secured the registration of ${playerName}. The ${plTeam} player joins the squad.`,
        `A promising addition to the squad: ${teamName} draft room locked in ${playerName} (${pos}) to bolster their season lineup.`,
        `Draft registration confirmed: ${playerName} has officially been drafted by ${teamName} and added to the roster ledger.`,
        `Scouting reports validated: ${teamName} finalized their draft selection of ${playerName}, filling a crucial active roster slot.`,
        `The commissioner has approved ${teamName}'s draft selection of ${playerName} (${plTeam}).`
      ];
      return templates[hash % templates.length];
    }

    case 'prize_payout': {
      return tx.notes 
        ? `Prize payout: ${tx.notes}. The award has been added directly to the club's transfer balance.`
        : `Financial windfall: ${teamName} received a performance prize payout of €${faab}m from the league commissioner.`;
    }

    default: {
      return tx.notes || `Roster transaction of type ${tx.type} processed for ${teamName}.`;
    }
  }
}
