'use client';

import { useMemo, useState } from 'react';
import type { GranularPosition } from '@/types';
import type { RosterPlayer, TransfersListing } from '@/lib/transfers/buildTransfersModel';
import PositionBadge from '@/components/players/PositionBadge';
import Modal from './Modal';
import styles from './ListingEditor.module.css';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { listingStance } from '@/lib/transfers/listingStance';

/**
 * List a player, or edit a listing that has not been bid on yet.
 *
 * The three flags are the substance of this dialog, and since 088 they state
 * INTENT rather than permission: what the seller is after, not what they will
 * allow. Nothing here refuses an approach — every route in stays open until
 * bidding starts — so ticking none of them is a stance too ("make me an
 * offer"), and the preview below shows the seller the headline the rest of the
 * league will read. The auction is mandatory and runs either way, which is why
 * there is no switch for it.
 *
 * The one price that binds is `minBid`: the 80%-of-market-value trigger sets
 * where it can sit, and a cash offer must clear it. That is about not
 * undercutting your own auction, not about taste. The asking price is optional
 * advertising, and only the release clause executes on contact.
 *
 * Editing stops the moment bidding starts: `PATCH /listings/[id]` refuses a
 * listing at status 'active' because managers have committed budget against the
 * advertised prices. The card does not offer Edit in that state, so reaching
 * here with a live listing means a bid landed while the dialog was open — the
 * 409 from the route is the honest answer.
 */

interface Props {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  /** Editing an existing listing, or null to create a new one. */
  listing: TransfersListing | null;
  /** Squad to pick from when creating. Ignored when editing. */
  myRoster: RosterPlayer[];
  /** Pre-selects the player when creating — the entry point from a player's own file. */
  initialPlayerId?: string | null;
  /** Defaults the stated intent when creating, e.g. loan-leaning from a "list for loan" CTA. */
  initialGates?: { trade: boolean; sale: boolean; loan: boolean };
  onDone: () => void;
}

const money = (n: number) => `€${n}m`;

/** The 80% market-value floor for a roster player, so a new listing can default to it. */
function floorFor(roster: RosterPlayer[], pid: string): number {
  const mv = Number(roster.find((p) => p.id === pid)?.market_value) || 0;
  return mv > 0 ? Math.floor(mv * 0.8) : 0;
}

export default function ListingEditor({
  open, onClose, leagueId, listing, myRoster, initialPlayerId, initialGates, onDone,
}: Props) {
  const editing = Boolean(listing);

  const [playerId, setPlayerId] = useState<string>(listing?.player_id ?? initialPlayerId ?? '');
  // Defaults to the 80% floor for a new listing — most sellers want the open
  // auction, so that stays the path of least resistance — but since 114 it can
  // be cleared to null: no minimum bid means no open auction at all, only
  // whatever the release clause and/or asking price allow.
  const [minBid, setMinBid] = useState<number | null>(listing?.min_bid ?? floorFor(myRoster, initialPlayerId ?? ''));
  const [askPrice, setAskPrice] = useState<number | null>(listing?.ask_price ?? null);
  const [clause, setClause] = useState<number | null>(listing?.buy_now_price ?? null);
  const [gateTrade, setGateTrade] = useState(listing?.open_to_trade ?? initialGates?.trade ?? true);
  const [gateSale, setGateSale] = useState(listing?.open_to_sale ?? initialGates?.sale ?? true);
  const [gateLoan, setGateLoan] = useState(listing?.open_to_loan ?? initialGates?.loan ?? false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seedKey = `${listing?.id ?? 'new'}:${initialPlayerId ?? ''}:${open}`;
  const [seed, setSeed] = useState(seedKey);
  if (seed !== seedKey) {
    setSeed(seedKey);
    setPlayerId(listing?.player_id ?? initialPlayerId ?? '');
    setMinBid(listing?.min_bid ?? floorFor(myRoster, initialPlayerId ?? ''));
    setAskPrice(listing?.ask_price ?? null);
    setClause(listing?.buy_now_price ?? null);
    setGateTrade(listing?.open_to_trade ?? initialGates?.trade ?? true);
    setGateSale(listing?.open_to_sale ?? initialGates?.sale ?? true);
    setGateLoan(listing?.open_to_loan ?? initialGates?.loan ?? false);
    setError(null);
  }

  // Only players who can actually be listed: `POST /listings` refuses anyone
  // loaned in or out, so offering them here would be a guaranteed rejection.
  const listable = useMemo(
    () => myRoster.filter((p) => p.status !== 'loan_in' && p.status !== 'loan_out'),
    [myRoster],
  );

  const selected = editing
    ? listing?.player
    : listable.find((p) => p.id === playerId);

  const marketValue = Number(selected?.market_value) || 0;
  // The 077 trigger is the real enforcement; this mirrors it so the seller sees
  // the number instead of a raised exception.
  const floor = marketValue > 0 ? Math.floor(marketValue * 0.8) : 0;

  // Empty-while-typing is stored as NaN so the box can clear without saving a
  // half-typed number; a resting null (all three prices can be null since 114)
  // is a real, valid state, not an incomplete one.
  const minBidSet = minBid != null && !Number.isNaN(minBid);
  const askSet = askPrice != null && !Number.isNaN(askPrice);
  const clauseSet = clause != null && !Number.isNaN(clause);

  // The floor only binds an auction that exists.
  const belowFloor = minBidSet && (minBid as number) < floor;
  // An ask below the floor would advertise a price nobody is allowed to pay —
  // but only when there's a floor to sit above. An ABSENT ask is fine since
  // 088 — it means the seller has not named a number, not that he is
  // unavailable.
  const askInvalid = askSet && minBidSet && (askPrice as number) < (minBid as number);
  const askAboveClause = askSet && clauseSet && (askPrice as number) >= (clause as number);
  // With no auction, the clause just needs to be a real positive price rather
  // than sit above a floor that doesn't exist.
  const clauseInvalid = clauseSet && (minBidSet ? (clause as number) <= (minBid as number) : (clause as number) <= 0);
  const pricesIncomplete =
    Number.isNaN(minBid as number) || Number.isNaN(askPrice as number) || Number.isNaN(clause as number);
  // Mirrors player_sale_listings_states_a_price (114): a listing needs at
  // least one price to be shaped around, or there's nothing here to save.
  const noPriceStated = !minBidSet && !askSet && !clauseSet;

  // Ticking nothing is a legitimate stance now ("make me an offer"), so there is
  // no longer an inert listing to refuse based on the trade/sale/loan gates.
  const canSave =
    !busy &&
    Boolean(editing || playerId) &&
    !pricesIncomplete &&
    !noPriceStated &&
    !belowFloor &&
    !askInvalid &&
    !askAboveClause &&
    !clauseInvalid;

  const stance = listingStance({
    open_to_trade: gateTrade,
    open_to_sale: gateSale,
    open_to_loan: gateLoan,
    ask_price: askSet ? (askPrice as number) : null,
    min_bid: minBidSet ? (minBid as number) : null,
    buy_now_price: clauseSet ? (clause as number) : null,
  });

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const payload = {
        minBid,
        // Kept whatever the seller typed. It used to be nulled unless the cash
        // gate was on; now the ask is independent advertising, so a seller who
        // is chiefly after players can still say what he'd take in cash.
        askPrice,
        buyNowPrice: clause,
        openToTrade: gateTrade,
        openToSale: gateSale,
        openToLoan: gateLoan,
      };

      const res = editing
        ? await fetch(`/api/leagues/${leagueId}/listings/${listing!.id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
          })
        : await fetch(`/api/leagues/${leagueId}/listings`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...payload, playerId }),
          });

      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'That listing was not accepted.');
        return;
      }

      // A seller who just raised their ask should know somebody is mid-negotiation.
      const stranded =
        (data.outstandingOffers?.length ?? 0) + (data.outstandingLoans?.length ?? 0);
      if (stranded > 0) {
        setError(
          `Saved. Note ${stranded} approach${stranded === 1 ? '' : 'es'} already in flight ` +
            'still stand on the old terms — they are not withdrawn by this edit.',
        );
      }

      onDone();
      if (stranded === 0) onClose();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const cancelListing = async () => {
    if (!listing) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/listings/${listing.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'That listing could not be withdrawn.');
        return;
      }
      onDone();
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Edit listing' : 'List a player'}
      footer={
        <>
          {editing && (
            <button type="button" className={styles.danger} onClick={cancelListing} disabled={busy}>
              Withdraw
            </button>
          )}
          <span className={styles.spacer} />
          <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.go} onClick={save} disabled={!canSave}>
            {busy ? 'Saving…' : editing ? 'Save terms' : 'List him'}
          </button>
        </>
      }
    >
      {!editing && !initialPlayerId && (
        <div className={styles.section}>
          <span className={styles.label}>Who</span>
          <select
            className={styles.select}
            value={playerId}
            onChange={(e) => {
              const pid = e.target.value;
              setPlayerId(pid);
              setMinBid(floorFor(myRoster, pid));
            }}
          >
            <option value="">Choose a player…</option>
            {listable.map((p) => (
              <option key={p.id} value={p.id}>
                {getPlayerDisplayName(p, 'full')} · {p.primary_position} · {money(Number(p.market_value) || 0)}
              </option>
            ))}
          </select>
        </div>
      )}

      {selected && (
        <div className={styles.identity}>
          <PositionBadge position={selected.primary_position as GranularPosition} size="sm" />
          <span className={styles.name}>{getPlayerDisplayName(selected, 'full')}</span>
          <span className={styles.meta}>
            {selected.pl_team} · valued {money(marketValue)}
            {floor > 0 && ` · floor ${money(floor)}`}
          </span>
        </div>
      )}

      <div className={styles.section}>
        <span className={styles.label}>What you&rsquo;re after</span>
        <div className={styles.gates}>
          <label className={`${styles.gate} ${gateSale ? styles.gateOn : ''}`}>
            <input type="checkbox" checked={gateSale} onChange={(e) => setGateSale(e.target.checked)} />
            <span>
              <b>Cash</b>
              <em>You&rsquo;d rather have the budget than a body.</em>
            </span>
          </label>
          <label className={`${styles.gate} ${gateTrade ? styles.gateOn : ''}`}>
            <input type="checkbox" checked={gateTrade} onChange={(e) => setGateTrade(e.target.checked)} />
            <span>
              <b>Players</b>
              <em>You&rsquo;re shopping for a squad, not a balance.</em>
            </span>
          </label>
          <label className={`${styles.gate} ${gateLoan ? styles.gateOn : ''}`}>
            <input type="checkbox" checked={gateLoan} onChange={(e) => setGateLoan(e.target.checked)} />
            <span>
              <b>A loan</b>
              <em>Happy to let him go out and come back.</em>
            </span>
          </label>
        </div>
        <p className={styles.hint}>
          Advisory only — anyone may still approach you any way they like. This sorts the board and
          sets the headline other managers read.
        </p>
      </div>

      <div className={styles.section}>
        <span className={styles.label}>How the board will read him</span>
        <div className={styles.stance}>
          <b>{stance.headline}</b>
          {/* With no minimum bid, the headline already states the mechanism
              (release-clause-only / offers-only) — a second "bid from" line
              here would just repeat it in a different order. */}
          {minBidSet && (
            <span>
              bid from {money(minBid as number)}
              {clauseSet ? ` · clause ${money(clause as number)}` : ''}
            </span>
          )}
        </div>
      </div>

      <div className={styles.section}>
        <span className={styles.label}>Prices</span>
        <div className={styles.prices}>
          <label className={styles.priceField}>
            <span className={styles.priceLabel}>Minimum bid</span>
            <input
              className={styles.priceInput}
              type="number"
              min={floor}
              value={minBidSet ? (minBid as number) : ''}
              placeholder="No auction"
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  // Blank is a real, valid state since 114 — not "incomplete
                  // number," but "no open auction on this listing at all."
                  setMinBid(null);
                  return;
                }
                const n = parseInt(raw, 10);
                setMinBid(Number.isNaN(n) ? NaN : Math.max(0, n));
              }}
            />
          </label>
          <label className={styles.priceField}>
            <span className={styles.priceLabel}>Asking price</span>
            <input
              className={styles.priceInput}
              type="number"
              value={askPrice == null || Number.isNaN(askPrice) ? '' : askPrice}
              placeholder="—"
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  setAskPrice(null);
                  return;
                }
                const n = parseInt(raw, 10);
                setAskPrice(Number.isNaN(n) ? NaN : Math.max(0, n));
              }}
            />
          </label>
          <label className={styles.priceField}>
            <span className={styles.priceLabel}>Release clause</span>
            <input
              className={styles.priceInput}
              type="number"
              value={clause == null || Number.isNaN(clause) ? '' : clause}
              placeholder="—"
              onFocus={(e) => e.target.select()}
              onChange={(e) => {
                const raw = e.target.value;
                if (raw === '') {
                  setClause(null);
                  return;
                }
                const n = parseInt(raw, 10);
                setClause(Number.isNaN(n) ? NaN : Math.max(0, n));
              }}
            />
          </label>
        </div>
        <p className={styles.hint}>
          Set only what applies — a minimum bid opens him to auction, a release clause allows an
          instant buy, and an asking price invites offers. Leave a field blank to turn that route off.
          The asking price is advertising: meeting it sends an offer you still have to accept. Only
          the release clause executes on contact.
        </p>
      </div>

      {belowFloor && floor > 0 && (
        <p className={styles.error}>
          The minimum bid must be at least {money(floor)} — 80% of his {money(marketValue)} market value.
        </p>
      )}
      {askInvalid && (
        <p className={styles.error}>An asking price cannot sit below the {money(minBid as number)} minimum bid.</p>
      )}
      {askAboveClause && <p className={styles.error}>The asking price must sit below the release clause.</p>}
      {clauseInvalid && (
        <p className={styles.error}>
          {minBidSet ? 'The release clause must sit above the minimum bid.' : 'The release clause must be a positive amount.'}
        </p>
      )}
      {noPriceStated && (
        <p className={styles.error}>Set at least one of a minimum bid, a release clause, or an asking price.</p>
      )}
      {error && <p className={styles.error}>{error}</p>}
    </Modal>
  );
}
