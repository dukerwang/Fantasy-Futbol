/**
 * The Wire — every movement in the league, newest first.
 *
 * Derived from the hub model rather than a new table or query. That is not just
 * an optimisation: it means the wire cannot leak, because it can only ever show
 * what `buildTransfersModel` already decided the caller may see.
 *
 *   auction bids   public by construction — `auction_state` is on the Realtime
 *                  publication and carries the whole bid history.
 *   settled trades public — `leagueFeed` is filtered to accepted/accepted_deferred,
 *                  matching the RLS policy added in 077 §5.
 *   your offers    private, and yours. `myOffers` is scoped to your own club.
 *   loans          visible to the league once they exist; terms are already on
 *                  the model.
 *   listings       public — a listing is an advertisement.
 *
 * Deliberately absent: other clubs' pending negotiations. 077 made those
 * readable only by the two parties, and rebuilding them into a public feed here
 * would undo that decision in the UI layer.
 */

import type { TransfersModel } from './buildTransfersModel';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { describeDeal } from './describeDeal';

export type WireKind = 'bid' | 'offer' | 'trade' | 'loan' | 'listing';

export interface WireEvent {
  id: string;
  kind: WireKind;
  at: string;
  /** The actor — a club name, or "You". */
  who: string;
  /** Connective text between the actor and the figure. */
  mid: string;
  /** The number or name the eye should land on. Rendered emphasised. */
  amount: string;
  tail: string;
}

const money = (n: number) => `€${n}m`;

export function buildWire(model: TransfersModel, limit = 12): WireEvent[] {
  const events: WireEvent[] = [];
  const myTeamId = model.myTeam.id;
  const nameOf = (id: string | null) =>
    id === myTeamId ? 'You' : model.allTeams.find((t) => t.id === id)?.team_name ?? 'A club';

  /** A proposal's name, off its payload — the same derivation the composer and
   *  the Deals inbox use, so the wire cannot call a deal something else. */
  const nameDeal = (t: {
    offered_players?: string[] | null;
    requested_players?: string[] | null;
    offered_rights?: string[] | null;
    requested_rights?: string[] | null;
    offered_faab: number;
    requested_faab: number;
  }) => {
    const players = (ids: string[] | null | undefined) =>
      (ids ?? []).map((id) => model.playerMap[id]).filter(Boolean)
        .map((p) => getPlayerDisplayName(p));
    const rights = (ids: string[] | null | undefined) =>
      (ids ?? []).map((id) => model.rightsMap[id]?.player).filter(Boolean)
        .map((p) => `${getPlayerDisplayName(p!)}'s rights`);
    return describeDeal({
      offered: [...players(t.offered_players), ...rights(t.offered_rights)],
      requested: [...players(t.requested_players), ...rights(t.requested_rights)],
      offeredFaab: t.offered_faab,
      requestedFaab: t.requested_faab,
    });
  };

  // Bids, from the projection's own history.
  for (const a of model.auctions) {
    const player = a.player ? getPlayerDisplayName(a.player) : 'a player';
    for (const b of a.bids) {
      events.push({
        id: `bid:${a.player_id}:${b.team_id}:${b.at}`,
        kind: 'bid',
        at: b.at,
        who: b.team_id === myTeamId ? 'You' : b.team_name,
        mid: 'bid',
        amount: money(b.amount),
        tail: `for ${player}`,
      });
    }
  }

  // Your own negotiations, in both directions.
  for (const o of model.myOffers) {
    const mine = o.team_a_id === myTeamId;
    const them = mine ? o.team_b?.team_name ?? 'a club' : o.team_a?.team_name ?? 'a club';

    if (o.status === 'pending') {
      events.push({
        id: `offer:${o.id}`,
        kind: 'offer',
        at: o.updated_at ?? o.created_at,
        who: mine ? 'You' : them,
        mid: mine ? 'sent' : 'sent you',
        // "a bid", "a part-exchange" — the shape of the deal reads better than
        // a bare cash figure, which said nothing about a player-for-player swap.
        amount: nameDeal(o).headline.toLowerCase(),
        tail: mine ? `to ${them}` : '',
      });
    }
  }

  // Settled trades — the public record.
  for (const t of model.leagueFeed) {
    events.push({
      id: `trade:${t.id}`,
      kind: 'trade',
      at: t.updated_at ?? t.created_at,
      who: t.team_a?.team_name ?? 'A club',
      mid: `and ${t.team_b?.team_name ?? 'another club'} agreed`,
      amount: nameDeal(t).headline.toLowerCase(),
      tail: '',
    });
  }

  // Loans, including the ones still awaiting an answer.
  for (const l of model.loans) {
    const player = l.player ? getPlayerDisplayName(l.player) : 'a player';
    const lender = nameOf(l.lender_team_id);
    const borrower = nameOf(l.borrower_team_id);
    events.push({
      id: `loan:${l.id}`,
      kind: 'loan',
      at: l.created_at,
      who: l.status === 'pending' ? borrower : lender,
      mid: l.status === 'pending' ? 'asked to loan' : 'loaned',
      amount: player,
      tail: l.status === 'pending' ? 'and is waiting on an answer' : `to ${borrower}`,
    });
  }

  // New listings.
  for (const l of model.listings) {
    events.push({
      id: `listing:${l.id}`,
      kind: 'listing',
      at: l.created_at,
      who: l.seller_team_id === myTeamId ? 'You' : l.seller_team_name ?? 'A club',
      mid: `listed ${l.player ? getPlayerDisplayName(l.player) : 'a player'} —`,
      // 114: a listing with no min_bid has no auction to say "from" about — it
      // falls back to the clause (release-clause-only) or, with neither price
      // set, plain "offers only".
      amount:
        l.ask_price != null ? `asking ${money(l.ask_price)}`
        : l.min_bid != null ? `from ${money(l.min_bid)}`
        : l.buy_now_price != null ? `clause ${money(l.buy_now_price)}`
        : 'offers only',
      tail: l.min_bid != null && l.buy_now_price != null ? `· clause ${money(l.buy_now_price)}` : '',
    });
  }

  return events
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, limit);
}

/** Dot colour per event kind, matching the schedule legend below it. */
export const WIRE_COLORS: Record<WireKind, string> = {
  bid: 'var(--color-warning)',
  offer: 'var(--color-accent)',
  trade: 'var(--color-pos-cb)',
  loan: 'var(--color-pos-wb)',
  listing: 'var(--color-text-muted)',
};
