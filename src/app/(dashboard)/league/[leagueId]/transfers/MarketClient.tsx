'use client';

import { useEffect, useMemo, useState } from 'react';
import NavigationLink from '@/components/ui/NavigationLink';
import { useRouter } from 'next/navigation';
import type { GranularPosition, Player } from '@/types';
import type {
  TransfersAuction,
  TransfersListing,
  TransfersModel,
} from '@/lib/transfers/buildTransfersModel';
import { buildWire, WIRE_COLORS, WIRE_HOLLOW } from '@/lib/transfers/buildWire';
import { playerHoverProps, usePlayerCard } from '@/components/players/PlayerCardProvider';
import PositionBadge from '@/components/players/PositionBadge';
import CrestBadge from '@/components/crest/CrestBadge';
import type { CrestConfig } from '@/components/crest/types';
import TransfersSubNav from '@/components/transfers/TransfersSubNav';
import ListingCard from '@/components/transfers/ListingCard';
import AuctionTimingHelp from '@/components/transfers/AuctionTimingHelp';
import BidDialog, { type BidMode } from '@/components/transfers/BidDialog';
import ProposeBuilder, { type ProposeMode } from '@/components/transfers/ProposeBuilder';
import ListingEditor from '@/components/transfers/ListingEditor';
import { setServerClock, useTick, formatAuctionClock, isClosing } from '@/components/transfers/useTick';
import { useLiveTransfers } from '@/components/transfers/useLiveTransfers';
import styles from './market.module.css';
import { getPlayerDisplayName } from '@/lib/players/displayName';

/**
 * Transfer Market — the front page.
 *
 * A digest, not a workspace, and the hub for all of Transfers: this is the
 * only page in the section reachable from the top bar, and everything here is
 * a doorway to one of the other four pages. The only thing you can finish
 * without leaving is a bid, because a closing auction is the one thing that
 * will not wait for you to navigate.
 */

const money = (n: number) => `€${n}m`;

export default function MarketClient({
  leagueId,
  initial,
}: {
  leagueId: string;
  initial: TransfersModel;
}) {
  const router = useRouter();
  const model = useLiveTransfers(leagueId, initial);
  const { openPlayer, prefetchPlayer, primePlayers } = usePlayerCard();

  const [bid, setBid] = useState<{ auction: TransfersAuction; mode: BidMode } | null>(null);
  const [propose, setPropose] = useState<{ listing: TransfersListing; mode: ProposeMode } | null>(null);
  const [editing, setEditing] = useState<TransfersListing | null>(null);
  const refresh = () => router.refresh();

  useEffect(() => { setServerClock(model.serverNow); }, [model.serverNow]);

  useEffect(() => {
    const rows = Object.values(model.playerMap) as unknown as Player[];
    if (rows.length) primePlayers(rows);
  }, [model.playerMap, primePlayers]);

  const now = useTick(true);

  const listingById = useMemo(
    () => new Map(model.listings.map((l) => [l.id, l])),
    [model.listings],
  );
  const auctionByListing = useMemo(() => {
    const m = new Map<string, TransfersAuction>();
    for (const a of model.auctions) if (a.sale_listing_id) m.set(a.sale_listing_id, a);
    return m;
  }, [model.auctions]);
  const teamById = useMemo(
    () => new Map(model.allTeams.map((t) => [t.id, t])),
    [model.allTeams],
  );

  // Closing now: free agents and listed players together, soonest first. This is
  // the only place in the hub the two kinds are deliberately mixed — urgency
  // does not care whose player he is.
  //
  // A listing with no min_bid (114) has no bid ladder — release-clause-only or
  // negotiation-only — so it's excluded here the same way AuctionsClient
  // excludes it from the Auction Room: this widget renders a "Bid €Xm" button,
  // which would be wrong to offer.
  const closing = useMemo(
    () =>
      model.auctions
        .filter((a) => a.expires_at)
        .filter((a) => a.kind !== 'listing' || (listingById.get(a.sale_listing_id ?? '')?.min_bid ?? null) != null)
        .sort((a, b) => new Date(a.expires_at!).getTime() - new Date(b.expires_at!).getTime())
        .slice(0, 4),
    [model.auctions, listingById],
  );

  const wire = useMemo(() => buildWire(model), [model]);

  const liveCount = model.auctions.filter((a) => a.bid_count > 0).length;
  const toAnswer = model.myOffers.filter(
    (o) => o.status === 'pending' && o.team_b_id === model.myTeam.id,
  ).length;
  const myStanding = model.auctions.filter(
    (a) => a.highest_bidder_team_id === model.myTeam.id,
  );
  const standingTotal = myStanding.reduce((s, a) => s + a.highest_bid, 0);

  // The seven-day schedule, bucketed by local calendar day.
  const days = useMemo(() => {
    const out: { label: string; today: boolean; pips: { text: string; color: string }[] }[] = [];
    const midnight = new Date(now);
    midnight.setHours(0, 0, 0, 0);

    for (let i = 0; i < 7; i++) {
      const from = new Date(midnight.getTime() + i * 86400000);
      const to = new Date(from.getTime() + 86400000);
      const pips = model.auctions
        .filter((a) => {
          if (!a.expires_at) return false;
          const t = new Date(a.expires_at).getTime();
          return t >= from.getTime() && t < to.getTime();
        })
        // Four states, four marks. "Your listing" was --color-pos-cb, a
        // centre-back field colour standing in for a kind of lot; it is the
        // strongest ink instead, which is the one axis left once warning, accent
        // and muted are spoken for.
        .map((a) => ({
          text: a.player ? getPlayerDisplayName(a.player, 'initial_last') : 'a player',
          color:
            a.seller_team_id === model.myTeam.id
              ? 'var(--color-text-primary)'
              : a.highest_bidder_team_id === model.myTeam.id
                ? 'var(--color-accent)'
                : a.bid_count > 0
                  ? 'var(--color-warning)'
                  : 'var(--color-text-muted)',
        }));

      out.push({
        label: i === 0 ? 'Today' : from.toLocaleDateString(undefined, { weekday: 'short' }),
        today: i === 0,
        pips,
      });
    }
    return out;
  }, [model.auctions, model.myTeam.id, now]);

  return (
    <div className={styles.page}>
      <TransfersSubNav leagueId={leagueId} counts={model.counts} />

      <header className={styles.header}>
        <div>
          <div className={`g-label ${styles.kicker}`}>
            {model.league.name} · GW{model.currentGameweek} · open until GW
            {(model.league.total_gameweeks ?? 38) - 8}
          </div>
          <h1 className={styles.title}>Transfer Market</h1>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${styles.statAccent}`}>{money(model.myTeam.faab_budget)}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Club Balance</div>
          </div>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${styles.statWarn}`}>{liveCount}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Lots live</div>
          </div>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${toAnswer ? styles.statRed : ''}`}>{toAnswer}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Offers to answer</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{model.counts.listings}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>On the board</div>
          </div>
        </div>
      </header>

      <div className={styles.body}>
        <main className={styles.main}>
          {/* ── Closing now ─────────────────────────────── */}
          <div className={styles.sect}>
            <h2 className={styles.sectTitle}>
              Closing now <AuctionTimingHelp />
            </h2>
            <span className={styles.sectHint}>
              free agents and listed players together
              {closing.filter((a) => isClosing(new Date(a.expires_at!).getTime() - now)).length > 0 &&
                ` — ${closing.filter((a) => isClosing(new Date(a.expires_at!).getTime() - now)).length} inside the hour`}
            </span>
            <NavigationLink href={`/league/${leagueId}/transfers/auctions`} className={styles.sectMore}>
              All {model.counts.auctions} in the auction room →
            </NavigationLink>
          </div>

          {closing.length === 0 ? (
            <p className={styles.empty}>Nothing is under the hammer right now.</p>
          ) : (
            <div className={styles.closingGrid}>
              {closing.map((a) => {
                const msLeft = new Date(a.expires_at!).getTime() - now;
                const opensAtMs = a.opens_at ? new Date(a.opens_at).getTime() : null;
                const notOpenYet = opensAtMs != null && now < opensAtMs;
                const opensLabel = opensAtMs
                  ? new Date(opensAtMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
                  : '';
                const hot = isClosing(msLeft) && !notOpenYet;
                const settling = msLeft <= 0;
                const leading = a.highest_bidder_team_id === model.myTeam.id;
                const mine = a.seller_team_id === model.myTeam.id;
                // `closing` already filtered out any listing with no min_bid
                // (114), so a.minimum_bid is never actually null here — the
                // fallback is type-level safety, not a real case.
                const floor = a.minimum_bid ?? 0;
                const next = a.highest_bid > 0 ? a.highest_bid + 1 : floor;
                const seller = a.seller_team_id ? teamById.get(a.seller_team_id) : undefined;

                return (
                  <article key={a.player_id} className={`${styles.closingCard} ${hot ? '' : styles.closingCool}`}>
                    <div className={`g-namerow ${styles.closingTop}`}>
                      {a.player && (
                        <PositionBadge position={a.player.primary_position as GranularPosition} size="sm" />
                      )}
                      <button
                        type="button"
                        className={styles.closingName}
                        onClick={() => a.player && openPlayer(a.player as unknown as Player)}
                        {...(a.player ? playerHoverProps(prefetchPlayer, a.player) : {})}
                      >
                        {a.player ? getPlayerDisplayName(a.player, 'initial_last') : ''}
                      </button>
                      <span className={styles.closingCrest}>
                        {a.kind === 'listing' ? (
                          <CrestBadge
                            config={(seller?.crest_config as CrestConfig | null) ?? null}
                            teamName={seller?.team_name}
                            teamId={a.seller_team_id ?? seller?.id}
                            size={20}
                          />
                        ) : (
                          <span className={styles.faDisc}>FA</span>
                        )}
                      </span>
                    </div>
                    <div className={styles.closingMeta}>
                      {a.player?.pl_team} · {a.kind === 'listing' ? a.seller_team_name : 'free agent'} ·{' '}
                      {leading ? 'you lead' : a.bid_count === 0 ? 'no bids' : `${a.bid_count} bids`}
                    </div>
                    <div className={styles.closingBottom}>
                      <span className={styles.closingPrice}>
                        {money(a.highest_bid > 0 ? a.highest_bid : floor)}
                      </span>
                      <span className={`${styles.closingClock} ${hot ? styles.closingClockHot : ''}`}>
                        {notOpenYet ? `Opens ${opensLabel}` : formatAuctionClock(msLeft, true)}
                      </span>
                    </div>
                    {mine ? (
                      <span className={`${styles.closingGo} ${styles.closingGoGhost}`}>Your lot</span>
                    ) : (
                      <button
                        type="button"
                        className={`${styles.closingGo} ${leading ? styles.closingGoGhost : ''}`}
                        onClick={() => setBid({ auction: a, mode: 'bid' })}
                        disabled={settling || notOpenYet}
                        title={notOpenYet ? `Bidding opens at ${opensLabel}` : settling ? 'Auction is settling' : undefined}
                      >
                        {notOpenYet ? `Opens ${opensLabel}` : leading ? `Raise ${money(next)}` : `Bid ${money(next)}`}
                      </button>
                    )}
                  </article>
                );
              })}
            </div>
          )}

          {/* ── New transfers ───────────────────────────── */}
          {model.newTransfers.length > 0 && (
            <>
              <div className={`${styles.sect} ${styles.sectSpaced}`}>
                <h2 className={styles.sectTitle}>New transfers</h2>
                <span className={styles.sectHint}>arrived in the last week, not yet on the market</span>
                <NavigationLink href={`/league/${leagueId}/transfers/free-agents`} className={styles.sectMore}>
                  All {model.counts.newTransfers} in Free Agency →
                </NavigationLink>
              </div>

              <div className={styles.newGrid}>
                {model.newTransfers.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    className={styles.newCard}
                    onClick={() => openPlayer(p as unknown as Player)}
                    {...playerHoverProps(prefetchPlayer, p)}
                  >
                    <span className={`g-namerow ${styles.newTop}`}>
                      <PositionBadge position={p.primary_position as GranularPosition} size="sm" />
                      <span className={styles.newName}>{getPlayerDisplayName(p, 'initial_last')}</span>
                      <span className={styles.closingCrest}><span className={styles.faDisc}>FA</span></span>
                    </span>
                    <span className={styles.newMeta}>
                      {p.pl_team} · {p.market_value != null ? money(Number(p.market_value)) : '—'}
                    </span>
                    <span className={styles.newBadge}>{arrivedLabel(p.pl_team_changed_at, now)}</span>
                  </button>
                ))}
              </div>
            </>
          )}

          {/* ── Listings slice ──────────────────────────── */}
          <div className={`${styles.sect} ${styles.sectSpaced}`}>
            <h2 className={styles.sectTitle}>On the Listings Board</h2>
            <span className={styles.sectHint}>what other clubs have made available, and on what terms</span>
            <NavigationLink href={`/league/${leagueId}/transfers/listings`} className={styles.sectMore}>
              All {model.counts.listings} listings →
            </NavigationLink>
          </div>

          {model.listings.length === 0 ? (
            <p className={styles.empty}>No club has listed a player yet.</p>
          ) : (
            <div className={styles.boardGrid}>
              {model.listings.slice(0, 6).map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  auction={auctionByListing.get(l.id) ?? null}
                  seller={teamById.get(l.seller_team_id)}
                  isMine={l.seller_team_id === model.myTeam.id}
                  onOpenPlayer={() => l.player && openPlayer(l.player as unknown as Player)}
                  onBid={(x) => {
                    const a = auctionByListing.get(x.id);
                    if (a) setBid({ auction: a, mode: 'bid' });
                  }}
                  onClause={(x) => {
                    const a = auctionByListing.get(x.id);
                    if (a) setBid({ auction: a, mode: 'clause' });
                  }}
                  onOffer={(x) => setPropose({ listing: x, mode: 'offer' })}
                  onLoan={(x) => setPropose({ listing: x, mode: 'loan' })}
                  onEdit={(x) => setEditing(x)}
                  onReview={() => {
                    window.dispatchEvent(new Event('navigation-start'));
                    router.push(`/league/${leagueId}/transfers/deals`);
                  }}
                />
              ))}
            </div>
          )}

          {/* ── The doors ──────────────────────────────── */}
          <div className={styles.doors}>
            <NavigationLink href={`/league/${leagueId}/transfers/auctions`} className={styles.door}>
              <div className={styles.doorTop}>
                <div className={`${styles.doorNum} ${styles.statWarn}`}>{model.counts.auctions}</div>
                <div className={styles.doorName}>Auctions</div>
                <div className={styles.doorSub}>
                  Every lot under the hammer in one room — sortable by time, bid history, and the
                  saleroom ticker.
                </div>
              </div>
              <div className={styles.doorGo}>Enter the auction room →</div>
            </NavigationLink>
            <NavigationLink href={`/league/${leagueId}/transfers/free-agents`} className={styles.door}>
              <div className={styles.doorTop}>
                <div className={`${styles.doorNum} ${styles.statAccent}`}>{model.counts.freeAgents}</div>
                <div className={styles.doorName}>Free Agency</div>
                <div className={styles.doorSub}>
                  Everyone unowned in the division. Search, filter, and open an auction on anyone.
                </div>
              </div>
              <div className={styles.doorGo}>Browse free agents →</div>
            </NavigationLink>
            <NavigationLink href={`/league/${leagueId}/transfers/deals`} className={styles.door}>
              <div className={styles.doorTop}>
                <div className={`${styles.doorNum} ${toAnswer ? styles.statRed : ''}`}>{model.counts.deals}</div>
                <div className={styles.doorName}>Deals</div>
                <div className={styles.doorSub}>
                  Your offers in and out, trades in flight, loans running, and your own listings.
                </div>
              </div>
              <div className={styles.doorGo}>Open your deals →</div>
            </NavigationLink>
          </div>

          {/* ── Schedule ────────────────────────────────── */}
          <div className={`${styles.sect} ${styles.sectSpaced}`}>
            <h2 className={styles.sectTitle}>Deadlines</h2>
            <span className={styles.sectHint}>next seven days</span>
          </div>

          <div className={styles.sched}>
            <div className={styles.axis}>
              {days.map((d, i) => (
                <div key={i} className={`${styles.day} ${d.today ? styles.dayToday : ''}`}>
                  <div className={`${styles.dayLabel} ${d.today ? styles.dayLabelNow : ''}`}>{d.label}</div>
                  {d.pips.map((p, j) => (
                    <div key={j} className={styles.pip}>
                      <span className={styles.pipDot} style={{ background: p.color }} />
                      <span className={styles.pipText}>{p.text}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div className={styles.legend}>
              <span className={styles.leg}><span className={styles.pipDot} style={{ background: 'var(--color-warning)' }} />Bidding live</span>
              <span className={styles.leg}><span className={styles.pipDot} style={{ background: 'var(--color-accent)' }} />You&rsquo;re leading</span>
              <span className={styles.leg}><span className={styles.pipDot} style={{ background: 'var(--color-text-muted)' }} />No bids yet</span>
              <span className={styles.leg}><span className={styles.pipDot} style={{ background: 'var(--color-text-primary)' }} />Your listing</span>
            </div>
          </div>
        </main>

        {/* ── The Wire ──────────────────────────────────── */}
        <aside className={styles.rail}>
          <div className={styles.railHead}>
            <h2 className={styles.railTitle}>The Wire</h2>
            <span className={styles.railLive}>● Live</span>
          </div>

          {wire.length === 0 ? (
            <p className={styles.empty}>Nothing has moved yet.</p>
          ) : (
            wire.map((e) => (
              <div key={e.id} className={styles.event}>
                <span
                  className={`${styles.eventDot} ${WIRE_HOLLOW.has(e.kind) ? styles.eventDotRing : ''}`}
                  style={{ background: WIRE_COLORS[e.kind] }}
                />
                <div>
                  <div className={styles.eventText}>
                    <span className={styles.eventStrong}>{e.who}</span> {e.mid}{' '}
                    <span className={styles.eventStrong}>{e.amount}</span> {e.tail}
                  </div>
                  <div className={styles.eventTime}>{relative(e.at, now)}</div>
                </div>
              </div>
            ))
          )}

          <div className={styles.desk}>
            <div className={styles.deskRow}>
              <span className={styles.deskLabel}>Standing bids</span>
              <span className={styles.deskValue}>
                {myStanding.length} · {money(standingTotal)}
              </span>
            </div>
            <div className={styles.deskRow}>
              <span className={styles.deskLabel}>Offers to answer</span>
              <span className={`${styles.deskValue} ${toAnswer ? styles.statRed : ''}`}>{toAnswer}</span>
            </div>
            <div className={styles.deskRow}>
              <span className={styles.deskLabel}>Your listings</span>
              <span className={styles.deskValue}>
                {model.listings.filter((l) => l.seller_team_id === model.myTeam.id).length}
              </span>
            </div>
            <div className={`${styles.deskRow} ${styles.deskLast}`}>
              <span className={styles.deskLabel}>Loan slots used</span>
              <span className={styles.deskValue}>
                {model.loans.filter((l) => l.borrower_team_id === model.myTeam.id && l.status === 'active').length}
                {' of '}
                {model.league.max_loan_ins ?? 2}
              </span>
            </div>
          </div>
        </aside>
      </div>

      {bid?.auction.player && (
        <BidDialog
          open
          onClose={() => setBid(null)}
          leagueId={leagueId}
          player={bid.auction.player}
          auction={bid.auction}
          listing={bid.auction.sale_listing_id ? listingById.get(bid.auction.sale_listing_id) ?? null : null}
          mode={bid.mode}
          budget={model.myTeam.faab_budget}
          committedTotal={model.auctions.reduce((s, a) => s + (a.my_bid != null && a.my_bid > 0 ? a.my_bid : 0), 0)}
          openBidCount={model.auctions.filter((a) => a.my_bid != null && a.my_bid > 0).length}
          rosterFull={model.rosterFull}
          myRoster={model.myRoster}
          academy={model.academy}
          bidFloor={model.league.free_agent_bid_floor ?? 0.5}
          onDone={refresh}
        />
      )}

      {propose && (
        <ProposeBuilder
          open
          onClose={() => setPropose(null)}
          leagueId={leagueId}
          model={model}
          initialMode={propose.mode}
          initialTeamId={propose.listing.seller_team_id}
          initialListing={propose.listing}
          initialPlayerId={propose.listing.player_id}
          onDone={refresh}
        />
      )}

      {editing && (
        <ListingEditor
          open
          onClose={() => setEditing(null)}
          leagueId={leagueId}
          listing={editing}
          myRoster={model.myRoster}
          onDone={refresh}
        />
      )}
    </div>
  );
}

/** "New today", "New · 3d ago" — how long ago a transfer arrived. */
function arrivedLabel(iso: string | null, now: number): string {
  if (!iso) return 'New';
  const days = Math.floor((now - new Date(iso).getTime()) / 86400_000);
  if (days <= 0) return 'New today';
  return `New · ${days}d ago`;
}

/** "4 min", "3 hr", "yesterday" — the wire's own sense of time. */
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
