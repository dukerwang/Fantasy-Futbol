/**
 * What to call a deal, read off its payload.
 *
 * Nothing about the name is stored. There is no `deal_type` column and no
 * radio button asking the proposer to declare one — a deal that sends cash for
 * one player IS a bid, whether or not anybody said so. Deriving it means the
 * composer, the Deals inbox, the activity feed, the Gazette and the emails
 * cannot drift apart, and every proposal already in the table gets a correct
 * name the moment this ships, with no backfill.
 *
 * Cash is netted before classifying. €30m out against €10m back is €20m out —
 * one direction, one number — so a deal cannot land in two categories at once.
 *
 * Retained rights count as players throughout: a claim is a body you may one
 * day field, so trading one is a swap, not a cash sale.
 */

export type DealKind =
  | 'bid'            // cash → exactly one player
  | 'purchase'       // cash → several players
  | 'swap'           // players ⇄ players, no money
  | 'part-exchange'  // players + cash → players
  | 'sale'           // players → cash
  | 'sale-cash-back' // players → players + cash
  | 'cash-only'      // money both ways and nothing else — not a deal
  | 'one-sided'      // one side is empty — a free transfer, usually an unfinished offer
  | 'empty';         // nothing on the table

/**
 * A deal as this module reads it. Players and retained rights arrive already
 * rendered as display labels, so one input serves both the classification (by
 * length) and the sentence (by content).
 */
export interface DealDescriptor {
  /** What the proposer puts up — player and retained-right labels. */
  offered: string[];
  /** What the proposer asks for. */
  requested: string[];
  offeredFaab: number;
  requestedFaab: number;
}

export interface DealDescription {
  kind: DealKind;
  /** Noun phrase for a headline — "A part-exchange". */
  headline: string;
  /** One sentence. Second person unless `proposer` is supplied. */
  sentence: string;
  /** Cash after netting. Positive flows proposer → target. */
  netFaab: number;
  /** False for `empty`, `cash-only` and `one-sided` — nothing that would be a
   *  free transfer or a bare budget move can be sent. */
  sendable: boolean;
}

const money = (n: number) => `€${Math.abs(n)}m`;

/** "Saka", "Saka and Rice", "Saka, Rice and Bowen". */
function list(names: string[]): string {
  if (names.length === 0) return 'nothing';
  if (names.length === 1) return names[0];
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** "Bowen + €30m" — what one side of the table actually contains. */
function pile(names: string[], cash: number): string {
  const parts = [...names];
  if (cash > 0) parts.push(money(cash));
  return parts.length > 0 ? parts.join(' + ') : 'nothing';
}

export function describeDeal(
  d: DealDescriptor,
  opts: { proposer?: string } = {},
): DealDescription {
  const netFaab = d.offeredFaab - d.requestedFaab;
  const givesCash = netFaab > 0;
  const getsCash = netFaab < 0;
  const givesPlayers = d.offered.length > 0;
  const getsPlayers = d.requested.length > 0;

  // Third person names the club; second person addresses the composer. A club
  // takes a plural verb throughout, as football writing does — "Arsenal send",
  // not "Arsenal sends".
  const who = opts.proposer;
  const subject = who ?? 'You';
  const v = (thirdPerson: string, secondPerson: string) => (who ? thirdPerson : secondPerson);

  const out = (kind: DealKind, headline: string, sentence: string): DealDescription => ({
    kind,
    headline,
    sentence,
    netFaab,
    sendable: kind !== 'empty' && kind !== 'cash-only' && kind !== 'one-sided',
  });

  if (!givesPlayers && !getsPlayers) {
    // Money for money moves budget between clubs without moving a footballer.
    // `POST /trades` refuses it; saying so here means nobody builds one first.
    if (givesCash || getsCash) {
      return out(
        'cash-only',
        'Not a deal',
        'Cash for cash just moves budget around — put a player or a retained right on the table.',
      );
    }
    return out('empty', 'Nothing yet', 'Nothing on the table yet.');
  }

  // Cash one way, bodies the other.
  if (!givesPlayers && givesCash) {
    const single = d.requested.length === 1;
    return out(
      single ? 'bid' : 'purchase',
      single ? 'A bid' : 'A purchase',
      // You bid for a man and offer for a group — "bid €90m for Saka, Rice and
      // Bowen" reads like three separate bids.
      `${subject} ${single ? 'bid' : 'offer'} ${money(netFaab)} for ${list(d.requested)}.`,
    );
  }

  if (!getsPlayers && getsCash) {
    return out(
      'sale',
      'A sale',
      `${subject} ${v('sell', 'sell')} ${list(d.offered)} for ${money(netFaab)}.`,
    );
  }

  // One side is empty. Anything with cash on it was caught above, so reaching
  // here with an empty side means literally nothing is being put up — a free
  // transfer. Most often it is an unfinished offer: the cash line was added and
  // left at zero, which looked identical to a completed one until the recipient
  // opened it. Refused rather than named, in both directions.
  if (!givesPlayers) {
    return out(
      'one-sided',
      'Nothing offered',
      `${subject} ${v('are asking', 'are asking')} for ${list(d.requested)} and putting nothing up.`,
    );
  }
  if (!getsPlayers) {
    return out(
      'one-sided',
      'Nothing asked',
      `${subject} ${v('are giving up', 'are giving up')} ${list(d.offered)} and asking for nothing back.`,
    );
  }

  // Bodies both ways.
  if (!givesCash && !getsCash) {
    return out(
      'swap',
      'A swap',
      `${list(d.offered)} for ${list(d.requested)}, straight.`,
    );
  }

  if (givesCash) {
    return out(
      'part-exchange',
      'A part-exchange',
      v(
        `${subject} send ${pile(d.offered, netFaab)} for ${list(d.requested)}.`,
        `You send ${pile(d.offered, netFaab)}, you receive ${list(d.requested)}.`,
      ),
    );
  }

  return out(
    'sale-cash-back',
    'A sale, with cash back',
    v(
      `${subject} send ${list(d.offered)} for ${pile(d.requested, -netFaab)}.`,
      `You send ${list(d.offered)}, you receive ${pile(d.requested, -netFaab)}.`,
    ),
  );
}
