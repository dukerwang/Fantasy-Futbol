import { getPlayerDisplayName } from '@/lib/players/displayName';

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
  id: string;
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
  const teamName = tx.team?.team_name ? `**${tx.team.team_name}**` : 'Unknown Club';
  const player = tx.player;
  const playerName = player ? `**p:${player.id}:${getPlayerDisplayName(player as any, 'full')}**` : 'Unknown Player';
  const faab = tx.faab_bid ?? 0;
  const comp = tx.compensation_amount ? Number(tx.compensation_amount) : 0;

  switch (tx.type) {
    case 'waiver_claim': {
      if (faab >= 40) {
        const templates = [
          `${teamName} smashes contract records to sign ${playerName}!`,
          `${teamName} splurges €${faab}m to secure ${playerName}`,
          `${teamName} wins intense race for ${playerName} in €${faab}m coup`,
          `${playerName} puts pen to paper on €${tx.faab_bid}m move to ${teamName}`,
          `${teamName} pulls off massive signing, welcoming ${playerName}`,
          `${teamName} prevails in bidding war for superstar ${playerName}`,
          `${teamName} adds defensive/offensive reinforcement ${playerName} for €${faab}m`,
          `${teamName} splashes cash to bring in ${playerName}`,
          `${playerName} seals big-money transfer to ${teamName}`,
          `${teamName} wins high-stakes bidding for ${playerName}`
        ];
        return templates[hash % templates.length];
      } else {
        const templates = [
          `${teamName} secures the signature of ${playerName} (€${faab}m)`,
          `${playerName} joins ${teamName} after board approval`,
          `${teamName} adds roster depth with ${playerName} (€${faab}m)`,
          `${teamName} secures ${playerName} in auction process`,
          `${playerName} finalized by ${teamName} on a €${faab}m deal`,
          `${playerName} makes the switch to ${teamName}`,
          `${teamName} completes deal for ${playerName}`,
          `${playerName} drafted into ${teamName} starting pool`,
          `${playerName} headed to ${teamName} following auction`,
          `${teamName} welcomes ${playerName} after successful waiver claim`
        ];
        return templates[hash % templates.length];
      }
    }

    case 'free_agent_pickup': {
      const templates = [
        `${teamName} snaps up ${playerName} on a free transfer`,
        `${playerName} joins ${teamName} to bolster bench strength`,
        `${teamName} secures free agent ${playerName}`,
        `${playerName} signs deal with ${teamName} out of free agency`,
        `${teamName} adds ${playerName} on a free deal`,
        `${teamName} welcomes free agent ${playerName} to the squad`,
        `${playerName} seals move to ${teamName} roster`,
        `${teamName} picks up ${playerName} from free agency`,
        `${playerName} completes free transfer to ${teamName}`,
        `Free agent ${playerName} puts pen to paper for ${teamName}`
      ];
      return templates[hash % templates.length];
    }

    case 'drop': {
      if (comp > 0) {
        const templates = [
          `${playerName} released by ${teamName} (Paid €${comp}m)`,
          `${teamName} cuts ties with ${playerName} at €${comp}m severance cost`,
          `${playerName} shown the exit door at ${teamName} after severance payout`,
          `${teamName} terminates contract for ${playerName}, paying contract clause`,
          `${teamName} clears roster spot, paying €${comp}m severance for ${playerName}`,
          `${teamName} pays €${comp}m to release ${playerName} to waivers`,
          `${playerName} released from ${teamName} duties after buyout fee`,
          `${playerName} waived by ${teamName} following €${comp}m severance agreement`,
          `${teamName} releases ${playerName} into waiver pool, absorbing buyout`,
          `${teamName} pays contract severance to release ${playerName}`
        ];
        return templates[hash % templates.length];
      } else {
        const templates = [
          `${playerName} released by ${teamName} to free agency`,
          `${teamName} cuts ties with ${playerName}`,
          `${playerName} parted ways with ${teamName}`,
          `${teamName} drops ${playerName} to the waiver pool`,
          `${playerName} released from ${teamName} roster`,
          `${teamName} waives backup player ${playerName}`,
          `${playerName} shown exit door by ${teamName}`,
          `${playerName} sent to free agency by ${teamName}`,
          `${teamName} drops defender/midfielder ${playerName}`,
          `${playerName} released into waivers by ${teamName}`
        ];
        return templates[hash % templates.length];
      }
    }

    case 'transfer_out': {
      const templates = [
        `${playerName} departs PL; ${teamName} recovers €${comp}m`,
        `${playerName} leaves the league, returning budget to ${teamName}`,
        `${playerName} transferred out of Premier League; €${comp}m refunded`,
        `${playerName} departs; ${teamName} collects €${comp}m compensation`,
        `${playerName} leaves division, returning €${comp}m to ${teamName} vault`,
        `${playerName} transfers abroad; ${teamName} receives €${comp}m`,
        `${playerName} bids farewell to PL; €${comp}m returned to ${teamName}`,
        `${playerName} departs the league, returning contract equity`,
        `${playerName} exits English top flight; €${comp}m refunded`,
        `${playerName} transferred out; ${teamName} pockets €${comp}m return`
      ];
      return templates[hash % templates.length];
    }

    case 'trade': {
      const templates = [
        `${teamName} completes player swap deal`,
        `Managers finalize roster swap involving ${teamName}`,
        `Trade agreement resolved for ${teamName}`,
        `${teamName} executes trade to rebuild starting depth`,
        `Trade paperwork signed for ${teamName}`,
        `${teamName} completes trade negotiations`,
        `Trade confirmed for ${teamName}`,
        `Mutual agreement: teams finalize trade package`,
        `${teamName} executes trade swap`,
        `Negotiations finalized: trade completed by ${teamName}`
      ];
      return templates[hash % templates.length];
    }

    case 'transfer_compensation': {
      return `${teamName} received €${comp}m budget return for ${playerName}`;
    }

    case 'rebate': {
      return `${teamName} refunded €${comp || faab}m for player release`;
    }

    case 'draft_pick': {
      const templates = [
        `${teamName} selects ${playerName}`,
        `${teamName} locks in ${playerName} during draft`,
        `${playerName} selected by ${teamName}`,
        `${teamName} recruits prospect ${playerName}`,
        `${playerName} drafted by ${teamName} board`,
        `${teamName} registers ${playerName} into active squad`,
        `${playerName} joins ${teamName} via draft system`,
        `${playerName} added to ${teamName}`,
        `${teamName} locks in draft choice ${playerName}`,
        `${playerName} joins ${teamName} following draft selection`
      ];
      return templates[hash % templates.length];
    }

    case 'prize_payout': {
      return `${teamName} received prize payout (+€${faab}m)`;
    }

    default: {
      return tx.notes || `${teamName} processed type ${tx.type}`;
    }
  }
}
