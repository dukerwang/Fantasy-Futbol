'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GranularPosition, Player } from '@/types';
import type { TransfersAuction, TransfersModel } from '@/lib/transfers/buildTransfersModel';
import type { CrestConfig } from '@/components/crest/types';
import CrestBadge from '@/components/crest/CrestBadge';
import PositionBadge from '@/components/players/PositionBadge';
import Portrait from '@/components/players/Portrait';
import { playerHoverProps, usePlayerCard } from '@/components/players/PlayerCardProvider';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import TransfersSubNav from '@/components/transfers/TransfersSubNav';
import BidDialog, { type BidMode } from '@/components/transfers/BidDialog';
import { setServerClock, useTick, formatAuctionClock, isClosing } from '@/components/transfers/useTick';
import { useLiveTransfers } from '@/components/transfers/useLiveTransfers';
import styles from './auctions.module.css';

/**
 * The Auction Room.
 *
 * Rows, not cards. An auction is a ladder of time and money, and a row lets a
 * dozen of them be compared down a single column — which card grids cannot do.
 *
 * Free agents and listed players sit in one list, distinguished by a tag rather
 * than separated into sections, because the only thing that orders this page is
 * what closes first. Whose player he is matters when you are shopping; it does
 * not matter when you are deciding where to put the next €10m.
 *
 * This page does not replace the inline auction states on Listings and Free
 * Agency. A player under the hammer stays where you would already look for him;
 * this is the cross-cutting view, and the only place bid history lives.
 */

type Facet = 'all' | 'closing' | 'leading' | 'outbid' | 'free' | 'listed' | 'affordable';

const money = (n: number) => `€${n}m`;
const bids = (n: number) => `${n} bid${n === 1 ? '' : 's'}`;

export default function AuctionsClient({
  leagueId,
  initial,
}: {
  leagueId: string;
  initial: TransfersModel;
}) {
  const router = useRouter();
  const model = useLiveTransfers(leagueId, initial);
  const { openPlayer, primePlayers } = usePlayerCard();

  const [facet, setFacet] = useState<Facet>('all');
  const [openLot, setOpenLot] = useState<string | null>(null);
  const [bid, setBid] = useState<{ auction: TransfersAuction; mode: BidMode } | null>(null);
  const refresh = () => router.refresh();

  useEffect(() => { setServerClock(model.serverNow); }, [model.serverNow]);
  useEffect(() => {
    const rows = Object.values(model.playerMap) as unknown as Player[];
    if (rows.length) primePlayers(rows);
  }, [model.playerMap, primePlayers]);

  const now = useTick(true);
  const me = model.myTeam.id;
  const budget = model.myTeam.faab_budget;

  const teamById = useMemo(() => new Map(model.allTeams.map((t) => [t.id, t])), [model.allTeams]);
  const listingById = useMemo(
    () => new Map(model.listings.map((l) => [l.id, l])),
    [model.listings],
  );

  /**
   * The auction room only shows lots that actually have a bid ladder. A
   * listing with no min_bid (114) — release-clause-only or negotiation-only —
   * has nothing to bid on here; it stays reachable only from the Listings
   * board via Offer/Clause. Free-agent auctions always have a floor, so they
   * pass through unfiltered.
   */
  const biddableAuctions = useMemo(
    () =>
      model.auctions.filter((a) => {
        if (a.kind !== 'listing') return true;
        const listing = a.sale_listing_id ? listingById.get(a.sale_listing_id) : undefined;
        return listing ? listing.min_bid != null : true;
      }),
    [model.auctions, listingById],
  );

  /** The cheapest legal way in right now. */
  const nextBid = (a: TransfersAuction) => (a.highest_bid > 0 ? a.highest_bid + 1 : a.minimum_bid ?? 0);

  const matches = (a: TransfersAuction, f: Facet) => {
    const msLeft = a.expires_at ? new Date(a.expires_at).getTime() - now : Infinity;
    switch (f) {
      case 'all': return true;
      case 'closing': return isClosing(msLeft);
      case 'leading': return a.highest_bidder_team_id === me;
      // "Outbid" is specifically: you have money in, and someone is above it.
      case 'outbid': return a.my_bid != null && a.highest_bidder_team_id !== me;
      case 'free': return a.kind === 'free_agent';
      case 'listed': return a.kind === 'listing';
      case 'affordable': return nextBid(a) <= budget;
    }
  };

  const sorted = useMemo(
    () =>
      [...biddableAuctions].sort((a, b) => {
        const at = a.expires_at ? new Date(a.expires_at).getTime() : Number.MAX_SAFE_INTEGER;
        const bt = b.expires_at ? new Date(b.expires_at).getTime() : Number.MAX_SAFE_INTEGER;
        return at - bt;
      }),
    [biddableAuctions],
  );

  const visible = sorted.filter((a) => matches(a, facet));
  const count = (f: Facet) => biddableAuctions.filter((a) => matches(a, f)).length;

  const leadingCount = count('leading');
  const outbidCount = count('outbid');
  const committed = biddableAuctions
    .filter((a) => a.highest_bidder_team_id === me)
    .reduce((s, a) => s + a.highest_bid, 0);

  /**
   * These are set as TEXT on a card, so each has to clear 4.5:1 in both themes.
   * Three of them did not, and each theme failed differently — which is exactly
   * why 2.0 verifies every pair in both:
   *
   *   light  --color-warning  2.09  (the raw amber is a fill, never an ink)
   *   dark   --color-defeat   1.89  (a match result, and it has no dark value)
   *   dark   --color-pos-cb   2.00  (a position FIELD colour, read as a label)
   *
   * So: the ink-safe warning, danger for "outbid" (defeat means a lost
   * matchup, not a lost auction), and plain ink for "listed" — a provenance
   * filter is not a state, and borrowing a position hue for it broke both the
   * colour law and the contrast floor at once.
   */
  const facets: { key: Facet; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: 'var(--color-text-primary)' },
    { key: 'closing', label: 'Closing inside the hour', color: 'var(--color-warning-text)' },
    // accent-ink, not accent: an unselected facet paints its colour as TEXT on
    // the card, where the fill token measures 4.33 in dark.
    { key: 'leading', label: "You're leading", color: 'var(--color-accent-ink)' },
    { key: 'outbid', label: 'Outbid', color: 'var(--color-danger)' },
    { key: 'free', label: 'Free agents', color: 'var(--color-text-secondary)' },
    { key: 'listed', label: 'Listed', color: 'var(--color-text-secondary)' },
    { key: 'affordable', label: 'Within budget', color: 'var(--color-text-secondary)' },
  ];

  // The saleroom ticker — bids only, newest first. Distinct from The Wire on the
  // Market page, which mixes every kind of movement.
  const ticker = useMemo(() => {
    const out: { id: string; who: string; amount: number; player: string; at: string; mine: boolean }[] = [];
    for (const a of biddableAuctions) {
      const who = a.player ? getPlayerDisplayName(a.player, 'full') : 'a player';
      for (const b of a.bids) {
        out.push({
          id: `${a.player_id}:${b.team_id}:${b.at}`,
          who: b.team_id === me ? 'You' : b.team_name,
          amount: b.amount,
          player: who,
          at: b.at,
          mine: b.team_id === me,
        });
      }
    }
    return out.sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime()).slice(0, 10);
  }, [biddableAuctions, me]);

  return (
    <div className={`${styles.page} g-page`}>
      <TransfersSubNav leagueId={leagueId} counts={model.counts} />

      <header className={styles.header}>
        <div>
          <div className={`g-label ${styles.kicker}`}>Transfer Market → Auctions</div>
          <h1 className={styles.title}>The Auction Room</h1>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${styles.statAccent}`}>{money(budget)}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Club Balance</div>
          </div>
          <div className={styles.stat}>
            {/* Plain ink. A count of live lots is not a warning, and amber was
                doing nothing here but spending a colour that has a job. */}
            <div className={styles.statValue}>{biddableAuctions.length}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Lots live</div>
          </div>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${leadingCount ? styles.statAccent : ''}`}>{leadingCount}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>You&rsquo;re leading</div>
          </div>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${outbidCount ? styles.statRed : ''}`}>{outbidCount}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Outbid</div>
          </div>
        </div>
      </header>

      <div className={styles.tools}>
        {facets.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`${styles.facet} ${facet === f.key ? styles.facetOn : ''}`}
            style={facet === f.key ? { background: f.color, borderColor: f.color } : { color: f.color }}
            onClick={() => setFacet(f.key)}
          >
            {f.label} <span className={styles.facetCount}>{count(f.key)}</span>
          </button>
        ))}
      </div>

      <div className={styles.body}>
        {/* One panel, two columns — the list and its rail are one instrument.
            See design-2.0/README.md § "A board is one panel". */}
        <div className={`${styles.board} g-panel`}>
        <main className={styles.main}>
          {/* Column heads only when there are columns to head. With an empty
              room they rendered as a bare ruled strip above "nothing is under
              the hammer" — a table header for a table that isn't there. */}
          {visible.length > 0 && (
            <div className={styles.lotHead}>
              <span className="g-label">Lot</span>
              <span className={`g-label ${styles.r}`}>Standing bid</span>
              <span className="g-label">Leader</span>
              <span className="g-label">You</span>
              <span className={`g-label ${styles.r}`}>Closes</span>
              <span className="g-label" />
            </div>
          )}

          {visible.length === 0 ? (
            <p className={styles.empty}>
              {biddableAuctions.length === 0
                ? 'The room is empty. Nothing is under the hammer.'
                : 'No lot matches that filter.'}
            </p>
          ) : (
            visible.map((a) => (
              <Lot
                key={a.player_id}
                auction={a}
                now={now}
                me={me}
                seller={a.seller_team_id ? teamById.get(a.seller_team_id) : undefined}
                leader={a.highest_bidder_team_id ? teamById.get(a.highest_bidder_team_id) : undefined}
                expanded={openLot === a.player_id}
                onToggle={() => setOpenLot(openLot === a.player_id ? null : a.player_id)}
                onBid={() => setBid({ auction: a, mode: 'bid' })}
                onClause={() => setBid({ auction: a, mode: 'clause' })}
                onOpenPlayer={() => a.player && openPlayer(a.player as unknown as Player)}
                clause={
                  a.sale_listing_id ? listingById.get(a.sale_listing_id)?.buy_now_price ?? null : null
                }
                sellerFloor={
                  a.sale_listing_id ? listingById.get(a.sale_listing_id)?.min_bid ?? null : null
                }
              />
            ))
          )}

          {model.recentlyResolved.length > 0 && (
            <section className={styles.gone}>
              <div className={styles.goneHead}>
                <h2 className={styles.goneTitle}>Gone This Week</h2>
                <span className={styles.goneSub}>
                  what the room has already paid — the only running record of what a player is worth
                  in this league
                </span>
              </div>
              <div className={styles.goneGrid}>
                {model.recentlyResolved.slice(0, 8).map((g) => (
                  <div key={g.player_id} className={styles.goneCard}>
                    <div className={styles.goneName}>
                      {g.player ? getPlayerDisplayName(g.player, 'initial_last') : 'A player'}
                    </div>
                    {/* Three outcomes, not two. A lot that drew bids but found
                        no valid winner — every bidder's roster full, or short of
                        the money once severance was added — is "unsold", not
                        "no bids". Saying "no bids" there is what made the strip
                        wrong even once the figures behind it were right. */}
                    <div className={styles.goneMeta}>
                      {g.winner_team_id
                        ? `${g.winner_team_id === me ? 'you won' : g.winner_team_name} · ${bids(g.bid_count)}`
                        : g.bid_count > 0
                          ? `unsold · ${bids(g.bid_count)}`
                          : 'expired — no bids'}
                    </div>
                    <div
                      className={`${styles.goneValue} ${g.winner_team_id === me ? styles.statAccent : ''}`}
                    >
                      {g.winner_team_id ? money(g.winning_bid) : '—'}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}
        </main>

        <aside className={styles.rail}>
          <div className={styles.railHead}>
            <h2 className={styles.railTitle}>The Saleroom</h2>
            <span className={styles.railLive}>● Live</span>
          </div>

          {ticker.length === 0 ? (
            <p className={styles.empty}>No bids yet.</p>
          ) : (
            ticker.map((e) => (
              <div key={e.id} className={styles.event}>
                {/* Accent means "yours" and nothing else. Another manager's bid
                    is not a warning, so it takes plain ink rather than amber. */}
                <span
                  className={styles.eventDot}
                  style={{ background: e.mine ? 'var(--color-accent)' : 'var(--color-text-muted)' }}
                />
                <div>
                  <div className={styles.eventText}>
                    <span className={styles.eventStrong}>{e.who}</span> bid{' '}
                    <span className={styles.eventStrong}>{money(e.amount)}</span> for {e.player}
                  </div>
                  <div className={styles.eventTime}>{relative(e.at, now)}</div>
                </div>
              </div>
            ))
          )}

          <div className={styles.desk}>
            <div className={styles.deskRow}>
              <span className={styles.deskLabel}>Committed if you win</span>
              <span className={styles.deskValue}>{money(committed)}</span>
            </div>
            <div className={styles.deskRow}>
              <span className={styles.deskLabel}>Free after that</span>
              <span className={`${styles.deskValue} ${styles.statAccent}`}>
                {money(Math.max(0, budget - committed))}
              </span>
            </div>
            <div className={`${styles.deskRow} ${styles.deskLast}`}>
              <span className={styles.deskLabel}>Your lots selling</span>
              <span className={styles.deskValue}>
                {biddableAuctions.filter((a) => a.seller_team_id === me).length}
              </span>
            </div>
          </div>
        </aside>
        </div>
      </div>

      {bid?.auction.player && (
        <BidDialog
          open
          onClose={() => setBid(null)}
          leagueId={leagueId}
          player={bid.auction.player}
          auction={bid.auction}
          listing={
            bid.auction.sale_listing_id ? listingById.get(bid.auction.sale_listing_id) ?? null : null
          }
          mode={bid.mode}
          budget={budget}
          committedTotal={biddableAuctions.reduce((s, a) => s + (a.my_bid != null && a.my_bid > 0 ? a.my_bid : 0), 0)}
          openBidCount={biddableAuctions.filter((a) => a.my_bid != null && a.my_bid > 0).length}
          rosterFull={model.rosterFull}
          myRoster={model.myRoster}
          academy={model.academy}
          bidFloor={model.league.free_agent_bid_floor ?? 0.5}
          onDone={refresh}
        />
      )}
    </div>
  );
}

// ── One lot ───────────────────────────────────────────────

function Lot({
  auction: a,
  now,
  me,
  seller,
  leader,
  expanded,
  onToggle,
  onBid,
  onClause,
  onOpenPlayer,
  clause,
  sellerFloor,
}: {
  auction: TransfersAuction;
  now: number;
  me: string;
  seller: { team_name: string; crest_config: unknown } | undefined;
  leader: { team_name: string; crest_config: unknown } | undefined;
  expanded: boolean;
  onToggle: () => void;
  onBid: () => void;
  onClause: () => void;
  onOpenPlayer: () => void;
  clause: number | null;
  sellerFloor: number | null;
}) {
  const p = a.player;
  const { prefetchPlayer } = usePlayerCard();
  if (!p) return null;

  const msLeft = a.expires_at ? new Date(a.expires_at).getTime() - now : 0;
  const hot = Boolean(a.expires_at) && isClosing(msLeft);
  const settling = Boolean(a.expires_at) && msLeft <= 0;
  const leading = a.highest_bidder_team_id === me;
  const mine = a.seller_team_id === me;
  const outbid = a.my_bid != null && !leading;
  // AuctionsClient only ever hands this component a lot from biddableAuctions,
  // which filters out any listing with no min_bid (114) — so a.minimum_bid is
  // never actually null here. The fallback is type-level safety, not a real case.
  const floor = a.minimum_bid ?? 0;
  const next = a.highest_bid > 0 ? a.highest_bid + 1 : floor;

  const state = mine ? styles.lotMine : leading ? styles.lotLead : hot ? styles.lotHot : '';
  const fullName = getPlayerDisplayName(p, 'full');

  // The position hue the 2.0 row tint paints on hover. It answers "which one am
  // I on" and teaches the taxonomy at the same time; at rest the row stays
  // clean, so a room full of lots is not a paint chart.
  const hue = { '--pf': `var(--color-pos-${String(p.primary_position).toLowerCase()})` } as React.CSSProperties;

  return (
    <>
      <div className={`${styles.lot} ${state} g-row`} style={hue}>
        <div className={styles.lotId}>
          <button type="button" className={styles.lotFace} onClick={onOpenPlayer} {...playerHoverProps(prefetchPlayer, p)} aria-label={`Open ${fullName}`}>
            <Portrait
              photoUrl={p.photo_url}
              name={fullName}
              club={p.pl_team}
              size="sm"
              headTopPct={p.portrait_head_top_pct}
              headWidthPct={p.portrait_head_width_pct}
              photoVersion={p.photo_version}
            />
          </button>
          <div className={styles.lotIdBody}>
            <div className={styles.lotNameRow}>
              <PositionBadge position={p.primary_position as GranularPosition} size="sm" />
              <button type="button" className={styles.lotName} onClick={onOpenPlayer} {...playerHoverProps(prefetchPlayer, p)} title={fullName}>
                {getPlayerDisplayName(p, 'initial_last')}
              </button>
            </div>
            {/* The club is gone from this line — the portrait's crest says it,
                without words and without running long. What is left is the one
                thing a crest cannot carry: who is selling him. */}
            <div className={styles.lotSub}>
              <span className={`${styles.src} ${a.kind === 'free_agent' ? styles.srcFa : styles.srcLi}`}>
                {a.kind === 'free_agent' ? 'Free agent' : 'Listed'}
              </span>
              {a.kind === 'listing' && (mine ? 'Yours' : seller?.team_name ?? a.seller_team_name)}
            </div>
          </div>
        </div>

        <div className={`${styles.lotCol} ${styles.lotBidCol}`}>
          <div className={`${styles.lotBid} ${a.highest_bid > 0 ? '' : styles.lotBidNone}`}>
            {a.highest_bid > 0 ? money(a.highest_bid) : 'No bids'}
          </div>
          <div className={styles.lotFrom}>
            {a.highest_bid > 0 ? `from ${money(floor)}` : `floor ${money(floor)}`}
          </div>
        </div>

        <div className={styles.lotWho}>
          {a.highest_bidder_team_id ? (
            <>
              <CrestBadge
                config={(leader?.crest_config as CrestConfig | null) ?? null}
                teamName={leader?.team_name ?? a.highest_bidder_team_name}
                teamId={a.highest_bidder_team_id}
                size={17}
              />
              <span className={styles.lotWn}>
                {leading ? 'You' : a.highest_bidder_team_name}
              </span>
            </>
          ) : (
            <span className={styles.lotWn}>—</span>
          )}
        </div>

        <div
          className={`${styles.lotYou} ${leading ? styles.youUp : outbid ? styles.youOut : styles.youOff}`}
        >
          {mine ? 'Your lot' : leading ? 'Leading' : outbid ? 'Outbid' : 'Not in'}
        </div>

        <div className={`${styles.lotCol} ${styles.lotClockCol}`}>
          <div className={`${styles.lotClock} ${hot ? styles.lotClockHot : ''}`}>
            {a.expires_at ? formatAuctionClock(msLeft, true) : '—'}
          </div>
          <div className={styles.lotBids}>
            {a.bid_count === 0 ? 'no bids yet' : `${a.bid_count} bid${a.bid_count === 1 ? '' : 's'}`}
          </div>
        </div>

        <div className={styles.lotActions}>
          {mine ? (
            <span className={`${styles.go} ${styles.goMuted}`} title="Bidding decides this — you cannot withdraw it">Will sell</span>
          ) : (
            <button
              type="button"
              className={`${styles.go} ${leading ? styles.goGhost : ''}`}
              onClick={onBid}
              disabled={settling}
              title={settling ? 'Auction is settling' : undefined}
            >
              {a.highest_bid > 0 ? (leading ? `Raise ${money(next)}` : `Bid ${money(next)}`) : `Open at ${money(next)}`}
            </button>
          )}
          <button
            type="button"
            className={styles.toggle}
            onClick={onToggle}
            aria-expanded={expanded}
            aria-label={expanded ? 'Hide bid history' : 'Show bid history'}
          >
            {expanded ? '▴' : '▾'}
          </button>
        </div>
      </div>

      {expanded && (
        <div className={`${styles.ex} ${state}`}>
          {/* The lot-size portrait (66x78) belongs here, not in the row. The
              row's name column was already 10px short of the string it wanted
              at 1280; a 66px portrait there would have made a measured problem
              worse. The drawer has the room, and it gives the expansion
              something to reveal beyond a table of numbers. */}
          <div className={styles.exWho}>
            <Portrait
              photoUrl={p.photo_url}
              name={fullName}
              club={p.pl_team}
              size="md"
              headTopPct={p.portrait_head_top_pct}
              headWidthPct={p.portrait_head_width_pct}
              photoVersion={p.photo_version}
            />
            <div className={styles.exWhoBody}>
              <div className={styles.exWhoName}>{fullName}</div>
              <div className={`g-label-quiet ${styles.exWhoMeta}`}>
                {a.kind === 'free_agent'
                  ? 'Free agent'
                  : `Listed by ${mine ? 'you' : seller?.team_name ?? a.seller_team_name}`}
              </div>
            </div>
          </div>

          <div className={styles.exGrid}>
            <div>
              <div className={`g-label ${styles.exTitle}`}>Bid history</div>
              {a.bids.length === 0 ? (
                <p className={styles.exEmpty}>Nobody has bid yet. The floor is {money(floor)}.</p>
              ) : (
                [...a.bids]
                  .sort((x, y) => new Date(y.at).getTime() - new Date(x.at).getTime())
                  .map((b, i) => (
                    <div key={`${b.team_id}:${b.at}`} className={`${styles.exRow} ${i === 0 ? styles.exTop : ''}`}>
                      <span className={styles.exName}>
                        <b>{b.team_id === me ? 'You' : b.team_name}</b> bid
                      </span>
                      <span className={styles.exAmt}>{money(b.amount)}</span>
                      <span className={styles.exTime}>{relative(b.at, now)}</span>
                    </div>
                  ))
              )}
            </div>

            <div>
              <div className={`g-label ${styles.exTitle}`}>The bidding</div>
              <div className={styles.ladder}>
                <div className={styles.rung}>
                  <span className="g-label">
                    {a.kind === 'listing' ? "Seller's floor" : 'Opening floor'}
                  </span>
                  <span className={styles.rungValue}>{money(sellerFloor ?? floor)}</span>
                </div>
                <div className={styles.rung}>
                  <span className="g-label">Standing bid</span>
                  {/* Ink, not amber. The standing bid is the ladder's key
                      figure, not a warning about anything; emphasis is the
                      job of weight and the rule beside it. */}
                  <span className={styles.rungValue}>
                    {a.highest_bid > 0 ? money(a.highest_bid) : '—'}
                  </span>
                </div>
                <div className={styles.rung}>
                  <span className="g-label">Your last bid</span>
                  <span className={styles.rungValue}>{a.my_bid != null ? money(a.my_bid) : '—'}</span>
                </div>
                <div className={`${styles.rung} ${styles.rungLast}`}>
                  <span className="g-label">Release clause</span>
                  <span className={`${styles.rungValue} ${clause != null ? styles.gold : styles.off}`}>
                    {clause != null ? money(clause) : '—'}
                  </span>
                </div>
              </div>

              {!mine && (
                <>
                  <div className={styles.quick}>
                    <button type="button" className={`${styles.q} ${styles.qOn}`} onClick={onBid}>
                      {money(next)}
                    </button>
                    <button type="button" className={styles.q} onClick={onBid}>
                      {money(Math.round(next * 1.05))}
                    </button>
                    <button type="button" className={styles.q} onClick={onBid}>
                      {money(Math.round(next * 1.15))}
                    </button>
                    {clause != null && (
                      <button type="button" className={`${styles.q} ${styles.qGold}`} onClick={onClause}>
                        Clause
                      </button>
                    )}
                  </div>
                  <p className={styles.exNote}>
                    Bids extend the dynamic clock with anti-snipe protection and quiet hours.
                    {clause != null && ' Paying the clause ends the auction outright.'}
                  </p>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function relative(iso: string, now: number): string {
  const diff = now - new Date(iso).getTime();
  if (diff < 60_000) return 'just now';
  const mins = Math.floor(diff / 60_000);
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} hr`;
  const days = Math.floor(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
