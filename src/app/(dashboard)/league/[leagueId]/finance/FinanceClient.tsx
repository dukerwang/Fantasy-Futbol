'use client';

import { useState, useMemo } from 'react';
import { formatPlayerName } from '@/lib/formatName';
import styles from './finance.module.css';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Player {
  id: string;
  name: string;
  web_name: string | null;
  primary_position: string;
  pl_team: string | null;
}

interface Transaction {
  id: string;
  type: string;
  faab_bid: number | null;
  compensation_amount: string | null;
  notes: string | null;
  processed_at: string;
  player: Player | null;
}

interface Props {
  leagueId: string;
  leagueName: string;
  season: string;
  teamName: string;
  currentBudget: number;
  startingBudget: number;
  transactions: Transaction[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Maps each tx type to its FAAB direction and category label
const TX_META: Record<string, { direction: 'in' | 'out' | 'none'; label: string; category: string }> = {
  waiver_claim:         { direction: 'out', label: 'AUCTION WIN',      category: 'Signings'    },
  free_agent_pickup:    { direction: 'none', label: 'FREE SIGNING',    category: 'Signings'    },
  drop:                 { direction: 'out', label: 'RELEASED',         category: 'Drops'       },
  trade:                { direction: 'none', label: 'TRADE',           category: 'Trades'      },
  transfer_out:         { direction: 'in',  label: 'TRANSFER OUT',     category: 'Transfers'   },
  transfer_compensation:{ direction: 'in',  label: 'COMPENSATION',     category: 'Transfers'   },
  rebate:               { direction: 'in',  label: "SCOUT'S REBATE",   category: 'Rebates'     },
  draft_pick:           { direction: 'none', label: 'DRAFT PICK',      category: 'Draft'       },
  prize_payout:         { direction: 'in',  label: 'PRIZE',            category: 'Prizes'      },
};

type FilterKey = 'all' | 'out' | 'in';

const PAGE_SIZE = 25;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getAmount(tx: Transaction): number | null {
  const meta = TX_META[tx.type];
  if (!meta || meta.direction === 'none') return null;
  if (tx.faab_bid != null && tx.faab_bid > 0) return tx.faab_bid;
  if (tx.compensation_amount != null && Number(tx.compensation_amount) > 0)
    return Number(tx.compensation_amount);
  return null;
}

function getDirection(tx: Transaction): 'in' | 'out' | 'none' {
  return TX_META[tx.type]?.direction ?? 'none';
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

function formatShortDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
  });
}

// ─── SVG Icons ────────────────────────────────────────────────────────────────

function IconArrowUp() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="19" x2="12" y2="5" />
      <polyline points="5 12 12 5 19 12" />
    </svg>
  );
}

function IconArrowDown() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="12" y1="5" x2="12" y2="19" />
      <polyline points="19 12 12 19 5 12" />
    </svg>
  );
}

function IconMinus() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

// ─── Category Breakdown Bar ───────────────────────────────────────────────────

interface BreakdownData {
  totalSpent: number;
  totalEarned: number;
  byCategory: Record<string, { spent: number; earned: number }>;
}

function computeBreakdown(transactions: Transaction[]): BreakdownData {
  let totalSpent = 0;
  let totalEarned = 0;
  const byCategory: Record<string, { spent: number; earned: number }> = {};

  for (const tx of transactions) {
    const meta = TX_META[tx.type];
    if (!meta || meta.direction === 'none') continue;
    const amount = getAmount(tx);
    if (!amount) continue;
    const cat = meta.category;
    if (!byCategory[cat]) byCategory[cat] = { spent: 0, earned: 0 };
    if (meta.direction === 'out') {
      totalSpent += amount;
      byCategory[cat].spent += amount;
    } else {
      totalEarned += amount;
      byCategory[cat].earned += amount;
    }
  }
  return { totalSpent, totalEarned, byCategory };
}

function BreakdownBar({ breakdown, max }: { breakdown: BreakdownData; max: number }) {
  const categories = Object.entries(breakdown.byCategory)
    .filter(([, v]) => v.spent > 0 || v.earned > 0)
    .sort((a, b) => (b[1].spent + b[1].earned) - (a[1].spent + a[1].earned));

  const CAT_COLORS: Record<string, string> = {
    Signings:  'var(--color-accent-green)',
    Drops:     '#ef4444',
    Transfers: '#a855f7',
    Rebates:   '#f59e0b',
    Prizes:    '#3b82f6',
    Trades:    'var(--color-text-muted)',
    Draft:     '#6b7280',
  };

  if (max === 0) return null;

  return (
    <div className={styles.breakdown}>
      {categories.map(([cat, vals]) => {
        const total = vals.spent + vals.earned;
        const width = Math.max(2, (total / max) * 100);
        return (
          <div key={cat} className={styles.breakdownRow}>
            <span className={styles.breakdownLabel}>{cat}</span>
            <div className={styles.breakdownBarWrap}>
              <div
                className={styles.breakdownBarFill}
                style={{
                  width: `${width}%`,
                  backgroundColor: CAT_COLORS[cat] ?? 'var(--color-text-muted)',
                }}
              />
            </div>
            <span className={styles.breakdownAmount}>
              {vals.spent > 0 && <span className={styles.breakdownOut}>-£{vals.spent}</span>}
              {vals.earned > 0 && <span className={styles.breakdownIn}>+£{vals.earned}</span>}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ─── Ledger Row ───────────────────────────────────────────────────────────────

function LedgerRow({ tx }: { tx: Transaction }) {
  const meta = TX_META[tx.type] ?? { direction: 'none' as const, label: tx.type.toUpperCase().replace(/_/g, ' '), category: 'Other' };
  const amount = getAmount(tx);
  const dir = getDirection(tx);
  const playerName = tx.player ? formatPlayerName(tx.player, 'initial_last') : null;

  return (
    <tr className={styles.ledgerRow}>
      <td className={styles.ledgerDate}>{formatShortDate(tx.processed_at)}</td>
      <td className={styles.ledgerType}>
        <span className={`${styles.typePill} ${styles[`typePill_${dir}`]}`}>{meta.label}</span>
      </td>
      <td className={styles.ledgerPlayer}>
        {playerName ?? (tx.notes ? <span className={styles.ledgerNotes}>{tx.notes}</span> : <span className={styles.ledgerDash}>—</span>)}
      </td>
      <td className={styles.ledgerAmount}>
        {amount != null ? (
          <span className={`${styles.amountChip} ${dir === 'in' ? styles.amountIn : dir === 'out' ? styles.amountOut : styles.amountNone}`}>
            {dir === 'in' ? <IconArrowDown /> : dir === 'out' ? <IconArrowUp /> : <IconMinus />}
            £{amount}m
          </span>
        ) : (
          <span className={styles.ledgerDash}>—</span>
        )}
      </td>
    </tr>
  );
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function FinanceClient({
  leagueId,
  leagueName,
  season,
  teamName,
  currentBudget,
  startingBudget,
  transactions,
}: Props) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const [page, setPage] = useState(0);

  const breakdown = useMemo(() => computeBreakdown(transactions), [transactions]);
  const net = currentBudget - startingBudget;
  const netPositive = net >= 0;

  const filtered = useMemo(() => {
    if (filter === 'all') return transactions;
    return transactions.filter(tx => getDirection(tx) === filter);
  }, [transactions, filter]);

  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  const pageSlice = filtered.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

  const maxCategoryTotal = useMemo(() => {
    return Math.max(
      ...Object.values(breakdown.byCategory).map(v => v.spent + v.earned),
      1,
    );
  }, [breakdown]);

  return (
    <div className={styles.page}>
      {/* ── Header ── */}
      <header className={styles.header}>
        <div>
          <p className={styles.eyebrow}>{leagueName} · {season}</p>
          <h1 className={styles.title}>Finance Ledger</h1>
          <p className={styles.subtitle}>{teamName} — full FAAB transaction history</p>
        </div>
      </header>

      {/* ── Summary Strip ── */}
      <div className={styles.summaryStrip}>
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>CURRENT BUDGET</span>
          <span className={styles.summaryValue}>£{currentBudget}m</span>
        </div>
        <div className={styles.summaryDivider} />
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>TOTAL SPENT</span>
          <span className={`${styles.summaryValue} ${styles.summaryOut}`}>-£{breakdown.totalSpent}m</span>
        </div>
        <div className={styles.summaryDivider} />
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>TOTAL EARNED</span>
          <span className={`${styles.summaryValue} ${styles.summaryIn}`}>+£{breakdown.totalEarned}m</span>
        </div>
        <div className={styles.summaryDivider} />
        <div className={styles.summaryCard}>
          <span className={styles.summaryLabel}>NET CHANGE</span>
          <span className={`${styles.summaryValue} ${netPositive ? styles.summaryIn : styles.summaryOut}`}>
            {netPositive ? '+' : ''}£{net}m
          </span>
        </div>
      </div>

      {/* ── Breakdown Bar Chart ── */}
      {Object.keys(breakdown.byCategory).length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <span className={styles.sectionKicker}>BY CATEGORY</span>
            <h2 className={styles.sectionTitle}>Spending Breakdown</h2>
          </div>
          <BreakdownBar breakdown={breakdown} max={maxCategoryTotal} />
        </section>
      )}

      {/* ── Transaction Ledger ── */}
      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.sectionKicker}>ALL TRANSACTIONS</span>
            <h2 className={styles.sectionTitle}>FAAB Ledger</h2>
          </div>
          {/* Filter tabs */}
          <div className={styles.filterTabs} role="tablist">
            {(['all', 'out', 'in'] as FilterKey[]).map(f => (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                className={`${styles.filterTab} ${filter === f ? styles.filterTabActive : ''}`}
                onClick={() => { setFilter(f); setPage(0); }}
                type="button"
              >
                {f === 'all' ? 'All' : f === 'out' ? 'Spending' : 'Earnings'}
              </button>
            ))}
          </div>
        </div>

        {filtered.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyText}>No transactions found.</p>
          </div>
        ) : (
          <>
            <div className={styles.tableWrap}>
              <table className={styles.ledgerTable}>
                <thead className={styles.ledgerHead}>
                  <tr>
                    <th>Date</th>
                    <th>Type</th>
                    <th>Player / Notes</th>
                    <th className={styles.thRight}>Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {pageSlice.map(tx => (
                    <LedgerRow key={tx.id} tx={tx} />
                  ))}
                </tbody>
              </table>
            </div>

            {totalPages > 1 && (
              <div className={styles.pagination}>
                <button
                  className={styles.pageBtn}
                  onClick={() => setPage(p => Math.max(0, p - 1))}
                  disabled={page === 0}
                  type="button"
                >
                  ← Prev
                </button>
                <span className={styles.pageInfo}>
                  Page {page + 1} of {totalPages} · {filtered.length} transactions
                </span>
                <button
                  className={styles.pageBtn}
                  onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                  disabled={page >= totalPages - 1}
                  type="button"
                >
                  Next →
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
