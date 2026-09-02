'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { GranularPosition, Player } from '@/types';
import type { EnrichedPlayer, TransfersAuction, TransfersModel } from '@/lib/transfers/buildTransfersModel';
import { playerHoverProps, usePlayerCard } from '@/components/players/PlayerCardProvider';
import PositionBadge from '@/components/players/PositionBadge';
import TransfersSubNav from '@/components/transfers/TransfersSubNav';
import BidDialog from '@/components/transfers/BidDialog';
import AuctionTimingHelp from '@/components/transfers/AuctionTimingHelp';
import { setServerClock, useTick, formatAuctionClock, isClosing } from '@/components/transfers/useTick';
import { useLiveTransfers } from '@/components/transfers/useLiveTransfers';
import styles from './free-agents.module.css';
import { getPlayerDisplayName } from '@/lib/players/displayName';

/**
 * Free Agency — the browsing problem.
 *
 * Hundreds of unowned players, so everything is server-side: filtering,
 * sorting and pagination all happen in GET /transfers/free-agents, and this
 * component holds one page at a time. Sorting in particular MUST stay on the
 * server — `ppg`, `form_rating` and `total_points` are overwritten from the
 * season archive during enrichment, so sorting the 40 rows we happen to hold
 * would rank a page rather than the league.
 *
 * Players already under the hammer appear at the top as live auctions rather
 * than in the table; the route excludes them from its own results so they
 * cannot show twice.
 */

const POSITIONS: GranularPosition[] = [
  'GK', 'CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST',
];

const SORTS = [
  { key: 'points', label: 'Total points' },
  { key: 'ppg', label: 'Points per game' },
  { key: 'form', label: 'Form' },
  { key: 'value', label: 'Market value' },
  { key: 'name', label: 'Name' },
];

const money = (n: number) => `€${n}m`;
const PAGE_SIZE = 40;

export default function FreeAgentsClient({
  leagueId,
  initial,
}: {
  leagueId: string;
  initial: TransfersModel;
}) {
  const router = useRouter();
  const model = useLiveTransfers(leagueId, initial);
  const { openPlayer, prefetchPlayer, primePlayers } = usePlayerCard();

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [position, setPosition] = useState('');
  const [sort, setSort] = useState('points');
  const [page, setPage] = useState(1);

  const [rows, setRows] = useState<EnrichedPlayer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [bidFor, setBidFor] = useState<EnrichedPlayer | null>(null);
  const [newTransfers, setNewTransfers] = useState<EnrichedPlayer[]>([]);

  useEffect(() => { setServerClock(model.serverNow); }, [model.serverNow]);

  // Typing must not fire a request per keystroke against a 600-row scan.
  useEffect(() => {
    const t = setTimeout(() => {
      setDebounced(query);
      setPage(1);
    }, 250);
    return () => clearTimeout(t);
  }, [query]);

  // Drop a response that arrives after a newer one has already been applied —
  // otherwise a slow page-1 request can overwrite a fast page-2.
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const sp = new URLSearchParams({
        sort,
        page: String(page),
        pageSize: String(PAGE_SIZE),
        dir: sort === 'name' ? 'asc' : 'desc',
      });
      if (debounced.trim()) sp.set('q', debounced.trim());
      if (position) sp.set('position', position);

      const res = await fetch(`/api/leagues/${leagueId}/transfers/free-agents?${sp}`);
      const data = await res.json();
      if (id !== requestId.current) return;
      if (!res.ok) {
        setError(data.error ?? 'Could not load free agents.');
        return;
      }
      setRows(data.players ?? []);
      setTotal(data.total ?? 0);
      primePlayers((data.players ?? []) as unknown as Player[]);
    } catch {
      if (id === requestId.current) setError('Could not reach the server.');
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [leagueId, debounced, position, sort, page, primePlayers]);

  useEffect(() => { load(); }, [load]);

  // "New transfers" — a pinned highlight, fetched once and independent of the
  // main table's own filters/sort/page, so it always shows who actually just
  // arrived rather than whatever the current sort happens to surface.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/leagues/${leagueId}/transfers/free-agents?newOnly=true&pageSize=12`);
        const data = await res.json();
        if (cancelled || !res.ok) return;
        setNewTransfers(data.players ?? []);
        primePlayers((data.players ?? []) as unknown as Player[]);
      } catch {
        // Supplementary highlight — a failed fetch here shouldn't block the page.
      }
    })();
    return () => { cancelled = true; };
  }, [leagueId, primePlayers]);

  // Free-agent auctions already running, shown above the table.
  const liveAuctions = useMemo(
    () => model.auctions.filter((a) => a.kind === 'free_agent'),
    [model.auctions],
  );

  const lastPage = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className={styles.page}>
      <TransfersSubNav leagueId={leagueId} counts={model.counts} />

      <header className={styles.header}>
        <div>
          <div className={`g-label ${styles.kicker}`}>Transfer Market → Free Agency</div>
          <h1 className={styles.title}>Free Agency</h1>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${styles.statAccent}`}>{money(model.myTeam.faab_budget)}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Club Balance</div>
          </div>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${styles.statWarn}`}>{liveAuctions.length}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Under the hammer</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{total || model.counts.freeAgents}</div>
            <div className={`g-label-quiet ${styles.statLabel}`}>Available</div>
          </div>
        </div>
      </header>

      {liveAuctions.length > 0 && (
        <section className={styles.auctions}>
          <h2 className={styles.auctionsTitle}>
            Bidding open <AuctionTimingHelp />
          </h2>
          <div className={styles.auctionsGrid}>
            {liveAuctions.map((a) => (
              <AuctionChip
                key={a.player_id}
                auction={a}
                myTeamId={model.myTeam.id}
                onBid={() => a.player && setBidFor(a.player)}
                onOpen={() => a.player && openPlayer(a.player as unknown as Player)}
              />
            ))}
          </div>
        </section>
      )}

      {newTransfers.length > 0 && (
        <section className={styles.newTransfers}>
          <h2 className={styles.newTransfersTitle}>New transfers</h2>
          <div className={styles.newTransfersGrid}>
            {newTransfers.map((p) => (
              <button
                key={p.id}
                type="button"
                className={styles.newTransferCard}
                onClick={() => openPlayer(p as unknown as Player)}
                {...playerHoverProps(prefetchPlayer, p)}
              >
                <span className={`g-namerow ${styles.newTransferTop}`}>
                  <PositionBadge position={p.primary_position as GranularPosition} size="sm" />
                  <span className={styles.newTransferName}>{getPlayerDisplayName(p, 'initial_last')}</span>
                </span>
                <span className={styles.newTransferMeta}>{p.pl_team}</span>
                <span className={styles.newTransferBadge}>{daysAgoLabel(p.pl_team_changed_at)}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      <div className={styles.tools}>
        <input
          className={styles.input}
          placeholder="Search every unowned player…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search free agents"
        />
        <select
          className={styles.select}
          value={sort}
          onChange={(e) => { setSort(e.target.value); setPage(1); }}
          aria-label="Sort free agents"
        >
          {SORTS.map((s) => <option key={s.key} value={s.key}>Sort: {s.label}</option>)}
        </select>
      </div>

      <div className={styles.positions}>
        <button
          type="button"
          className={`${styles.pos} ${position === '' ? styles.posOn : ''}`}
          onClick={() => { setPosition(''); setPage(1); }}
        >
          All
        </button>
        {POSITIONS.map((p) => (
          <button
            key={p}
            type="button"
            className={`${styles.pos} ${position === p ? styles.posOn : ''}`}
            onClick={() => { setPosition(position === p ? '' : p); setPage(1); }}
          >
            {p}
          </button>
        ))}
      </div>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.thPlayer}>Player</th>
              <th className={styles.thClub}>Club</th>
              <th className={`${styles.thNum} ${styles.num}`}>Value</th>
              <th className={`${styles.thNum} ${styles.num}`}>Pts</th>
              <th className={`${styles.thNum} ${styles.num}`}>PPG</th>
              <th className={`${styles.thNum} ${styles.num}`}>Form</th>
              <th className={styles.thAction}><span className={styles.srOnly}>Actions</span></th>
            </tr>
          </thead>
          <tbody className={loading ? styles.loading : ''}>
            {rows.map((p) => (
              <tr
                key={p.id}
                className="g-row"
                style={{ '--pf': `var(--color-pos-${String(p.primary_position).toLowerCase()})` } as React.CSSProperties}
              >
                {/* The flex row lives in a div, not on the <td>. `display: flex`
                    on a table cell overrides `display: table-cell` and drops it
                    out of the column model, which breaks both the row rule and
                    the alignment of every column after it. */}
                <td className={styles.tdPlayer}>
                  <span className={`g-namerow ${styles.playerCell}`}>
                    <PositionBadge position={p.primary_position as GranularPosition} size="sm" />
                    <button
                      type="button"
                      className={styles.playerName}
                      onClick={() => openPlayer(p as unknown as Player)}
                      {...playerHoverProps(prefetchPlayer, p)}
                      title={p.name}
                    >
                      {getPlayerDisplayName(p, 'initial_last')}
                    </button>
                  </span>
                </td>
                <td className={styles.club}>{p.pl_team}</td>
                <td className={styles.num}>{money(Number(p.market_value) || 0)}</td>
                <td className={styles.num}>{p.total_points ?? 0}</td>
                <td className={styles.num}>{p.ppg != null ? Number(p.ppg).toFixed(1) : '—'}</td>
                <td className={styles.num}>{p.form_rating != null ? Number(p.form_rating).toFixed(1) : '—'}</td>
                <td className={styles.tdAction}>
                  <button type="button" className={styles.bidBtn} onClick={() => setBidFor(p)}>
                    Bid
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {!loading && rows.length === 0 && !error && (
          <p className={styles.empty}>Nobody unowned matches that.</p>
        )}
      </div>

      {lastPage > 1 && (
        <div className={styles.pager}>
          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1 || loading}
          >
            ← Previous
          </button>
          <span className={styles.pageOf}>
            Page {page} of {lastPage} · {total} players
          </span>
          <button
            type="button"
            className={styles.pageBtn}
            onClick={() => setPage((p) => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage || loading}
          >
            Next →
          </button>
        </div>
      )}

      {bidFor && (
        <BidDialog
          open
          onClose={() => setBidFor(null)}
          leagueId={leagueId}
          player={bidFor}
          auction={model.auctions.find((a) => a.player_id === bidFor.id) ?? null}
          listing={null}
          mode="bid"
          budget={model.myTeam.faab_budget}
          committedTotal={model.auctions.reduce((s, a) => s + (a.my_bid != null && a.my_bid > 0 ? a.my_bid : 0), 0)}
          openBidCount={model.auctions.filter((a) => a.my_bid != null && a.my_bid > 0).length}
          rosterFull={model.rosterFull}
          myRoster={model.myRoster}
          academy={model.academy}
          bidFloor={model.league.free_agent_bid_floor ?? 0.5}
          onDone={() => { router.refresh(); load(); }}
        />
      )}
    </div>
  );
}

/** "New today", "3d ago" — day granularity, no live tick needed. */
function daysAgoLabel(iso: string | null): string {
  if (!iso) return 'New';
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86400_000);
  return days <= 0 ? 'New today' : `${days}d ago`;
}

/** A free-agent auction, compressed to a chip. */
function AuctionChip({
  auction,
  myTeamId,
  onBid,
  onOpen,
}: {
  auction: TransfersAuction;
  myTeamId: string;
  onBid: () => void;
  onOpen: () => void;
}) {
  const { prefetchPlayer } = usePlayerCard();
  const now = useTick(Boolean(auction.expires_at));
  const msLeft = auction.expires_at ? new Date(auction.expires_at).getTime() - now : 0;
  const hot = Boolean(auction.expires_at) && isClosing(msLeft);
  const settling = Boolean(auction.expires_at) && msLeft <= 0;
  const leading = auction.highest_bidder_team_id === myTeamId;
  // This chip only ever renders a free_agent auction (filtered above by the
  // caller), which always has a computed minimum_bid — never a listing, so
  // never null (114). The fallback is type-level safety, not a real case.
  const floor = auction.minimum_bid ?? 0;
  const next = auction.highest_bid > 0 ? auction.highest_bid + 1 : floor;

  // A staggered kickoff wave or a marquee midday release defers when bidding
  // opens; without this the chip showed an ordinary countdown and an enabled
  // Bid button for a lot that would reject the bid until then (same fix as
  // the listing card and the auction room).
  const opensAtMs = auction.opens_at ? new Date(auction.opens_at).getTime() : null;
  const notOpenYet = opensAtMs != null && now < opensAtMs;
  const opensLabel = opensAtMs
    ? new Date(opensAtMs).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : '';

  return (
    <article className={`${styles.chip} ${hot && !notOpenYet ? styles.chipHot : ''}`}>
      <div className={`g-namerow ${styles.chipTop}`}>
        {auction.player && (
          <PositionBadge position={auction.player.primary_position as GranularPosition} size="sm" />
        )}
        <button
          type="button"
          className={styles.chipName}
          onClick={onOpen}
          {...(auction.player ? playerHoverProps(prefetchPlayer, auction.player) : {})}
        >
          {auction.player ? getPlayerDisplayName(auction.player, 'initial_last') : ''}
        </button>
      </div>
      <div className={styles.chipMeta}>
        {auction.player?.pl_team} ·{' '}
        {leading ? 'you lead' : auction.bid_count === 0 ? 'no bids' : `${auction.bid_count} bids`}
      </div>
      <div className={styles.chipBottom}>
        <span className={styles.chipPrice}>
          {money(auction.highest_bid > 0 ? auction.highest_bid : floor)}
        </span>
        <span className={`${styles.chipClock} ${hot && !notOpenYet ? styles.chipClockHot : ''}`}>
          {notOpenYet ? `Opens ${opensLabel}` : auction.expires_at ? formatAuctionClock(msLeft, true) : '—'}
        </span>
      </div>
      <button
        type="button"
        className={`${styles.chipGo} ${leading ? styles.chipGoGhost : ''}`}
        onClick={onBid}
        disabled={settling || notOpenYet}
        title={notOpenYet ? `Bidding opens at ${opensLabel}` : settling ? 'Auction is settling' : undefined}
      >
        {notOpenYet ? `Opens ${opensLabel}` : leading ? `Raise ${money(next)}` : `Bid ${money(next)}`}
      </button>
    </article>
  );
}
