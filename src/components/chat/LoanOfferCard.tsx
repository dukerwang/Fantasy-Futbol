'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import styles from './NegotiationCard.module.css';
import { formatNegotiationStatus } from './negotiationStatus';

export interface LoanSummary {
  id: string;
  status: string;
  lenderTeamId: string;
  lenderTeamName: string;
  borrowerTeamId: string;
  borrowerTeamName: string;
  playerId: string;
  playerName: string;
  loanFee: number;
  startGameweek: number;
  endGameweek: number;
  bonusRate: number;
  bonusCap: number;
  hasRecall: boolean;
  proposedBy: 'lender' | 'borrower';
  parentLoanId: string | null;
  message: string | null;
  createdAt: string;
}

const money = (n: number) => `€${n}m`;

/**
 * Live, interactive loan-proposal card for the chat DM thread. Previously
 * loan proposals wrote a `[SYSTEM:LOAN_PROPOSAL:{json}]` message that
 * ChatClient had no renderer for, so they showed up as raw JSON text — this
 * replaces that entirely, reading current state off `loan` (see
 * GET /api/chat) so it reflects accept/reject/counter made anywhere.
 */
export default function LoanOfferCard({
  loan,
  leagueId,
  currentTeamId,
  onActionComplete,
}: {
  loan: LoanSummary;
  leagueId: string;
  currentTeamId: string | null;
  onActionComplete?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lending = currentTeamId === loan.lenderTeamId;
  const proposerTeamId = loan.proposedBy === 'lender' ? loan.lenderTeamId : loan.borrowerTeamId;
  const responderTeamId = loan.proposedBy === 'lender' ? loan.borrowerTeamId : loan.lenderTeamId;
  const iAmProposer = currentTeamId === proposerTeamId;
  const incoming = currentTeamId === responderTeamId;
  const other = lending ? loan.borrowerTeamName : loan.lenderTeamName;

  const act = async (action: 'accept' | 'reject' | 'cancel') => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/leagues/${leagueId}/loans/${loan.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? 'That could not be completed.');
      } else {
        onActionComplete?.();
      }
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const counter = () => {
    window.dispatchEvent(new Event('navigation-start'));
    router.push(`/league/${leagueId}/transfers/deals?counter=loan:${loan.id}`);
  };

  const isPending = loan.status === 'pending';
  const title = loan.parentLoanId
    ? (incoming ? `${other} countered you` : `You countered ${other}`)
    : `${loan.playerName} ${lending ? '→' : '←'} ${other}`;

  return (
    <article className={`${styles.card} ${isPending && incoming ? styles.cardActive : ''}`}>
      <header className={styles.head}>
        <span className={styles.title}>{title}</span>
        <span className={styles.tag} style={{ background: 'var(--color-pos-wb)' }}>
          Loan · GW{loan.startGameweek}–{loan.endGameweek}
        </span>
      </header>

      <div className={styles.sides}>
        <div className={styles.side}>
          <div className={styles.label}>{lending ? 'Fee you receive' : 'Fee you pay'}</div>
          <div className={styles.cash}>{money(Number(loan.loanFee) || 0)}</div>
        </div>
        <div className={styles.swap} aria-hidden="true">⇄</div>
        <div className={`${styles.side} ${styles.sideRight}`}>
          <div className={styles.label}>Points bonus</div>
          <div className={styles.cash}>
            {Number(loan.bonusRate) > 0 ? `€${Number(loan.bonusRate).toFixed(3)}m / pt` : 'None'}
            {Number(loan.bonusCap) > 0 && <span className={styles.cap}> · cap {money(Number(loan.bonusCap))}</span>}
          </div>
        </div>
      </div>

      {loan.message && <p className={styles.note}>&ldquo;{loan.message}&rdquo;</p>}
      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.actions}>
        {isPending && incoming ? (
          <>
            <button type="button" className={`${styles.btn} ${styles.btnYes}`} disabled={busy} onClick={() => act('accept')}>Accept</button>
            <button type="button" className={styles.btn} disabled={busy} onClick={counter}>Counter</button>
            <button type="button" className={styles.btn} disabled={busy} onClick={() => act('reject')}>Decline</button>
          </>
        ) : isPending && iAmProposer ? (
          <button type="button" className={styles.btn} disabled={busy} onClick={() => act('cancel')}>Withdraw</button>
        ) : (
          <span className={styles.status}>{formatNegotiationStatus(loan.status)}</span>
        )}
      </div>
    </article>
  );
}
