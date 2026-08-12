'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { TransfersListing, TransfersModel } from '@/lib/transfers/buildTransfersModel';
import type { Player } from '@/types';
import { usePlayerCard } from '@/components/players/PlayerCardProvider';
import TransfersSubNav from '@/components/transfers/TransfersSubNav';
import ListingCard from '@/components/transfers/ListingCard';
import BidDialog, { type BidMode } from '@/components/transfers/BidDialog';
import ProposeBuilder, { type ProposeMode } from '@/components/transfers/ProposeBuilder';
import ListingEditor from '@/components/transfers/ListingEditor';
import { setServerClock } from '@/components/transfers/useTick';
import { useLiveTransfers } from '@/components/transfers/useLiveTransfers';
import styles from './listings.module.css';

/**
 * The Listings board — supply from clubs, on its own page.
 *
 * The filters are the four gates plus auction state and affordability, because
 * that is how the board is actually shopped: "who can I loan", "whose release
 * clause can I afford". Filtering by position and club is secondary here in a
 * way it is not in Free Agency — a listings board is small enough to read.
 */

type Facet = 'all' | 'live' | 'trade' | 'cash' | 'loan' | 'clause' | 'affordable' | 'mine';
type Sort = 'closing' | 'value' | 'ask' | 'name';

const SORTS: { key: Sort; label: string }[] = [
  { key: 'closing', label: 'Closing soonest' },
  { key: 'value', label: 'Market value' },
  { key: 'ask', label: 'Asking price' },
  { key: 'name', label: 'Name' },
];

export default function ListingsClient({
  leagueId,
  initial,
}: {
  leagueId: string;
  initial: TransfersModel;
}) {
  const router = useRouter();
  const model = useLiveTransfers(leagueId, initial);
  const { openPlayer, primePlayers } = usePlayerCard();

  // Dialog state. `refresh()` re-runs the server component, which rebuilds the
  // whole model — cheaper to reason about than patching the board in place, and
  // the board is small.
  const [bid, setBid] = useState<{ listing: TransfersListing; mode: BidMode } | null>(null);
  const [propose, setPropose] = useState<{ listing: TransfersListing; mode: ProposeMode } | null>(null);
  const [editing, setEditing] = useState<TransfersListing | null | 'new'>(null);
  const refresh = () => router.refresh();

  const [query, setQuery] = useState('');
  const [position, setPosition] = useState('');
  const [club, setClub] = useState('');
  const [sort, setSort] = useState<Sort>('closing');
  const [facet, setFacet] = useState<Facet>('all');

  // Pin the clock offset once, before any countdown renders.
  useEffect(() => { setServerClock(model.serverNow); }, [model.serverNow]);

  // Seed the player-card cache so opening a card costs no request.
  useEffect(() => {
    const rows = model.listings.map((l) => l.player).filter(Boolean) as unknown as Player[];
    if (rows.length) primePlayers(rows);
  }, [model.listings, primePlayers]);

  const auctionByListing = useMemo(() => {
    const m = new Map<string, (typeof model.auctions)[number]>();
    for (const a of model.auctions) if (a.sale_listing_id) m.set(a.sale_listing_id, a);
    return m;
  }, [model.auctions]);

  const teamById = useMemo(
    () => new Map(model.allTeams.map((t) => [t.id, t])),
    [model.allTeams],
  );

  // Pending offers against each of my listings, for the "Review n offers" action.
  const offersByListing = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of model.myOffers) {
      if (o.status !== 'pending' || !o.sale_listing_id) continue;
      m.set(o.sale_listing_id, (m.get(o.sale_listing_id) ?? 0) + 1);
    }
    return m;
  }, [model.myOffers]);

  const budget = model.myTeam.faab_budget;

  /**
   * The cheapest way into this listing today — the lower of the bid floor and
   * the release clause. They cross once bidding is live: a standing bid can
   * climb past the clause, at which point paying the clause is the cheap route,
   * not the expensive one.
   *
   * Null (114) means there is no numeric way in at all — no min_bid and no
   * buy_now_price, so the only door is a private Offer, which isn't a fixed
   * price this can compare against a budget.
   */
  const entryPrice = (l: TransfersListing): number | null => {
    const a = auctionByListing.get(l.id);
    const standing = a?.highest_bid ?? 0;
    const floor = l.status === 'active' && standing > 0 ? standing + 1 : a?.minimum_bid ?? l.min_bid;
    if (floor == null) return l.buy_now_price ?? null;
    return l.buy_now_price != null ? Math.min(l.buy_now_price, floor) : floor;
  };

  const matches = (l: TransfersListing, f: Facet) => {
    switch (f) {
      case 'all': return true;
      case 'live': return l.status === 'active';
      // Since 088 these read "sellers who want X", not "listings that permit
      // X" — every route in is open on any listing that is not yet live.
      case 'trade': return l.open_to_trade && l.status !== 'active';
      case 'cash': return l.open_to_sale && l.status !== 'active';
      case 'loan': return l.open_to_loan && l.status !== 'active';
      case 'clause': return l.buy_now_price != null;
      case 'affordable': {
        const p = entryPrice(l);
        return p != null && p <= budget;
      }
      case 'mine': return l.seller_team_id === model.myTeam.id;
    }
  };

  const positions = useMemo(() => {
    const s = new Set<string>();
    for (const l of model.listings) if (l.player?.primary_position) s.add(l.player.primary_position);
    return Array.from(s).sort();
  }, [model.listings]);

  const clubs = useMemo(() => {
    const s = new Set<string>();
    for (const l of model.listings) if (l.player?.pl_team) s.add(l.player.pl_team);
    return Array.from(s).sort();
  }, [model.listings]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();

    const rows = model.listings.filter((l) => {
      const p = l.player;
      if (!p) return false;
      if (position && p.primary_position !== position) return false;
      if (club && p.pl_team !== club) return false;
      if (!matches(l, facet)) return false;
      if (q) {
        const hay = `${p.name} ${p.web_name ?? ''} ${p.pl_team ?? ''} ${l.seller_team_name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const far = Number.MAX_SAFE_INTEGER;
    const expiry = (l: TransfersListing) => {
      const at = auctionByListing.get(l.id)?.expires_at ?? l.auction_expires_at;
      return at ? new Date(at).getTime() : far;
    };

    return rows.sort((a, b) => {
      switch (sort) {
        case 'closing': return expiry(a) - expiry(b);
        case 'value': return (Number(b.player?.market_value) || 0) - (Number(a.player?.market_value) || 0);
        // A listing with no asking price is not "cheapest" — it has no price at
        // all, so it sorts last in either direction.
        case 'ask': return (a.ask_price ?? far) - (b.ask_price ?? far);
        case 'name': return (a.player?.web_name ?? '').localeCompare(b.player?.web_name ?? '');
      }
    });
    // `matches` and `entryPrice` close over the same inputs already listed here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.listings, query, position, club, facet, sort, auctionByListing, budget, model.myTeam.id]);

  const count = (f: Facet) => model.listings.filter((l) => matches(l, f)).length;

  /**
   * A facet's colour is painted as TEXT on the card when unselected and as a
   * FILL when selected, so every entry has to survive both. Three of these did
   * not, and each failed in a different theme:
   *
   *   --color-warning   2.09 as ink in light (it is a fill; the ink is
   *                     --color-warning-text)
   *   --color-accent    4.33 as ink in dark (the ink is --color-accent-ink)
   *   --color-pos-cb    2.00, --color-pos-wb 2.28 as ink in dark
   *
   * The position pair also broke the colour law before it broke the floor:
   * "wants players" and "would loan out" are not positions, and those hues mean
   * centre-back and wing-back everywhere else in the app. The facet's own label
   * already says which it is, so they go to ink and the hue is not replaced.
   */
  const facets: { key: Facet; label: string; color: string }[] = [
    { key: 'all', label: 'All', color: 'var(--color-text-primary)' },
    { key: 'live', label: 'Bidding live', color: 'var(--color-warning-text)' },
    { key: 'trade', label: 'Wants players', color: 'var(--color-text-secondary)' },
    { key: 'cash', label: 'Wants cash', color: 'var(--color-accent-ink)' },
    { key: 'loan', label: 'Would loan out', color: 'var(--color-text-secondary)' },
    { key: 'clause', label: 'Has clause', color: 'var(--color-gold)' },
    { key: 'affordable', label: 'Within budget', color: 'var(--color-text-secondary)' },
    { key: 'mine', label: 'Yours', color: 'var(--color-text-muted)' },
  ];

  return (
    <div className={styles.page}>
      <TransfersSubNav leagueId={leagueId} counts={model.counts} />

      <header className={styles.header}>
        <div>
          <div className={`g-label ${styles.kicker}`}>Transfer Market → Listings</div>
          <h1 className={styles.title}>The Listings Board</h1>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${styles.statAccent}`}>€{budget}m</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Club Balance</div>
          </div>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${styles.statWarn}`}>{count('live')}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Bidding live</div>
          </div>
          {/* No colour: the loan count used --color-pos-wb, a wing-back field
              colour standing in for "would loan out". Its label says it. */}
          <div className={styles.stat}>
            <div className={styles.statValue}>{count('loan')}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Would loan out</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{count('mine')}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Yours</div>
          </div>
        </div>
      </header>

      <div className={styles.tools}>
        <div className={styles.searchRow}>
          <input
            className={styles.input}
            placeholder="Search listings by player or club…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search listings"
          />
          <select className={styles.select} value={position} onChange={(e) => setPosition(e.target.value)} aria-label="Filter by position">
            <option value="">Any position</option>
            {positions.map((p) => <option key={p} value={p}>{p}</option>)}
          </select>
          <select className={styles.select} value={club} onChange={(e) => setClub(e.target.value)} aria-label="Filter by club">
            <option value="">Any club</option>
            {clubs.map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
          <select className={styles.select} value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort listings">
            {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
          </select>
          <button type="button" className={styles.cta} onClick={() => setEditing('new')}>
            + List a player
          </button>
        </div>

        <div className={styles.facets}>
          {facets.map((f) => {
            const n = count(f.key);
            return (
              <button
                key={f.key}
                type="button"
                className={`${styles.facet} ${facet === f.key ? styles.facetOn : ''}`}
                style={facet === f.key ? { background: f.color, borderColor: f.color } : { color: f.color }}
                onClick={() => setFacet(f.key)}
              >
                {f.label} <span className={styles.facetCount}>{n}</span>
              </button>
            );
          })}
        </div>
      </div>

      {visible.length === 0 ? (
        <p className={styles.empty}>
          {model.listings.length === 0
            ? 'No club has listed a player yet.'
            : 'No listing matches those filters.'}
        </p>
      ) : (
        <div className={styles.grid}>
          {visible.map((l) => (
            <ListingCard
              key={l.id}
              listing={l}
              auction={auctionByListing.get(l.id) ?? null}
              seller={teamById.get(l.seller_team_id)}
              isMine={l.seller_team_id === model.myTeam.id}
              offerCount={offersByListing.get(l.id) ?? 0}
              onOpenPlayer={() => {
                if (l.player) openPlayer(l.player as unknown as Player);
              }}
              onBid={(x) => setBid({ listing: x, mode: 'bid' })}
              onClause={(x) => setBid({ listing: x, mode: 'clause' })}
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

      {bid?.listing.player && (
        <BidDialog
          open
          onClose={() => setBid(null)}
          leagueId={leagueId}
          player={bid.listing.player}
          auction={auctionByListing.get(bid.listing.id) ?? null}
          listing={bid.listing}
          mode={bid.mode}
          budget={budget}
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
          listing={editing === 'new' ? null : editing}
          myRoster={model.myRoster}
          onDone={refresh}
        />
      )}
    </div>
  );
}
