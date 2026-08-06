'use client';

import NavigationLink from '@/components/ui/NavigationLink';
import type { DepartureView, ClubProps } from './ClubClient';
import type { DecisionRequest } from '@/components/teams/DepartureDecisionModal';
import { PosBadge } from './SquadViews';
import { posColor, money, countdown } from './clubDerive';
import { getPlayerDisplayName, playerInitial } from '@/lib/players/displayName';
import styles from './club.module.css';

export default function RetainedList({
  leagueId, departures, viewerIsOwner, onDecision, teamId,
}: {
  leagueId: string;
  departures: ClubProps['departures'];
  /** False on a rival's club: held rights are public (they're tradeable), the decisions on them are not. */
  viewerIsOwner: boolean;
  onDecision: (r: DecisionRequest) => void;
  teamId?: string;
}) {
  const { pending, held, slots, error } = departures;
  if (!error && pending.length === 0 && held.length === 0 && slots.total === 0) return null;
  // A rival with no held rights has nothing to say here — the empty state below
  // is written to the owner ("No retained players yet…") and slot usage alone
  // isn't worth a panel.
  if (!viewerIsOwner && held.length === 0) return null;

  return (
    <section className={`${styles.panel} ${styles.retained}`}>
      <div className={styles.panelHead}>
        <h2 className={styles.panelTitle}>Retained List</h2>
        <span className={styles.eyebrow}>{slots.used} / {slots.total} slots</span>
      </div>

      {error && viewerIsOwner && (
        <div className={styles.retError}>
          Couldn’t load your retained rights right now — this list may be incomplete. Try refreshing.
        </div>
      )}

      {pending.length > 0 && (
        <div className={styles.retGroup}>
          <div className={styles.retGroupH}>Awaiting your decision</div>
          {pending.map((d) => <PendingRow key={d.id} d={d} onDecision={onDecision} />)}
        </div>
      )}

      {held.length > 0 ? (
        <div className={styles.retGroup}>
          {pending.length > 0 && <div className={styles.retGroupH}>Held rights</div>}
          {held.map((d) => (
            <HeldRow
              key={d.id}
              leagueId={leagueId}
              d={d}
              viewerIsOwner={viewerIsOwner}
              teamId={teamId}
              onDecision={onDecision}
            />
          ))}
        </div>
      ) : pending.length === 0 ? (
        <p className={styles.retEmpty}>
          No retained players yet. When one of your players leaves the Premier League you can keep his
          rights here instead of taking the cash — he reverts to you free if he ever returns.
        </p>
      ) : null}

      <div className={styles.retFoot}>
        {viewerIsOwner
          ? 'Rights never expire and can’t be cashed out — relinquish one to free its slot. They’re tradeable from the Transfer Market’s Deals page.'
          : 'Rights never expire and can’t be cashed out, but they can be traded — make an offer from the Deals page.'}
      </div>
    </section>
  );
}

function Mono({ d }: { d: DepartureView }) {
  const c = posColor(d.pos);
  return (
    <div className={`${styles.mono} ${styles.monoSm}`} style={{ background: `color-mix(in srgb, ${c} 16%, transparent)`, color: c }}>
      {playerInitial({ name: d.name, web_name: d.webName })}
    </div>
  );
}

function PendingRow({ d, onDecision }: { d: DepartureView; onDecision: (r: DecisionRequest) => void }) {
  const when = countdown(d.decideBy);
  return (
    <div className={styles.retRow}>
      <Mono d={d} />
      <div className={styles.retBody}>
        <div className={styles.retName}>{getPlayerDisplayName({ name: d.name, web_name: d.webName }, 'initial_last')}</div>
        <div className={styles.retMeta}>
          <PosBadge pos={d.pos} />
          <span>ex-{d.lastClub} · left {fmtSeason(d.seasonFrom)}</span>
        </div>
      </div>
      <div className={styles.retFig}>
        <div className={styles.retFigV}>{when ? `${when} left` : 'Due now'}</div>
        <div className={styles.retFigK}>to decide</div>
      </div>
      <div className={styles.retActions}>
        <button type="button" className={`${styles.retBtn} ${styles.retBtnPrimary}`} onClick={() => onDecision({ mode: 'decide', dep: d })}>Decide</button>
      </div>
    </div>
  );
}

function HeldRow({
  leagueId, d, viewerIsOwner, teamId, onDecision,
}: {
  leagueId: string;
  d: DepartureView;
  viewerIsOwner: boolean;
  teamId?: string;
  onDecision: (r: DecisionRequest) => void;
}) {
  const returning = d.status === 'return_pending';
  return (
    <div className={`${styles.retRow} ${returning ? styles.retReturning : ''}`}>
      <Mono d={d} />
      <div className={styles.retBody}>
        <div className={styles.retName}>{getPlayerDisplayName({ name: d.name, web_name: d.webName }, 'initial_last')}</div>
        <div className={styles.retMeta}>
          <PosBadge pos={d.pos} />
          <span>{returning ? `Back with ${d.backClub ?? 'a PL club'}` : `ex-${d.lastClub} · left ${fmtSeason(d.seasonFrom)}`}</span>
        </div>
      </div>

      {returning ? (
        <>
          <span className={styles.retReturned}>Returned</span>
          {viewerIsOwner && (
            <div className={styles.retActions}>
              <button type="button" className={`${styles.retBtn} ${styles.retBtnPrimary}`} onClick={() => onDecision({ mode: 'reinstate', dep: d })}>Reinstate</button>
            </div>
          )}
        </>
      ) : (
        <>
          <div className={styles.retFig}>
            <div className={styles.retFigV}>{money(d.marketValue)}</div>
            <div className={styles.retFigK}>value at departure</div>
          </div>
          <div className={styles.retActions}>
            {viewerIsOwner ? (
              <>
                <NavigationLink href={`/league/${leagueId}/transfers/deals?proposeRight=${d.id}`} className={styles.retBtn}>Trade</NavigationLink>
                <button type="button" className={`${styles.retBtn} ${styles.retBtnDanger}`} onClick={() => onDecision({ mode: 'relinquish', dep: d })}>Relinquish</button>
              </>
            ) : (
              <NavigationLink
                href={`/league/${leagueId}/transfers/deals?proposeTeam=${teamId ?? ''}`}
                className={styles.retBtn}
              >
                Offer
              </NavigationLink>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function fmtSeason(s: string): string {
  return (s ?? '').replace('-', '/');
}
