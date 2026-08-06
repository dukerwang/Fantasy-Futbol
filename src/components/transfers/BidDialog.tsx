'use client';

import { useMemo, useState } from 'react';
import type { GranularPosition } from '@/types';
import type {
  EnrichedPlayer,
  RosterPlayer,
  TransfersAuction,
  TransfersListing,
} from '@/lib/transfers/buildTransfersModel';
import PositionBadge from '@/components/players/PositionBadge';
import Modal from './Modal';
import { useTick, formatRemaining } from './useTick';
import styles from './BidDialog.module.css';
import { getPlayerDisplayName } from '@/lib/players/displayName';

/**
 * Bidding, and the release clause, in one dialog.
 *
 * They are the same request — `POST /auctions/bid` with a different number —
 * and the RPC resolves a bid at or above `buy_now_price` inline rather than
 * waiting for the sweep (079 §3). Splitting them into two dialogs would have
 * meant two forms that submit identically and one shared roster-drop picker.
 *
 * `mode` only decides what the amount field starts at and how the button reads;
 * the manager is free to type any legal number in either mode.
 */

export type BidMode = 'bid' | 'clause';

interface Props {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  player: EnrichedPlayer;
  /** Null for a free agent with no auction open yet — the first bid opens one. */
  auction: TransfersAuction | null;
  listing: TransfersListing | null;
  mode: BidMode;
  budget: number;
  /** Sum of this club's open bids across all auctions; disclosure only. */
  committedTotal?: number;
  /** How many auctions currently carry one of those bids. */
  openBidCount?: number;
  /** Required when the active roster is full: whoever comes off to make room. */
  rosterFull: boolean;
  myRoster: RosterPlayer[];
  bidFloor?: number;
  onDone: () => void;
}

const money = (n: number) => `€${n}m`;

export default function BidDialog({
  open,
  onClose,
  leagueId,
  player,
  auction,
  listing,
  mode,
  budget,
  committedTotal = 0,
  openBidCount = 0,
  rosterFull,
  myRoster,
  bidFloor = 0.5,
  onDone,
}: Props) {
  const standing = auction?.highest_bid ?? 0;
  const live = listing ? listing.status === 'active' : standing > 0;

  // The floor, resolved the same way the server will resolve it: one above the
  // standing bid when there is one, otherwise the listing's minimum or the
  // free-agent bid floor (default 50% of market value) that buildTransfersModel
  // already computed into `minimum_bid`.
  const floor = useMemo(() => {
    if (standing > 0) return standing + 1;
    // A listing with no min_bid (114) has no auction floor at all — the dialog
    // should only reach this in 'clause' mode for one of those, which reads
    // `clause` below instead, but the fallback still has to be a real number.
    if (listing) return listing.min_bid ?? listing.buy_now_price ?? 0;
    if (auction) return auction.minimum_bid ?? Math.floor((Number(player.market_value) || 0) * bidFloor);
    return Math.floor((Number(player.market_value) || 0) * bidFloor);
  }, [standing, listing, auction, player.market_value, bidFloor]);

  const clause = listing?.buy_now_price ?? null;
  const opening = mode === 'clause' && clause != null ? clause : floor;

  const [amount, setAmount] = useState<number>(opening);
  const [dropId, setDropId] = useState<string>('');
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Re-seed when the dialog is reopened for a different player or mode.
  const [seed, setSeed] = useState(`${player.id}:${mode}`);
  if (seed !== `${player.id}:${mode}`) {
    setSeed(`${player.id}:${mode}`);
    setAmount(opening);
    setDropId('');
    setMessage(null);
  }

  const expiresAt = auction?.expires_at ?? listing?.auction_expires_at ?? null;
  const now = useTick(open && Boolean(expiresAt));
  const msLeft = expiresAt ? new Date(expiresAt).getTime() - now : 0;

  // A drop is only demanded when the roster is full AND the academy cannot
  // absorb the arrival — the route decides that itself, so this is an offer of
  // a drop rather than a hard gate, and the server still has the final word.
  const droppable = myRoster.filter((r) => r.status !== 'loan_in' && r.id !== player.id);

  const tooExpensive = !Number.isNaN(amount) && amount > budget;
  const belowFloor = Number.isNaN(amount) || amount < floor;
  const wouldTakeClause = clause != null && !Number.isNaN(amount) && amount >= clause;
  const overCommitted = committedTotal > budget;

  const submit = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/auctions/bid`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          playerId: player.id,
          bidAmount: amount,
          dropPlayerId: dropId || null,
          saleListingId: listing?.id ?? null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMessage(data.error ?? 'That bid was not accepted.');
        return;
      }
      onDone();
      onClose();
    } catch {
      setMessage('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={mode === 'clause' ? 'Trigger the release clause' : live ? 'Raise your bid' : 'Open the bidding'}
      footer={
        <>
          <span className={styles.summary}>
            {wouldTakeClause && clause != null ? (
              <>Pays <b>{money(amount)}</b> and takes him now — the clause ends the auction.</>
            ) : (
              <>Leaves you <b>{money(Math.max(0, budget - (Number.isNaN(amount) ? 0 : amount)))}</b> for the rest of the window.</>
            )}
          </span>
          <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            type="button"
            className={styles.go}
            onClick={submit}
            disabled={busy || belowFloor || tooExpensive}
          >
            {busy ? 'Sending…' : wouldTakeClause ? `Pay ${money(amount)}` : `Bid ${money(amount)}`}
          </button>
        </>
      }
    >
      <div className={styles.identity}>
        <PositionBadge position={player.primary_position as GranularPosition} size="sm" />
        <span className={styles.name}>{getPlayerDisplayName(player, 'full')}</span>
        <span className={styles.meta}>
          {player.pl_team} · {money(Number(player.market_value) || 0)}
          {listing?.seller_team_name ? ` · ${listing.seller_team_name}` : ' · free agent'}
        </span>
      </div>

      <div className={styles.ladder}>
        <div className={styles.rung}>
          <div className={styles.rungLabel}>{live ? 'Standing bid' : 'No bids yet'}</div>
          <div className={`${styles.rungValue} ${live ? styles.warn : styles.off}`}>
            {live ? money(standing) : '—'}
          </div>
        </div>
        <div className={styles.rung}>
          <div className={styles.rungLabel}>Minimum</div>
          <div className={styles.rungValue}>{money(floor)}</div>
        </div>
        <div className={styles.rung}>
          <div className={styles.rungLabel}>Clause</div>
          <div className={`${styles.rungValue} ${clause != null ? styles.gold : styles.off}`}>
            {clause != null ? money(clause) : '—'}
          </div>
        </div>
        <div className={styles.rung}>
          <div className={styles.rungLabel}>Closes</div>
          <div className={styles.rungValue}>{expiresAt ? formatRemaining(msLeft) : '—'}</div>
        </div>
      </div>

      <label className={styles.field}>
        <span className={styles.fieldLabel}>Your bid</span>
        <div className={styles.amountRow}>
          <span className={styles.currency}>€</span>
          <input
            className={styles.amount}
            type="number"
            min={floor}
            step={1}
            value={Number.isNaN(amount) ? '' : amount}
            onFocus={(e) => e.target.select()}
            onChange={(e) => {
              const raw = e.target.value;
              if (raw === '') {
                setAmount(NaN);
                return;
              }
              const n = parseInt(raw, 10);
              setAmount(Number.isNaN(n) ? NaN : n);
            }}
          />
          <span className={styles.suffix}>m</span>
        </div>
        <div className={styles.hint}>
          Minimum {money(floor)} · Club Balance {money(budget)}
        </div>
        {openBidCount > 0 && (
          <p className={overCommitted ? styles.error : styles.hint}>
            {money(committedTotal)} committed across {openBidCount} open bid
            {openBidCount === 1 ? '' : 's'} · {money(budget)} Club Balance
            {overCommitted && (
              <>
                {' '}— your open bids exceed your Club Balance. If several
                resolve together you will only win the ones you can afford.
              </>
            )}
          </p>
        )}
      </label>

      {rosterFull && (
        <label className={styles.field}>
          <span className={styles.fieldLabel}>Who comes off</span>
          <select className={styles.select} value={dropId} onChange={(e) => setDropId(e.target.value)}>
            <option value="">Send him to the academy if there is room</option>
            {droppable.map((r) => (
              <option key={r.id} value={r.id}>
                {getPlayerDisplayName(r, 'full')} · {r.primary_position} · {money(Number(r.market_value) || 0)}
              </option>
            ))}
          </select>
          <div className={styles.hint}>
            Your squad is full. Nominate a player to release if you win, or leave this and he joins
            the academy — the bid is refused if neither has room.
          </div>
        </label>
      )}

      {belowFloor && <p className={styles.error}>The minimum bid is {money(floor)}.</p>}
      {tooExpensive && <p className={styles.error}>That is more than your {money(budget)} balance.</p>}
      {message && <p className={styles.error}>{message}</p>}
    </Modal>
  );
}
