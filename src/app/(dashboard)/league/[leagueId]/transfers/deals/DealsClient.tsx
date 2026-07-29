'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import type { GranularPosition, Player } from '@/types';
import type {
  LoanRow,
  TradeProposalRow,
  TransfersListing,
  TransfersModel,
} from '@/lib/transfers/buildTransfersModel';
import type { CrestConfig } from '@/components/crest/types';
import CrestBadge from '@/components/crest/CrestBadge';
import PositionBadge from '@/components/players/PositionBadge';
import { usePlayerCard } from '@/components/players/PlayerCardProvider';
import TransfersSubNav from '@/components/transfers/TransfersSubNav';
import ListingCard from '@/components/transfers/ListingCard';
import ProposeBuilder, { type LoanDirection, type ProposeMode } from '@/components/transfers/ProposeBuilder';
import ListingEditor from '@/components/transfers/ListingEditor';
import { setServerClock } from '@/components/transfers/useTick';
import styles from './deals.module.css';
import { getPlayerDisplayName } from '@/lib/players/displayName';

/**
 * Deals — your business only.
 *
 * There is no listings board here. That was the confusion in an earlier draft:
 * Listings is the league's supply, Deals is your desk. What appears on this page
 * either needs an answer from you, is waiting on an answer from someone else, or
 * is something of yours already running.
 */

const money = (n: number) => `€${n}m`;

export default function DealsClient({
  leagueId,
  initial,
}: {
  leagueId: string;
  initial: TransfersModel;
}) {
  const model = initial;
  const router = useRouter();
  const { openPlayer, primePlayers } = usePlayerCard();
  const me = model.myTeam.id;

  const [propose, setPropose] = useState<ProposeMode | null>(null);
  const [proposeTeamId, setProposeTeamId] = useState<string | null>(null);
  const [proposePlayerId, setProposePlayerId] = useState<string | null>(null);
  const [proposeRightId, setProposeRightId] = useState<string | null>(null);
  const [proposeLoanDirection, setProposeLoanDirection] = useState<LoanDirection>('borrow');
  const [editing, setEditing] = useState<TransfersListing | null | 'new'>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const refresh = () => router.refresh();

  useEffect(() => { setServerClock(model.serverNow); }, [model.serverNow]);
  useEffect(() => {
    const rows = Object.values(model.playerMap) as unknown as Player[];
    if (rows.length) primePlayers(rows);
  }, [model.playerMap, primePlayers]);

  const teamById = useMemo(() => new Map(model.allTeams.map((t) => [t.id, t])), [model.allTeams]);
  const auctionByListing = useMemo(() => {
    const m = new Map<string, (typeof model.auctions)[number]>();
    for (const a of model.auctions) if (a.sale_listing_id) m.set(a.sale_listing_id, a);
    return m;
  }, [model.auctions]);

  // Waiting on you: proposals where you are the responder, and loans where the
  // other club made the running.
  const toAnswer = model.myOffers.filter((o) => o.status === 'pending' && o.team_b_id === me);
  const sent = model.myOffers.filter((o) => o.status === 'pending' && o.team_a_id === me);
  const loansToAnswer = model.loans.filter((l) => {
    if (l.status !== 'pending') return false;
    // proposed_by names who made the running; the OTHER side answers.
    const responder = l.proposed_by === 'borrower' ? l.lender_team_id : l.borrower_team_id;
    return responder === me;
  });
  const loansSent = model.loans.filter((l) => {
    if (l.status !== 'pending') return false;
    const proposer = l.proposed_by === 'borrower' ? l.borrower_team_id : l.lender_team_id;
    return proposer === me;
  });

  const myListings = model.listings.filter((l) => l.seller_team_id === me);
  const runningLoans = model.loans.filter(
    (l) => ['active', 'accepted_deferred', 'pending_activation'].includes(l.status) &&
      (l.lender_team_id === me || l.borrower_team_id === me),
  );

  const act = async (kind: 'trade' | 'loan', id: string, action: 'accept' | 'reject' | 'cancel') => {
    setBusyId(id);
    setError(null);
    try {
      const url =
        kind === 'trade'
          ? `/api/leagues/${leagueId}/trades/${id}`
          : `/api/leagues/${leagueId}/loans/${id}`;
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'That could not be completed.');
        return;
      }
      refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusyId(null);
    }
  };

  const loanSideAction = async (loanId: string, kind: 'recall' | 'slot-buyback') => {
    setBusyId(loanId);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/loans/${loanId}/${kind}`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'That could not be completed.');
        return;
      }
      refresh();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusyId(null);
    }
  };

  const assetNames = (ids: string[] | null | undefined) =>
    (ids ?? []).map((id) => model.playerMap[id]).filter(Boolean);

  // A right isn't a roster player — resolve it to the underlying player so it
  // can render alongside the players it's traded with, tagged as rights.
  const rightAssets = (ids: string[] | null | undefined) =>
    (ids ?? [])
      .map((id) => model.rightsMap[id]?.player)
      .filter((p): p is NonNullable<typeof p> => Boolean(p));

  const TradeCard = ({ p, incoming }: { p: TradeProposalRow; incoming: boolean }) => {
    const them = incoming ? p.team_a?.team_name : p.team_b?.team_name;
    // team_a always offers; team_b always gives what was requested.
    const theyGive = incoming ? assetNames(p.offered_players) : assetNames(p.requested_players);
    const youGive = incoming ? assetNames(p.requested_players) : assetNames(p.offered_players);
    const theyGiveRights = incoming ? rightAssets(p.offered_rights) : rightAssets(p.requested_rights);
    const youGiveRights = incoming ? rightAssets(p.requested_rights) : rightAssets(p.offered_rights);
    const theirCash = incoming ? p.offered_faab : p.requested_faab;
    const yourCash = incoming ? p.requested_faab : p.offered_faab;

    return (
      <article className={`${styles.deal} ${incoming ? styles.dealActive : ''}`}>
        <header className={styles.dealHead}>
          <span className={styles.dealTitle}>
            {incoming ? `${them} → you` : `you → ${them}`}
          </span>
          <span
            className={styles.dealTag}
            style={{ background: p.sale_listing_id ? 'var(--color-accent)' : 'var(--color-pos-cb)' }}
          >
            {p.sale_listing_id ? 'Offer on your listing' : 'Trade'}
          </span>
        </header>

        <div className={styles.dealSides}>
          <div className={styles.dealSide}>
            <div className={styles.dealLabel}>They give</div>
            <AssetList players={theyGive} onOpen={openPlayer} />
            <AssetList players={theyGiveRights} onOpen={openPlayer} rights />
            {theirCash > 0 && <div className={styles.dealCash}>{money(theirCash)}</div>}
            {theyGive.length === 0 && theyGiveRights.length === 0 && theirCash === 0 && (
              <div className={styles.dealNone}>—</div>
            )}
          </div>
          <div className={styles.dealSwap} aria-hidden="true">⇄</div>
          <div className={`${styles.dealSide} ${styles.dealSideRight}`}>
            <div className={styles.dealLabel}>You give</div>
            <AssetList players={youGive} onOpen={openPlayer} align="right" />
            <AssetList players={youGiveRights} onOpen={openPlayer} align="right" rights />
            {yourCash > 0 && <div className={styles.dealCash}>{money(yourCash)}</div>}
            {youGive.length === 0 && youGiveRights.length === 0 && yourCash === 0 && (
              <div className={styles.dealNone}>—</div>
            )}
          </div>
        </div>

        {p.message && <p className={styles.dealNote}>“{p.message}”</p>}

        <div className={styles.dealActions}>
          {incoming ? (
            <>
              <button
                type="button"
                className={`${styles.dealBtn} ${styles.dealBtnYes}`}
                disabled={busyId === p.id}
                onClick={() => act('trade', p.id, 'accept')}
              >
                Accept
              </button>
              <button
                type="button"
                className={styles.dealBtn}
                disabled={busyId === p.id}
                onClick={() => {
                  setProposeRightId(null);
                  setProposeTeamId(p.team_a_id);
                  setProposePlayerId(p.requested_players?.[0] ?? null);
                  setPropose('trade');
                }}
              >
                Counter
              </button>
              <button
                type="button"
                className={styles.dealBtn}
                disabled={busyId === p.id}
                onClick={() => act('trade', p.id, 'reject')}
              >
                Decline
              </button>
            </>
          ) : (
            <button
              type="button"
              className={styles.dealBtn}
              disabled={busyId === p.id}
              onClick={() => act('trade', p.id, 'cancel')}
            >
              Withdraw
            </button>
          )}
        </div>
      </article>
    );
  };

  const LoanCard = ({ l, answerable }: { l: LoanRow; answerable: boolean }) => {
    const lending = l.lender_team_id === me;
    const other = lending ? l.borrower_team?.team_name : l.lender_team?.team_name;

    return (
      <article className={`${styles.deal} ${answerable ? styles.dealActive : ''}`}>
        <header className={styles.dealHead}>
          <span className={styles.dealTitle}>
            {l.player ? getPlayerDisplayName(l.player, 'full') : 'A player'} {lending ? '→' : '←'} {other}
          </span>
          <span className={styles.dealTag} style={{ background: 'var(--color-pos-wb)' }}>
            Loan · GW{l.start_gameweek}–{l.end_gameweek}
          </span>
        </header>

        <div className={styles.dealSides}>
          <div className={styles.dealSide}>
            <div className={styles.dealLabel}>{lending ? 'Fee you receive' : 'Fee you pay'}</div>
            <div className={styles.dealCash}>{money(Number(l.loan_fee) || 0)}</div>
          </div>
          <div className={styles.dealSwap} aria-hidden="true">⇄</div>
          <div className={`${styles.dealSide} ${styles.dealSideRight}`}>
            <div className={styles.dealLabel}>Points bonus</div>
            <div className={styles.dealCash}>
              {Number(l.bonus_rate) > 0 ? `€${Number(l.bonus_rate).toFixed(3)}m / pt` : 'None'}
              {Number(l.bonus_cap) > 0 && (
                <span className={styles.dealCap}> · cap {money(Number(l.bonus_cap))}</span>
              )}
            </div>
          </div>
        </div>

        <div className={styles.dealActions}>
          {answerable ? (
            <>
              <button
                type="button"
                className={`${styles.dealBtn} ${styles.dealBtnYes}`}
                disabled={busyId === l.id}
                onClick={() => act('loan', l.id, 'accept')}
              >
                Accept
              </button>
              <button
                type="button"
                className={styles.dealBtn}
                disabled={busyId === l.id}
                onClick={() => act('loan', l.id, 'reject')}
              >
                Decline
              </button>
            </>
          ) : l.status === 'pending' ? (
            <button
              type="button"
              className={styles.dealBtn}
              disabled={busyId === l.id}
              onClick={() => act('loan', l.id, 'cancel')}
            >
              Withdraw
            </button>
          ) : l.status === 'active' && lending ? (
            <>
              {!l.slot_buyback_used ? (
                <button
                  type="button"
                  className={styles.dealBtn}
                  disabled={busyId === l.id}
                  title={`Pay ${money(model.league.loan_slot_buyback_fee ?? 25)} to unlock a signing slot while this loan is active.`}
                  onClick={() => loanSideAction(l.id, 'slot-buyback')}
                >
                  Buy back slot ({money(model.league.loan_slot_buyback_fee ?? 25)})
                </button>
              ) : (
                <span className={styles.dealStatus}>Slot bought back</span>
              )}
              {l.has_recall && (
                <button
                  type="button"
                  className={styles.dealBtn}
                  disabled={busyId === l.id}
                  onClick={() => {
                    if (window.confirm(
                      `Recall ${l.player ? getPlayerDisplayName(l.player, 'full') : 'this player'} early? You will pay a €25m penalty to the borrower.`,
                    )) {
                      loanSideAction(l.id, 'recall');
                    }
                  }}
                >
                  Recall
                </button>
              )}
            </>
          ) : (
            <span className={styles.dealStatus}>Running</span>
          )}
        </div>
      </article>
    );
  };

  const answerCount = toAnswer.length + loansToAnswer.length;

  return (
    <div className={styles.page}>
      <TransfersSubNav leagueId={leagueId} counts={model.counts} />

      <header className={styles.header}>
        <div>
          <div className={styles.kicker}>Transfer Market → Deals</div>
          <h1 className={styles.title}>Your Deals</h1>
        </div>
        <div className={styles.stats}>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${answerCount ? styles.statRed : ''}`}>{answerCount}</div>
            <div className={styles.statLabel}>To answer</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{sent.length + loansSent.length}</div>
            <div className={styles.statLabel}>Sent</div>
          </div>
          <div className={styles.stat}>
            <div className={styles.statValue}>{myListings.length}</div>
            <div className={styles.statLabel}>Your listings</div>
          </div>
          <div className={styles.stat}>
            <div className={`${styles.statValue} ${styles.statTeal}`}>
              {runningLoans.filter((l) => l.borrower_team_id === me).length} of{' '}
              {model.league.max_loan_ins ?? 2}
            </div>
            <div className={styles.statLabel}>Loan slots</div>
          </div>
        </div>
      </header>

      <div className={styles.body}>
        <main className={styles.main}>
          {/* A listing is an advertisement, never the only route in. */}
          <div className={styles.proposeBar}>
            <span className={styles.proposeText}>
              <b>Start something.</b> You don&rsquo;t need a listing — propose on any player in the league.
            </span>
            <button
              type="button"
              className={styles.proposeBtn}
              style={{ background: 'var(--color-pos-cb)' }}
              onClick={() => { setProposeRightId(null); setProposeTeamId(null); setProposePlayerId(null); setPropose('trade'); }}
            >
              Propose a trade
            </button>
            <button
              type="button"
              className={styles.proposeBtn}
              style={{ background: 'var(--color-accent)' }}
              onClick={() => { setProposeTeamId(null); setProposePlayerId(null); setPropose('buy'); }}
            >
              Offer to buy
            </button>
            <button
              type="button"
              className={styles.proposeBtn}
              style={{ background: 'var(--color-pos-wb)' }}
              onClick={() => { setProposeLoanDirection('borrow'); setProposeTeamId(null); setProposePlayerId(null); setPropose('loan'); }}
            >
              Request a loan
            </button>
            <button
              type="button"
              className={styles.proposeBtn}
              style={{ background: 'var(--color-pos-wb)' }}
              onClick={() => { setProposeLoanDirection('lend'); setProposeTeamId(null); setProposePlayerId(null); setPropose('loan'); }}
            >
              Propose a loan
            </button>
          </div>

          {error && <p className={styles.error}>{error}</p>}

          <div className={styles.sect}>
            <h2 className={styles.sectTitle}>Waiting on you</h2>
            <span className={styles.sectHint}>
              {answerCount === 0 ? 'nothing needs an answer' : `${answerCount} to answer`}
            </span>
          </div>

          {answerCount === 0 ? (
            <p className={styles.empty}>Your inbox is clear.</p>
          ) : (
            <>
              {toAnswer.map((p) => <TradeCard key={p.id} p={p} incoming />)}
              {loansToAnswer.map((l) => <LoanCard key={l.id} l={l} answerable />)}
            </>
          )}

          {(sent.length > 0 || loansSent.length > 0) && (
            <>
              <div className={`${styles.sect} ${styles.sectSpaced}`}>
                <h2 className={styles.sectTitle}>Waiting on them</h2>
                <span className={styles.sectHint}>{sent.length + loansSent.length} sent</span>
              </div>
              {sent.map((p) => <TradeCard key={p.id} p={p} incoming={false} />)}
              {loansSent.map((l) => <LoanCard key={l.id} l={l} answerable={false} />)}
            </>
          )}

          <div className={`${styles.sect} ${styles.sectSpaced}`}>
            <h2 className={styles.sectTitle}>Your listings</h2>
            <span className={styles.sectHint}>
              {myListings.length} · manage terms and answer offers
            </span>
            <button type="button" className={styles.sectMore} onClick={() => setEditing('new')}>
              + List a player
            </button>
          </div>

          {myListings.length === 0 ? (
            <p className={styles.empty}>You have nobody on the market.</p>
          ) : (
            <div className={styles.listingGrid}>
              {myListings.map((l) => (
                <ListingCard
                  key={l.id}
                  listing={l}
                  auction={auctionByListing.get(l.id) ?? null}
                  seller={teamById.get(l.seller_team_id)}
                  isMine
                  offerCount={toAnswer.filter((o) => o.sale_listing_id === l.id).length}
                  onOpenPlayer={() => l.player && openPlayer(l.player as unknown as Player)}
                  onEdit={(x) => setEditing(x)}
                  onReview={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
                />
              ))}
            </div>
          )}

          {runningLoans.length > 0 && (
            <>
              <div className={`${styles.sect} ${styles.sectSpaced}`}>
                <h2 className={styles.sectTitle}>Loans running</h2>
                <span className={styles.sectHint}>
                  {runningLoans.filter((l) => l.lender_team_id === me).length} out ·{' '}
                  {runningLoans.filter((l) => l.borrower_team_id === me).length} in
                </span>
              </div>
              {runningLoans.map((l) => <LoanCard key={l.id} l={l} answerable={false} />)}
            </>
          )}
        </main>

        {/* ── The other clubs ───────────────────────────── */}
        <aside className={styles.rail}>
          <div className={styles.railHead}>
            <h2 className={styles.railTitle}>The other clubs</h2>
          </div>

          <div className={styles.clubList}>
            {model.allTeams
              .filter((t) => t.id !== me)
              .map((t) => {
                const listed = model.listings.filter((l) => l.seller_team_id === t.id).length;
                const talking = model.myOffers.some(
                  (o) => o.status === 'pending' && (o.team_a_id === t.id || o.team_b_id === t.id),
                );
                const theyAsked = toAnswer.some((o) => o.team_a_id === t.id);

                return (
                  <div key={t.id} className={styles.club}>
                    <CrestBadge
                      config={(t.crest_config as CrestConfig | null) ?? null}
                      teamName={t.team_name}
                      size={22}
                    />
                    <div className={styles.clubBody}>
                      <div className={styles.clubName}>{t.team_name}</div>
                      <div className={styles.clubMeta}>
                        {listed === 0 ? 'nothing listed' : `${listed} listed`}
                      </div>
                    </div>
                    <div className={styles.clubBal}>{money(t.faab_budget)}</div>
                    <span
                      className={`${styles.clubTag} ${
                        theyAsked ? styles.clubTagThem : talking ? styles.clubTagYou : styles.clubTagIdle
                      }`}
                    >
                      {theyAsked ? 'Offered' : talking ? 'In talks' : 'No talks'}
                    </span>
                  </div>
                );
              })}
          </div>

          <div className={styles.desk}>
            <div className={styles.deskRow}>
              <span className={styles.deskLabel}>Loans out</span>
              <span className={styles.deskValue}>
                {runningLoans.filter((l) => l.lender_team_id === me).length} of{' '}
                {model.league.max_loan_outs ?? 1}
              </span>
            </div>
            <div className={styles.deskRow}>
              <span className={styles.deskLabel}>Loans in</span>
              <span className={styles.deskValue}>
                {runningLoans.filter((l) => l.borrower_team_id === me).length} of{' '}
                {model.league.max_loan_ins ?? 2}
              </span>
            </div>
            <div className={`${styles.deskRow} ${styles.deskLast}`}>
              <span className={styles.deskLabel}>Club Balance</span>
              <span className={`${styles.deskValue} ${styles.statAccent}`}>
                {money(model.myTeam.faab_budget)}
              </span>
            </div>
          </div>
        </aside>
      </div>

      <Suspense fallback={null}>
        <ProposeRightReader onFound={(id) => { setProposeRightId(id); setPropose('trade'); }} />
      </Suspense>

      {propose && (
        <ProposeBuilder
          open
          onClose={() => setPropose(null)}
          leagueId={leagueId}
          model={model}
          initialMode={propose}
          initialTeamId={proposeTeamId}
          initialPlayerId={proposePlayerId}
          initialGiveRightId={proposeRightId}
          initialLoanDirection={proposeLoanDirection}
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

function AssetList({
  players,
  onOpen,
  align,
  rights,
}: {
  players: { id: string; name: string; web_name?: string | null; primary_position: string }[];
  onOpen: (p: Player) => void;
  align?: 'right';
  /** These are retained rights, not roster players — tag them so they're not mistaken for one. */
  rights?: boolean;
}) {
  if (players.length === 0) return null;
  return (
    <div className={`${styles.assets} ${align === 'right' ? styles.assetsRight : ''}`}>
      {players.map((p) => (
        <span key={p.id} className={styles.asset}>
          <PositionBadge position={p.primary_position as GranularPosition} size="sm" />
          <button
            type="button"
            className={styles.assetName}
            onClick={() => onOpen(p as unknown as Player)}
          >
            {getPlayerDisplayName(p, 'full')}
            {rights ? ' (rights)' : ''}
          </button>
        </span>
      ))}
    </div>
  );
}

/**
 * Reads `?proposeRight=<decisionId>` from the URL and opens the trade builder
 * with it pre-loaded — the landing spot for the Retained List's Trade CTA,
 * which can't open the builder directly since it lives outside the hub.
 * `useSearchParams` needs a Suspense boundary; isolated here so it doesn't
 * force the whole page into one.
 */
function ProposeRightReader({ onFound }: { onFound: (rightId: string) => void }) {
  const searchParams = useSearchParams();
  useEffect(() => {
    const rightId = searchParams.get('proposeRight');
    if (rightId) onFound(rightId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}
