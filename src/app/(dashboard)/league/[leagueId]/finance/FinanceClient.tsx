'use client';

import { useState, useMemo } from 'react';
import { getPlayerDisplayName } from '@/lib/players/displayName';
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
  netCreated: number;
  netDestroyed: number;
  transactions: Transaction[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

// Maps each tx type to its Club Balance direction and category label
const TX_META: Record<string, { direction: 'in' | 'out' | 'none'; label: string; category: string }> = {
  waiver_claim:         { direction: 'out', label: 'AUCTION WIN',      category: 'Signings'    },
  free_agent_pickup:    { direction: 'none', label: 'FREE SIGNING',    category: 'Signings'    },
  drop:                 { direction: 'out', label: 'RELEASED',         category: 'Drops'       },
  trade:                { direction: 'none', label: 'TRADE',           category: 'Trades'      },
  transfer_out:         { direction: 'in',  label: 'TRANSFER OUT',     category: 'Transfers'   },
  transfer_compensation:{ direction: 'in',  label: 'COMPENSATION',     category: 'Transfers'   },
  rebate:               { direction: 'in',  label: "SCOUT'S FEE",      category: 'Recirculation' },
  draft_pick:           { direction: 'none', label: 'DRAFT PICK',      category: 'Draft'       },
  prize_payout:         { direction: 'in',  label: 'PRIZE',            category: 'Prizes'      },
  merit_payment:        { direction: 'in',  label: 'TV & MATCHDAY',    category: 'Revenue'     },
  solidarity_payment:   { direction: 'in',  label: 'SOLIDARITY',       category: 'Recirculation' },
  sale_proceeds:        { direction: 'in',  label: 'SALE PROCEEDS',    category: 'Sales'       },
  loan_fee:             { direction: 'in',  label: 'LOAN FEE',         category: 'Loans'       },
  loan_bonus:           { direction: 'out', label: 'LOAN BONUS',       category: 'Loans'       },
  loan_recall_penalty:  { direction: 'out', label: 'RECALL PENALTY',   category: 'Loans'       },
  loan_slot_buyback:    { direction: 'out', label: 'SLOT BUYBACK',     category: 'Loans'       },
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

/* A category-per-hue bar chart cannot exist under the colour law: ten real
   categories (Signings, Drops, Trades, Transfers, Recirculation, Draft,
   Prizes, Revenue, Sales, Loans) is twice what the Wire's five event kinds
   already found no room for, and the old CAT_COLORS map only ever covered
   seven of them — Recirculation, Revenue, Sales and Loans silently fell
   through to plain muted grey, a real (if quiet) bug.

   The category name is already the row's label, so colour was never doing
   identity work here — it can carry something more useful instead: each
   row's OWN spent/earned split, the split every other figure on this page
   already colours (the summary strip, the ledger's amount chips). A row's
   overall length still compares magnitude across categories; the two
   segments inside it now show composition. Recessed on `.g-track`, the same
   primitive the baseline rule and the margin axis lay their own ink over. */
function BreakdownBar({ breakdown, max }: { breakdown: BreakdownData; max: number }) {
  const categories = Object.entries(breakdown.byCategory)
    .filter(([, v]) => v.spent > 0 || v.earned > 0)
    .sort((a, b) => (b[1].spent + b[1].earned) - (a[1].spent + a[1].earned));

  if (max === 0) return null;

  return (
    <div className={styles.breakdown}>
      {categories.map(([cat, vals]) => {
        const total = vals.spent + vals.earned;
        const rowWidth = Math.max(2, (total / max) * 100);
        const spentPct = total > 0 ? (vals.spent / total) * 100 : 0;
        return (
          <div key={cat} className={styles.breakdownRow}>
            <span className={styles.breakdownLabel}>{cat}</span>
            <div className={`g-track ${styles.breakdownTrack}`}>
              <div className={styles.breakdownBar} style={{ width: `${rowWidth}%` }}>
                {vals.spent > 0 && (
                  <div className={styles.breakdownFillOut} style={{ width: `${spentPct}%` }} />
                )}
                {vals.earned > 0 && (
                  <div className={styles.breakdownFillIn} style={{ width: `${100 - spentPct}%` }} />
                )}
              </div>
            </div>
            <span className={styles.breakdownAmount}>
              {vals.spent > 0 && <span className={styles.breakdownOut}>-€{vals.spent}</span>}
              {vals.earned > 0 && <span className={styles.breakdownIn}>+€{vals.earned}</span>}
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
  const playerName = tx.player ? getPlayerDisplayName(tx.player, 'initial_last') : null;

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
            €{amount}m
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
  leagueName,
  season,
  teamName,
  currentBudget,
  startingBudget,
  netCreated,
  netDestroyed,
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
    <div className={`${styles.page} g-page`}>
      {/* ── Masthead ── */}
      <header className={styles.masthead}>
        <span className={`g-label ${styles.kicker}`}>{leagueName} · Season {season?.replace('-', '/') ?? season}</span>
        <h1 className={styles.title}>Finance Ledger</h1>
        <p className={styles.subtitle}>{teamName} — full transaction history</p>
      </header>

      {/* One panel: the summary, the category breakdown and the ledger are
          all arithmetic on the same transaction list, not three surfaces. */}
      <div className={`g-panel ${styles.panel}`}>

        {/* ── Summary strip ── */}
        <div className={styles.summaryStrip}>
          <div className={styles.summaryCard}>
            <span className="g-label-quiet">Current budget</span>
            <span className={styles.summaryValue}>€{currentBudget}m</span>
          </div>
          <div className={styles.summaryCard}>
            <span className="g-label-quiet">Total spent</span>
            <span className={`${styles.summaryValue} ${styles.summaryOut}`}>-€{breakdown.totalSpent}m</span>
          </div>
          <div className={styles.summaryCard}>
            <span className="g-label-quiet">Total earned</span>
            <span className={`${styles.summaryValue} ${styles.summaryIn}`}>+€{breakdown.totalEarned}m</span>
          </div>
          <div className={styles.summaryCard}>
            <span className="g-label-quiet">Net change</span>
            <span className={`${styles.summaryValue} ${netPositive ? styles.summaryIn : styles.summaryOut}`}>
              {netPositive ? '+' : ''}€{net}m
            </span>
          </div>
          <div className={styles.summaryCard}>
            <span className="g-label-quiet">Money created</span>
            <span className={`${styles.summaryValue} ${styles.summaryIn}`}>€{netCreated}m</span>
          </div>
          <div className={styles.summaryCard}>
            <span className="g-label-quiet">Money destroyed</span>
            <span className={`${styles.summaryValue} ${styles.summaryOut}`}>€{netDestroyed}m</span>
          </div>
        </div>

        {/* ── Breakdown bar chart ── */}
        {Object.keys(breakdown.byCategory).length > 0 && (
          <section className={styles.section}>
            <h2 className={styles.sectionHead}>Spending Breakdown</h2>
            <BreakdownBar breakdown={breakdown} max={maxCategoryTotal} />
          </section>
        )}

        {/* ── Transaction ledger ── */}
        <section className={styles.section}>
          <div className={styles.ledgerHeader}>
            <h2 className={styles.sectionHead}>Club Ledger</h2>
            {/* Filter tabs — same segmented-control grammar as the stats
                pool's position filter: filled in ink, not the accent, since
                this is a view toggle rather than "yours". */}
            <div className={styles.segmented} role="tablist">
              {(['all', 'out', 'in'] as FilterKey[]).map(f => (
                <button
                  key={f}
                  role="tab"
                  aria-selected={filter === f}
                  className={`${styles.segment} ${filter === f ? styles.segmentOn : ''}`}
                  onClick={() => { setFilter(f); setPage(0); }}
                  type="button"
                >
                  {f === 'all' ? 'All' : f === 'out' ? 'Spending' : 'Earnings'}
                </button>
              ))}
            </div>
          </div>

          {filtered.length === 0 ? (
            <p className={styles.emptyText}>No transactions found.</p>
          ) : (
            <>
              <div className={styles.ledgerTableWrap}>
                <table className={styles.ledgerTable}>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Type</th>
                      <th>Player / notes</th>
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
    </div>
  );
}
