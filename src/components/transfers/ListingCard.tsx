'use client';

import type { CrestConfig } from '@/components/crest/types';
import type { GranularPosition } from '@/types';
import type { TransfersAuction, TransfersListing, TransfersTeam } from '@/lib/transfers/buildTransfersModel';
import CrestBadge from '@/components/crest/CrestBadge';
import SquadPeekButton from '@/components/teams/SquadPeekButton';
import PositionBadge from '@/components/players/PositionBadge';
import { useTick, formatRemaining, isClosing } from './useTick';
import { listingStance } from '@/lib/transfers/listingStance';
import styles from './ListingCard.module.css';
import { getPlayerDisplayName, playerInitial } from '@/lib/players/displayName';

/**
 * A listing, as one card.
 *
 * A listing is four things at once — an auction block, a trade block, a sale
 * listing, and a loan block — so the card is read top to bottom as: who, for how
 * much, on what terms, and what you can do about it.
 *
 * Since 088 the chip states the seller's STANCE ("For sale · €95m", "Wants
 * players", "Open to approaches") rather than a permissions matrix. Every route
 * in is open to everyone until bidding starts; what the seller is after tells
 * you which approach is likely to land, not which one is allowed.
 *
 * Three states, distinguished by full border + background tint, never by an
 * accent sliver down one edge:
 *
 *   quiet  — listed, nobody has bid. Every route in is available.
 *   live   — bidding has started. The seller has lost control: prices are locked
 *            (PATCH refuses), the listing can no longer be cancelled, and every
 *            offer path is gone. The absence of those buttons IS the explanation;
 *            no apologetic copy is needed.
 *   mine   — your own listing. You do not bid on it; you review what came in.
 */

export interface ListingCardProps {
  listing: TransfersListing;
  /** The auction behind it. Since migration 080 every open listing has one. */
  auction: TransfersAuction | null;
  seller: TransfersTeam | undefined;
  isMine: boolean;
  /** Pending offers against this listing — only meaningful on your own card. */
  offerCount?: number;
  onBid?: (listing: TransfersListing) => void;
  onOffer?: (listing: TransfersListing) => void;
  onClause?: (listing: TransfersListing) => void;
  onLoan?: (listing: TransfersListing) => void;
  onEdit?: (listing: TransfersListing) => void;
  onReview?: (listing: TransfersListing) => void;
  onOpenPlayer?: (playerId: string) => void;
}

const money = (n: number | null | undefined) => (n == null ? '—' : `€${n}m`);

export default function ListingCard({
  listing,
  auction,
  seller,
  isMine,
  offerCount = 0,
  onBid,
  onOffer,
  onClause,
  onLoan,
  onEdit,
  onReview,
  onOpenPlayer,
}: ListingCardProps) {
  const player = listing.player;
  const live = listing.status === 'active';

  // Only subscribe to the shared tick when this card actually shows a clock.
  const expiresAt = auction?.expires_at ?? listing.auction_expires_at;
  const now = useTick(Boolean(expiresAt));
  const msLeft = expiresAt ? new Date(expiresAt).getTime() - now : 0;
  const hot = Boolean(expiresAt) && isClosing(msLeft);

  if (!player) return null;

  // The next legal bid. place_auction_bid_rpc rejects `p_bid_amount <=
  // v_highest_bid` (079), so once bidding is live the floor is one above the
  // standing bid — not the seller's original minimum, which is already beaten.
  const standing = auction?.highest_bid ?? 0;
  const bidFrom = live && standing > 0 ? standing + 1 : auction?.minimum_bid ?? listing.min_bid;

  const stance = listingStance(listing);

  const stateClass = isMine ? styles.mine : live ? styles.live : '';

  return (
    <article className={`${styles.card} ${stateClass}`}>
      <div className={styles.top}>
        <button
          type="button"
          className={styles.photoBtn}
          onClick={() => onOpenPlayer?.(player.id)}
          aria-label={`Open ${player.name}`}
        >
          {player.photo_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={player.photo_url}
              alt={getPlayerDisplayName(player, 'full')}
              className={styles.photo}
              referrerPolicy="no-referrer"
            />
          ) : (
            <span className={styles.photoFallback}>{playerInitial(player)}</span>
          )}
        </button>

        <div className={styles.identity}>
          <div className={styles.nameRow}>
            <PositionBadge position={player.primary_position as GranularPosition} size="sm" />
            <span className={styles.name}>{getPlayerDisplayName(player, 'initial_last')}</span>
          </div>
          <div className={styles.meta}>
            {player.pl_team} · {money(Number(player.market_value) || 0)} ·{' '}
            {isMine ? 'Yours' : listing.seller_team_name ?? 'Unknown club'}
          </div>
        </div>

        {/* The seller's crest opens their squad — "what else are they sitting
            on?" is the question a listing provokes, and it used to have no
            answer short of starting an offer. */}
        <SquadPeekButton
          teamId={listing.seller_team_id}
          teamName={seller?.team_name ?? listing.seller_team_name ?? undefined}
          className={styles.crest}
          title={`${seller?.team_name ?? listing.seller_team_name ?? 'Seller'} — peek at their squad`}
        >
          <CrestBadge
            config={(seller?.crest_config as CrestConfig | null) ?? null}
            teamName={seller?.team_name ?? listing.seller_team_name}
            size={24}
          />
        </SquadPeekButton>
      </div>

      {/* The three-price ladder. Live auctions swap the seller's asking price for
          the standing bid, because an asking price nobody can accept any more is
          not information — the auction has overtaken it. */}
      <div className={styles.prices}>
        <div className={styles.price}>
          <div className={styles.priceLabel}>{live ? 'Standing bid' : 'Asking'}</div>
          <div className={`${styles.priceValue} ${live ? styles.warn : styles.accent}`}>
            {live ? money(standing) : money(listing.ask_price)}
          </div>
        </div>
        <div className={styles.price}>
          <div className={styles.priceLabel}>Bid from</div>
          <div className={styles.priceValue}>{money(bidFrom)}</div>
        </div>
        <div className={`${styles.price} ${styles.priceLast}`}>
          <div className={styles.priceLabel}>Clause</div>
          <div className={`${styles.priceValue} ${listing.buy_now_price ? styles.gold : styles.priceOff}`}>
            {money(listing.buy_now_price)}
          </div>
        </div>
      </div>

      <div className={styles.gates}>
        <span className={`${styles.gate} ${live ? styles.gateShut : styles[stance.tone]}`}>
          {live ? 'Locked — bidding' : stance.headline}
        </span>
        {expiresAt && (
          <span className={`${styles.clock} ${hot ? styles.clockHot : ''}`}>
            {formatRemaining(msLeft)}
          </span>
        )}
      </div>

      <div className={styles.actions}>
        {isMine ? (
          <>
            <button type="button" className={`${styles.action} ${styles.actionBid}`} onClick={() => onReview?.(listing)}>
              {offerCount > 0 ? `Review ${offerCount} offer${offerCount === 1 ? '' : 's'}` : 'No offers yet'}
            </button>
            <button
              type="button"
              className={`${styles.action} ${styles.actionMuted} ${styles.actionLast}`}
              onClick={() => onEdit?.(listing)}
              disabled={live}
            >
              {live ? 'Locked — will sell' : 'Edit listing'}
            </button>
          </>
        ) : (
          <>
            {/* Once bidding starts the offer paths are simply gone. Short of
                that, every path is open to everyone — what the seller is after
                is stated above, not enforced here. */}
            {!live && (
              <button type="button" className={`${styles.action} ${styles.actionOffer}`} onClick={() => onOffer?.(listing)}>
                Offer
              </button>
            )}
            <button type="button" className={`${styles.action} ${styles.actionBid}`} onClick={() => onBid?.(listing)}>
              {live ? `Bid ${money(bidFrom)}` : 'Bid'}
            </button>
            {listing.buy_now_price != null && (
              <button type="button" className={`${styles.action} ${styles.actionClause}`} onClick={() => onClause?.(listing)}>
                Clause
              </button>
            )}
            {!live && (
              <button type="button" className={`${styles.action} ${styles.actionLoan}`} onClick={() => onLoan?.(listing)}>
                Loan
              </button>
            )}
          </>
        )}
      </div>
    </article>
  );
}
