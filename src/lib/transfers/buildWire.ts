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
    const players = [...(o.requested_players ?? []), ...(o.offered_players ?? [])];
    const first = players[0] ? model.playerMap[players[0]] : null;
    const subject = first ? getPlayerDisplayName(first) : 'a deal';

    if (o.status === 'pending') {
      events.push({
        id: `offer:${o.id}`,
        kind: 'offer',
        at: o.updated_at ?? o.created_at,
        who: mine ? 'You' : them,
        mid: o.sale_listing_id ? 'offered' : 'proposed a trade —',
        amount: o.offered_faab ? money(o.offered_faab) : subject,
        tail: mine ? `to ${them}` : 'to you',
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
      mid: `and ${t.team_b?.team_name ?? 'another club'} agreed a trade —`,
      amount: `${(t.offered_players?.length ?? 0) + (t.requested_players?.length ?? 0)} players`,
      tail: t.offered_faab || t.requested_faab ? `+ ${money(t.offered_faab || t.requested_faab)}` : '',
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
      amount: l.ask_price != null ? `asking ${money(l.ask_price)}` : `from ${money(l.min_bid)}`,
      tail: l.buy_now_price != null ? `· clause ${money(l.buy_now_price)}` : '',
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
