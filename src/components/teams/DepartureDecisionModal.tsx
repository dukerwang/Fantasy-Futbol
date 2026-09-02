'use client';

/**
 * Shared modal for the manager's actions on a departure decision.
 * Standalone (no My-Club coupling) so the offseason batch flow can mount it too.
 * POSTs to /api/leagues/[leagueId]/departures/[decisionId] then calls onDone.
 */

import { useState } from 'react';
import { getPlayerDisplayName, playerInitial } from '@/lib/players/displayName';
import styles from './DepartureDecisionModal.module.css';

export interface DepartureLike {
  id: string;
  status: string;
  name: string;
  webName: string;
  pos: string;
  lastClub: string;
  backClub: string | null;
  seasonFrom: string;
  marketValue: number;
  compensation: number;
  decideBy: string | null;
  reinstateBy: string | null;
}

export interface DecisionRequest {
  mode: 'decide' | 'reinstate' | 'relinquish';
  dep: DepartureLike;
}

interface Props {
  req: DecisionRequest;
  leagueId: string;
  slots: { used: number; total: number; remaining: number };
  rosterCount: number;
  rosterMax: number;
  onClose: () => void;
  onDone: () => void;
}

const POS_VAR: Record<string, string> = {
  GK: '--color-pos-gk', CB: '--color-pos-cb', LB: '--color-pos-fb', RB: '--color-pos-fb',
  LWB: '--color-pos-wb', RWB: '--color-pos-wb', DM: '--color-pos-dm', CM: '--color-pos-cm',
  AM: '--color-pos-am', LW: '--color-pos-lw', RW: '--color-pos-rw', ST: '--color-pos-st',
};
const posColor = (p: string) => `var(${POS_VAR[p] || '--color-text-muted'})`;
const money = (n: number) => `€${Math.round(n).toLocaleString('en-GB')}m`;
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}€${Math.abs(Math.round(n)).toLocaleString('en-GB')}m`;

function countdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
}

export default function DepartureDecisionModal({ req, leagueId, slots, rosterCount, rosterMax, onClose, onDone }: Props) {
  const { mode, dep } = req;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const roomAvail = rosterCount < rosterMax;

  async function act(action: 'release' | 'retain' | 'reinstate' | 'relinquish' | 'decline') {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/departures/${dep.id}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); setErr(d.error ?? 'Action failed'); return; }
      onDone();
    } catch {
      setErr('Network error — please try again.');
    } finally {
      setBusy(false);
    }
  }

  const sub = mode === 'reinstate'
    ? `Back in the Premier League with ${dep.backClub ?? 'a PL club'}`
    : `Left the Premier League · ex-${dep.lastClub}`;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.card} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        <div className={styles.head}>
          <div className={styles.mono} style={{ background: `color-mix(in srgb, ${posColor(dep.pos)} 16%, transparent)`, color: posColor(dep.pos) }}>
            {playerInitial({ name: dep.name, web_name: dep.webName })}
          </div>
          <div className={styles.headBody}>
            <div className={styles.name}>{getPlayerDisplayName({ name: dep.name, web_name: dep.webName }, 'full')}</div>
            <div className={styles.subline}>
              <span className={styles.posbadge} style={{ background: posColor(dep.pos) }}>{dep.pos}</span>
              <span>{sub}</span>
            </div>
          </div>
          <button type="button" className={styles.close} onClick={onClose} aria-label="Close">×</button>
        </div>

        {err && <div className={styles.err}>{err}</div>}

        {mode === 'decide' && (
          <>
            <div className={styles.deadline}>
              Decide within <b>{countdown(dep.decideBy) ?? 'the window'}</b> — unresolved, he is released automatically.
            </div>
            <div className={styles.options}>
              <button type="button" className={styles.opt} disabled={busy} onClick={() => act('release')}>
                <div className={styles.optTitle}>Release</div>
                <div className={`${styles.optFig} ${styles.gain}`}>{signed(dep.compensation)}</div>
                <ul className={styles.optList}>
                  <li>Compensation for {money(dep.marketValue)} market value</li>
                  <li>Auctioned if and when he returns to the Premier League</li>
                  <li className={styles.warn}>You can’t bid on his return</li>
                </ul>
              </button>
              <button type="button" className={styles.opt} disabled={busy || slots.remaining <= 0} onClick={() => act('retain')}>
                <div className={styles.optTitle}>Retain rights</div>
                <div className={`${styles.optFig} ${styles.forfeit}`}>Forfeit {money(dep.compensation)}</div>
                <ul className={styles.optList}>
                  <li>Reverts to you free if he returns</li>
                  {slots.remaining > 0 ? (
                    <li>Uses 1 of {slots.total} slots · {slots.remaining} left</li>
                  ) : (
                    <li className={styles.warn}>No retained slots left — relinquish one first</li>
                  )}
                  <li>Tradeable · never expires</li>
                </ul>
              </button>
            </div>
          </>
        )}

        {mode === 'reinstate' && (
          <>
            <div className={styles.deadline}>
              Reinstate within <b>{countdown(dep.reinstateBy) ?? 'the window'}</b> — unresolved, the claim lapses and he is auctioned.
            </div>
            <div className={styles.body}>
              <p className={styles.lead}>He is back in the Premier League. Reinstate him to your roster free — no auction, no fee — and the retained slot frees.</p>
              <div className={styles.room}>
                {roomAvail
                  ? <span>Roster <b>{rosterCount} / {rosterMax}</b> — room available, no drop needed.</span>
                  : <span>Roster <b>full ({rosterCount}/{rosterMax})</b> — free a place first, then reinstate.</span>}
              </div>
            </div>
            <div className={styles.foot}>
              <button type="button" className={`${styles.btn} ${styles.btnPrimary}`} disabled={busy || !roomAvail} onClick={() => act('reinstate')}>Reinstate to roster</button>
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={busy} onClick={() => act('decline')}>Decline</button>
            </div>
          </>
        )}

        {mode === 'relinquish' && (
          <>
            <div className={styles.body}>
              <p className={styles.lead}>
                Give up your rights to <b>{dep.name}</b>? This frees a retained slot immediately. Rights can’t be
                cashed out — you receive nothing, and if he later returns to the PL he’ll be a free agent the whole
                league can bid on.
              </p>
            </div>
            <div className={styles.foot}>
              <button type="button" className={styles.btn} disabled={busy} onClick={onClose}>Keep rights</button>
              <button type="button" className={`${styles.btn} ${styles.btnDanger} ${styles.btnGrow}`} disabled={busy} onClick={() => act('relinquish')}>Relinquish for nothing</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
