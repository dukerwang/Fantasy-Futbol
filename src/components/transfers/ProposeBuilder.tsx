'use client';

import { useMemo, useState } from 'react';
import type { CrestConfig } from '@/components/crest/types';
import type { GranularPosition } from '@/types';
import type {
  RosterPlayer,
  TransfersListing,
  TransfersModel,
  TransfersRight,
  TransfersTeam,
} from '@/lib/transfers/buildTransfersModel';
import CrestBadge from '@/components/crest/CrestBadge';
import SquadPeekButton from '@/components/teams/SquadPeekButton';
import PositionBadge from '@/components/players/PositionBadge';
import { usePlayerCard, playerHoverProps } from '@/components/players/PlayerCardProvider';
import Modal from './Modal';
import GwRangeSlider from './GwRangeSlider';
import styles from './ProposeBuilder.module.css';
import { getPlayerDisplayName } from '@/lib/players/displayName';
import { describeDeal } from '@/lib/transfers/describeDeal';
import { listingStance } from '@/lib/transfers/listingStance';

/**
 * One builder for both deal types.
 *
 *   Offer  players and/or cash   ⇄   players and/or cash
 *   Loan   one player plus a contract (a stacked sheet, not a two-sided table)
 *
 * "Trade" and "Offer to buy" used to be separate modes, which was a fiction:
 * buy was trade with `offeredPlayerIds` forced empty and `requestedFaab` forced
 * to zero, hitting the same endpoint and the same table. Worse, it made the
 * manager pick a category before knowing what they wanted to put up, and
 * switching category wiped their selections. Now both sides simply hold players
 * and cash, and what the deal is CALLED is read off the payload afterwards by
 * `describeDeal` — a cash-for-one-player offer is a bid because of its shape,
 * not because anybody said so.
 *
 * It works on ANY player in the league. A listing is an advertisement, never
 * the only route in — `listing` merely pre-selects the counterparty and player
 * and lets the offer be tied to the listing so accepting it closes the auction
 * in the same transaction.
 *
 * Loan mode has its own sub-direction (`loanDirection`): "lend" proposes
 * loaning one of MY players out (`requestMode: false`, I set the terms as
 * lender); "borrow" requests a loan of one of THEIR players in
 * (`requestMode: true`, matching what `POST /loans` calls the borrower's
 * side). Both share the same fee-template math: a PPG-based base fee, three
 * templates (Fixed / Balanced / Performance-heavy) trading upfront fee for a
 * capped per-point bonus, and a ±20% adjustment on top.
 */

export type ProposeMode = 'offer' | 'loan';
export type LoanDirection = 'lend' | 'borrow';

interface Props {
  open: boolean;
  onClose: () => void;
  leagueId: string;
  model: TransfersModel;
  initialMode: ProposeMode;
  /** Pre-selects the counterparty. */
  initialTeamId?: string | null;
  /** Pre-selects the player being asked for, and ties an offer to its listing. */
  initialListing?: TransfersListing | null;
  initialPlayerId?: string | null;
  /** Pre-selects a retained right of mine to offer — the entry point from the Retained List. */
  initialGiveRightId?: string | null;
  /** Which side of a loan this session starts on. Defaults to "borrow" — the
   *  listing-triggered "Loan" quick action always requests the listed player in. */
  initialLoanDirection?: LoanDirection;
  /**
   * Countering a trade/listing offer: the full asset table pre-filled as a
   * mirror of the proposal being countered ("same deal, now I'm proposing
   * it"), so the composer opens ready to tweak rather than empty. When set,
   * these override `initialPlayerId`/`initialGiveRightId` above.
   */
  initialGiveIds?: string[];
  initialWantIds?: string[];
  initialGiveRightIds?: string[];
  initialWantRightIds?: string[];
  initialMyCash?: number;
  initialTheirCash?: number;
  /** Countering a loan: the original schedule/recall clause carried over as a
   *  starting point — the fee/bonus stay template-derived, same as any fresh
   *  loan proposal, since there's no raw fee field to restore verbatim. */
  initialStartGw?: number;
  initialEndGw?: number;
  initialHasRecall?: boolean;
  /** Set when this session is a counter-offer — rejects the parent proposal
   *  on send and chains this one to it (trade_proposals.parent_trade_id /
   *  player_loans.parent_loan_id). */
  parentTradeId?: string | null;
  parentLoanId?: string | null;
  onDone: () => void;
}

const money = (n: number) => `€${n}m`;

const MODES: { key: ProposeMode; label: string }[] = [
  { key: 'offer', label: 'Offer' },
  { key: 'loan', label: 'Loan' },
];

const LOAN_MIN_DURATION = 4;
const LOAN_MAX_DURATION = 16;
const NOT_LOANABLE_STATUSES = new Set(['ir', 'taxi', 'loan_in', 'loan_out']);

export default function ProposeBuilder({
  open,
  onClose,
  leagueId,
  model,
  initialMode,
  initialTeamId,
  initialListing,
  initialPlayerId,
  initialGiveRightId,
  initialLoanDirection,
  initialGiveIds,
  initialWantIds,
  initialGiveRightIds,
  initialWantRightIds,
  initialMyCash,
  initialTheirCash,
  initialStartGw,
  initialEndGw,
  initialHasRecall,
  parentTradeId,
  parentLoanId,
  onDone,
}: Props) {
  const others = useMemo(
    () => model.allTeams.filter((t) => t.id !== model.myTeam.id),
    [model.allTeams, model.myTeam.id],
  );

  const { openPlayerById, prefetchPlayer } = usePlayerCard();

  const [mode, setMode] = useState<ProposeMode>(initialMode);
  const [targetId, setTargetId] = useState<string>(initialTeamId ?? others[0]?.id ?? '');
  const [give, setGive] = useState<string[]>(initialGiveIds ?? []);
  const [want, setWant] = useState<string[]>(initialWantIds ?? (initialPlayerId ? [initialPlayerId] : []));
  const [giveRights, setGiveRights] = useState<string[]>(initialGiveRightIds ?? (initialGiveRightId ? [initialGiveRightId] : []));
  const [wantRights, setWantRights] = useState<string[]>(initialWantRightIds ?? []);
  const [myCash, setMyCash] = useState(initialMyCash ?? 0);
  const [theirCash, setTheirCash] = useState(initialTheirCash ?? 0);
  const [message, setMessage] = useState('');

  // Each side of an offer starts EMPTY and is built up. Showing both squads in
  // full made the table look identical whether you had put up eleven players or
  // none, and buried what the deal actually was under forty rows you were not
  // proposing. `picking` names which side's picker is open; the cash flags let a
  // cash line exist at zero while it is being typed into.
  const [picking, setPicking] = useState<'mine' | 'theirs' | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const [myCashOpen, setMyCashOpen] = useState(false);
  const [theirCashOpen, setTheirCashOpen] = useState(false);

  // Loan terms.
  const gwNow = model.currentGameweek;
  const [loanDirection, setLoanDirection] = useState<LoanDirection>(initialLoanDirection ?? 'borrow');
  const [startGw, setStartGw] = useState(initialStartGw ?? gwNow + 1);
  const [endGw, setEndGw] = useState(initialEndGw ?? gwNow + 7);
  const [loanTemplate, setLoanTemplate] = useState<'fixed' | 'balanced' | 'performance'>('balanced');
  const [loanAdjust, setLoanAdjust] = useState(0); // -0.20 .. +0.20
  const [hasRecall, setHasRecall] = useState(initialHasRecall ?? true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Re-seed when reopened for a different starting point.
  const seedKey = `${initialMode}:${initialTeamId ?? ''}:${initialPlayerId ?? ''}:${initialGiveRightId ?? ''}:${initialLoanDirection ?? ''}:${parentTradeId ?? ''}:${parentLoanId ?? ''}:${open}`;
  const [seed, setSeed] = useState(seedKey);
  if (seed !== seedKey) {
    setSeed(seedKey);
    setMode(initialMode);
    setTargetId(initialTeamId ?? others[0]?.id ?? '');
    setGive(initialGiveIds ?? []);
    setWant(initialWantIds ?? (initialPlayerId ? [initialPlayerId] : []));
    setGiveRights(initialGiveRightIds ?? (initialGiveRightId ? [initialGiveRightId] : []));
    setWantRights(initialWantRightIds ?? []);
    setMyCash(initialMyCash ?? 0);
    setTheirCash(initialTheirCash ?? 0);
    setMessage('');
    setPicking(null);
    setPickQuery('');
    setMyCashOpen(false);
    setTheirCashOpen(false);
    setLoanDirection(initialLoanDirection ?? 'borrow');
    setStartGw(initialStartGw ?? gwNow + 1);
    setEndGw(initialEndGw ?? gwNow + 7);
    setLoanTemplate('balanced');
    setLoanAdjust(0);
    setHasRecall(initialHasRecall ?? true);
    setError(null);
  }

  const target: TransfersTeam | undefined = others.find((t) => t.id === targetId);
  const myRoster = model.myRoster;

  // Memoised because of the `?? []`: an unrostered team id would otherwise mint
  // a fresh array every render, and `byId` below depends on this identity.
  const theirRoster = useMemo(
    () => model.allRosters[targetId] ?? [],
    [model.allRosters, targetId],
  );
  const myRights = model.myRights;
  // Same memoisation reasoning as theirRoster.
  const theirRights = useMemo(
    () => model.rightsByTeam[targetId] ?? [],
    [model.rightsByTeam, targetId],
  );

  const byId = useMemo(() => {
    const m = new Map<string, RosterPlayer>();
    for (const r of [...myRoster, ...theirRoster]) m.set(r.id, r);
    return m;
  }, [myRoster, theirRoster]);

  const rightById = useMemo(() => {
    const m = new Map<string, TransfersRight>();
    for (const r of [...myRights, ...theirRights]) m.set(r.id, r);
    return m;
  }, [myRights, theirRights]);

  const toggle = (list: string[], set: (v: string[]) => void, id: string, single: boolean) => {
    if (list.includes(id)) set(list.filter((x) => x !== id));
    else set(single ? [id] : [...list, id]);
  };

  const duration = endGw - startGw;
  const lastLoanStart = (model.league.total_gameweeks ?? 38) - 8;

  // The player named by `want` — my own roster when I'm lending, theirs when
  // I'm asking to borrow. `byId` covers both, so this works either way.
  const loanPlayer = mode === 'loan' ? byId.get(want[0] ?? '') : undefined;

  // Loan-outs/loan-ins already running, so the slot counters below match what
  // Deals shows without needing another prop threaded through every caller.
  const loanOutsRunning = model.loans.filter(
    (l) => ['active', 'accepted_deferred', 'pending_activation'].includes(l.status) && l.lender_team_id === model.myTeam.id,
  ).length;
  const loanInsRunning = model.loans.filter(
    (l) => ['active', 'accepted_deferred', 'pending_activation'].includes(l.status) && l.borrower_team_id === model.myTeam.id,
  ).length;
  const loanOutsRemaining = (model.league.max_loan_outs ?? 1) - loanOutsRunning;
  const loanInsRemaining = (model.league.max_loan_ins ?? 2) - loanInsRunning;

  // ── Loan fee math ──────────────────────────────────────────────
  // recentPPG floored at 3; base fee = 0.5 × √recentPPG × loan weeks. Three
  // templates trade upfront fee for a capped per-point bonus; a ±20% slider
  // adjusts whichever template is selected.
  const recentPPG = useMemo(() => {
    if (!loanPlayer) return 3.0;
    return Math.max(3.0, loanPlayer.recent_ppg ?? loanPlayer.ppg ?? 3.0);
  }, [loanPlayer]);

  const baseFee = useMemo(() => {
    if (!loanPlayer) return 0;
    return Math.round(0.5 * Math.sqrt(recentPPG) * duration);
  }, [loanPlayer, recentPPG, duration]);

  const loanTemplateTerms = useMemo(() => {
    if (!loanPlayer) {
      return {
        fixed: { fee: 0, rate: 0, cap: 0 },
        balanced: { fee: 0, rate: 0, cap: 0 },
        performance: { fee: 0, rate: 0, cap: 0 },
      };
    }
    const fixedFee = baseFee;
    const balancedFee = baseFee * 0.55;
    const balancedRate = (baseFee * 0.45) / (recentPPG * duration);
    const balancedCap = 2 * (baseFee - balancedFee);
    const perfFee = baseFee * 0.20;
    const perfRate = (baseFee * 0.90) / (recentPPG * duration);
    const perfCap = 2 * (baseFee - perfFee);
    return {
      fixed: { fee: fixedFee, rate: 0, cap: 0 },
      balanced: { fee: balancedFee, rate: balancedRate, cap: balancedCap },
      performance: { fee: perfFee, rate: perfRate, cap: perfCap },
    };
  }, [loanPlayer, baseFee, recentPPG, duration]);

  const { balancedMaxPpg, balancedHeadroom, perfMaxPpg, perfHeadroom } = useMemo(() => {
    const bMax = loanTemplateTerms.balanced.rate > 0
      ? (loanTemplateTerms.balanced.cap / loanTemplateTerms.balanced.rate) / duration : 0;
    const pMax = loanTemplateTerms.performance.rate > 0
      ? (loanTemplateTerms.performance.cap / loanTemplateTerms.performance.rate) / duration : 0;
    return { balancedMaxPpg: bMax, balancedHeadroom: bMax - recentPPG, perfMaxPpg: pMax, perfHeadroom: pMax - recentPPG };
  }, [loanTemplateTerms, duration, recentPPG]);

  const loanFinalTerms = useMemo(() => {
    const terms = loanTemplateTerms[loanTemplate];
    const multiplier = 1 + loanAdjust;
    return {
      fee: Math.round(terms.fee * multiplier),
      rate: parseFloat((terms.rate * multiplier).toFixed(3)),
      cap: Math.round(terms.cap * multiplier),
    };
  }, [loanTemplateTerms, loanTemplate, loanAdjust]);

  const loanMaxCost = loanFinalTerms.fee + loanFinalTerms.cap;
  const loanFinalMaxPpg = loanFinalTerms.rate > 0 ? (loanFinalTerms.cap / loanFinalTerms.rate) / duration : 0;
  const loanFinalHeadroom = loanFinalMaxPpg - recentPPG;
  const loanEstPoints = Math.round(duration * recentPPG);
  const loanEstBonusPayout = Math.min(loanFinalTerms.cap, loanEstPoints * loanFinalTerms.rate);

  /** Share of the MAXIMUM cost that is committed on signing, as a percentage.
   *  Fixed is 100 (no bonus to be at risk); the heavier the bonus, the smaller
   *  this gets. Taken against fee + cap rather than against the base fee, since
   *  the bar claims to show what you might end up paying. */
  const committedPct = (t: { fee: number; cap: number }) => {
    const total = t.fee + t.cap;
    return total > 0 ? (t.fee / total) * 100 : 100;
  };

  const named = (id: string) => { const r = byId.get(id); return r ? getPlayerDisplayName(r, 'full') : '?'; };
  const namedRight = (id: string) => {
    const r = rightById.get(id);
    return r?.player ? `${getPlayerDisplayName(r.player, 'full')}'s rights` : 'a retained right';
  };

  // What this offer is, read off what is on the table. Drives the headline, the
  // footer sentence and whether Send is live — one derivation, so the label and
  // the button can never disagree about what has been built.
  const deal = describeDeal({
    offered: [...give.map(named), ...giveRights.map(namedRight)],
    requested: [...want.map(named), ...wantRights.map(namedRight)],
    offeredFaab: myCash,
    requestedFaab: theirCash,
  });

  const budget = model.myTeam.faab_budget;
  // Only "borrow" spends my own budget up front — as lender I receive the fee,
  // so there is nothing of mine to check against.
  const cashOut = mode === 'loan' ? (loanDirection === 'borrow' ? loanFinalTerms.fee : 0) : myCash;
  const overBudget = cashOut > budget;

  const canSend = (() => {
    if (!targetId || busy) return false;
    if (overBudget) return false;
    if (mode === 'loan') {
      return Boolean(loanPlayer) && duration >= LOAN_MIN_DURATION && duration <= LOAN_MAX_DURATION && startGw <= lastLoanStart;
    }
    // `deal.sendable` is false for an empty table and for cash-both-ways with no
    // bodies. `POST /trades` refuses the latter outright ("A trade must include
    // at least one player or retained right"); mirroring it here means you find
    // out while building rather than after pressing send.
    return deal.sendable;
  })();

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      if (mode === 'loan') {
        const body = loanDirection === 'lend'
          ? {
              borrowerTeamId: targetId,
              playerId: want[0],
              loanFee: loanFinalTerms.fee,
              startGameweek: startGw,
              endGameweek: endGw,
              bonusRate: loanFinalTerms.rate,
              bonusCap: loanFinalTerms.cap,
              hasRecall,
              message: message || undefined,
              parentLoanId: parentLoanId ?? undefined,
            }
          : {
              requestMode: true,
              lenderTeamId: targetId,
              playerId: want[0],
              loanFee: loanFinalTerms.fee,
              startGameweek: startGw,
              endGameweek: endGw,
              bonusRate: loanFinalTerms.rate,
              bonusCap: loanFinalTerms.cap,
              hasRecall,
              message: message || undefined,
              parentLoanId: parentLoanId ?? undefined,
            };
        const res = await fetch(`/api/leagues/${leagueId}/loans`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) return setError(data.error ?? 'That loan proposal was refused.');
      } else {
        const res = await fetch(`/api/leagues/${leagueId}/trades`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            targetTeamId: targetId,
            offeredPlayerIds: give,
            requestedPlayerIds: want,
            // Cash is netted before it is stored. €30m out against €10m back is
            // €20m out — the same deal, and the only form that classifies
            // cleanly. It also spares the target from having to cover a €10m
            // leg they were never really paying.
            offeredFaab: Math.max(0, deal.netFaab),
            requestedFaab: Math.max(0, -deal.netFaab),
            offeredRightIds: giveRights,
            requestedRightIds: wantRights,
            message: message || undefined,
            saleListingId: initialListing?.id ?? null,
            parentTradeId: parentTradeId ?? undefined,
          }),
        });
        const data = await res.json();
        if (!res.ok) return setError(data.error ?? 'That proposal was refused.');
      }
      onDone();
      onClose();
    } catch {
      setError('Could not reach the server. Try again.');
    } finally {
      setBusy(false);
    }
  };

  // The prototype's picker meta line is a plain season total ("108 pts"), not
  // the loan-fee engine's blended, reliability-weighted recent_ppg — that
  // number is right for pricing a loan, not for browsing a squad.
  const playerMeta = (p: RosterPlayer) => {
    // A listed player shows his club's stance rather than a raw ask, which used
    // to render "asking €0m" whenever the column had never been filled in.
    const listed = p.listing;
    if (listed) return `${p.pl_team} · ${listingStance(listed).headline.toLowerCase()}`;
    return `${p.pl_team} · ${Math.round(p.total_points ?? 0)} pts`;
  };

  // A picker row is normally a plain select-to-add button, but the name inside
  // it is its own nested button that opens the player card instead — it stops
  // propagation so a click on the name never also adds the player.
  const PlayerRow = ({
    p,
    selected,
    onPick,
  }: {
    p: RosterPlayer;
    selected: boolean;
    onPick: () => void;
  }) => (
    <div
      role="button"
      tabIndex={0}
      className={`${styles.pick} ${selected ? styles.pickOn : ''}`}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); }
      }}
    >
      <PositionBadge position={p.primary_position as GranularPosition} size="sm" />
      <span className={styles.pickBody}>
        <button
          type="button"
          className={`${styles.pickName} ${styles.pickNameBtn}`}
          onClick={(e) => { e.stopPropagation(); openPlayerById(p.id); }}
          {...playerHoverProps(prefetchPlayer, p)}
        >
          {getPlayerDisplayName(p, 'initial_last')}
        </button>
        <span className={styles.pickMeta}>{playerMeta(p)}</span>
      </span>
      <span className={styles.pickValue}>{money(Number(p.market_value) || 0)}</span>
    </div>
  );

  const RightRow = ({
    r,
    selected,
    onPick,
  }: {
    r: TransfersRight;
    selected: boolean;
    onPick: () => void;
  }) => (
    <div
      role="button"
      tabIndex={0}
      className={`${styles.pick} ${selected ? styles.pickOn : ''}`}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onPick(); }
      }}
    >
      <PositionBadge position={(r.player?.primary_position ?? 'CM') as GranularPosition} size="sm" />
      <span className={styles.pickBody}>
        {r.player ? (
          <button
            type="button"
            className={`${styles.pickName} ${styles.pickNameBtn}`}
            onClick={(e) => { e.stopPropagation(); openPlayerById(r.player!.id); }}
            {...playerHoverProps(prefetchPlayer, r.player)}
          >
            {getPlayerDisplayName(r.player, 'initial_last')}
          </button>
        ) : (
          <span className={styles.pickName}>Unknown</span>
        )}
        <span className={styles.pickMeta}>
          Retained rights{r.status === 'return_pending' ? ' · back in the PL' : ''}
        </span>
      </span>
      <span className={styles.pickValue}>{money(r.marketValueAtDeparture)}</span>
    </div>
  );

  // ── Rows already on the table ──────────────────────────────────
  //
  // Called as plain functions, not rendered as <Components>. A component
  // declared inside render is a new type on every render, so React unmounts and
  // remounts it — which would throw focus out of the cash input on every
  // keystroke. The picker rows above get away with it because they are buttons.

  const chosenPlayerRow = (p: RosterPlayer, onRemove: () => void) => (
    <div key={p.id} className={`${styles.pick} ${styles.chosen}`}>
      <PositionBadge position={p.primary_position as GranularPosition} size="sm" />
      <span className={styles.pickBody}>
        <button
          type="button"
          className={`${styles.pickName} ${styles.pickNameBtn}`}
          onClick={() => openPlayerById(p.id)}
          {...playerHoverProps(prefetchPlayer, p)}
        >
          {getPlayerDisplayName(p, 'initial_last')}
        </button>
        <span className={styles.pickMeta}>{playerMeta(p)}</span>
      </span>
      <span className={styles.pickValue}>{money(Number(p.market_value) || 0)}</span>
      <button
        type="button"
        className={styles.remove}
        onClick={onRemove}
        aria-label={`Remove ${getPlayerDisplayName(p, 'full')}`}
      >
        ✕
      </button>
    </div>
  );

  const chosenRightRow = (r: TransfersRight, onRemove: () => void) => (
    <div key={r.id} className={`${styles.pick} ${styles.chosen}`}>
      <PositionBadge position={(r.player?.primary_position ?? 'CM') as GranularPosition} size="sm" />
      <span className={styles.pickBody}>
        {r.player ? (
          <button
            type="button"
            className={`${styles.pickName} ${styles.pickNameBtn}`}
            onClick={() => openPlayerById(r.player!.id)}
            {...playerHoverProps(prefetchPlayer, r.player)}
          >
            {getPlayerDisplayName(r.player, 'initial_last')}
          </button>
        ) : (
          <span className={styles.pickName}>Unknown</span>
        )}
        <span className={styles.pickMeta}>
          Retained rights{r.status === 'return_pending' ? ' · back in the PL' : ''}
        </span>
      </span>
      <span className={styles.pickValue}>{money(r.marketValueAtDeparture)}</span>
      <button type="button" className={styles.remove} onClick={onRemove} aria-label="Remove retained right">
        ✕
      </button>
    </div>
  );

  const cashRow = (opts: {
    value: number;
    onChange: (n: number) => void;
    onRemove: () => void;
    hint: string;
    label: string;
  }) => (
    <div className={`${styles.pick} ${styles.chosen} ${opts.value > 0 ? styles.pickOn : ''}`}>
      <span className={styles.cashGlyph} aria-hidden="true">€</span>
      <span className={styles.pickBody}>
        <span className={styles.pickName}>Cash</span>
        <span className={styles.pickMeta}>{opts.hint}</span>
      </span>
      <input
        className={styles.cashInline}
        type="number"
        min={0}
        value={opts.value || ''}
        placeholder="0"
        aria-label={opts.label}
        onChange={(e) => opts.onChange(Math.max(0, parseInt(e.target.value, 10) || 0))}
      />
      <button type="button" className={styles.remove} onClick={opts.onRemove} aria-label="Remove cash">
        ✕
      </button>
    </div>
  );

  /** The add-picker for one side: their squad and rights, minus what is already
   *  on the table, plus a cash line. */
  const pickerPanel = (side: 'mine' | 'theirs') => {
    const mine = side === 'mine';
    const roster = mine ? myRoster : theirRoster;
    const rights = mine ? myRights : theirRights;
    const chosenPlayers = mine ? give : want;
    const chosenRights = mine ? giveRights : wantRights;
    const cashOpen = mine ? myCashOpen : theirCashOpen;

    const q = pickQuery.trim().toLowerCase();
    const hit = (name: string) => q === '' || name.toLowerCase().includes(q);

    // Dearest first. A squad list in roster order is a list in no order at all;
    // when you are looking for something to balance a deal, value is the axis
    // you are actually scanning.
    const players = roster
      .filter((p) => !chosenPlayers.includes(p.id) && hit(getPlayerDisplayName(p, 'full')))
      .slice()
      .sort((a, b) => (Number(b.market_value) || 0) - (Number(a.market_value) || 0));
    const claims = rights
      .filter((r) => !chosenRights.includes(r.id) && hit(r.player ? getPlayerDisplayName(r.player, 'full') : ''))
      .slice()
      .sort((a, b) => b.marketValueAtDeparture - a.marketValueAtDeparture);

    return (
      <div className={styles.picker}>
        <div className={styles.pickerHead}>
          <input
            className={styles.pickerSearch}
            placeholder={mine ? 'Search your squad…' : `Search ${target?.team_name ?? 'their squad'}…`}
            value={pickQuery}
            onChange={(e) => setPickQuery(e.target.value)}
            aria-label="Search"
          />
          <button
            type="button"
            className={styles.pickerDone}
            onClick={() => { setPicking(null); setPickQuery(''); }}
          >
            Done
          </button>
        </div>

        <div className={styles.pickerList}>
          {!cashOpen && (
            <>
              <div className={styles.pickerGroup}>Budget</div>
              <button
                type="button"
                className={`${styles.pick} ${styles.pickerCash}`}
                onClick={() => {
                  if (mine) setMyCashOpen(true); else setTheirCashOpen(true);
                  setPicking(null);
                  setPickQuery('');
                }}
              >
                <span className={styles.cashGlyph} aria-hidden="true">€</span>
                <span className={styles.pickBody}>
                  <span className={styles.pickName}>Cash</span>
                  <span className={styles.pickMeta}>
                    {money(mine ? budget : target?.faab_budget ?? 0)} available
                  </span>
                </span>
              </button>
            </>
          )}

          {players.length > 0 && (
            <div className={`${styles.pickerGroup} ${!cashOpen ? styles.pickerGroupGap : ''}`}>
              Squad
            </div>
          )}
          {players.map((p) => (
            <PlayerRow
              key={p.id}
              p={p}
              selected={false}
              onPick={() => {
                if (mine) setGive([...give, p.id]); else setWant([...want, p.id]);
              }}
            />
          ))}

          {claims.length > 0 && (
            <div className={`${styles.pickerGroup} ${styles.pickerGroupGap}`}>Retained rights</div>
          )}
          {claims.map((r) => (
            <RightRow
              key={r.id}
              r={r}
              selected={false}
              onPick={() => {
                if (mine) setGiveRights([...giveRights, r.id]); else setWantRights([...wantRights, r.id]);
              }}
            />
          ))}

          {players.length === 0 && claims.length === 0 && (
            <p className={styles.emptyNote}>
              {roster.length === 0 && rights.length === 0
                ? 'Pick a club above.'
                : q
                  ? `Nothing matching “${pickQuery.trim()}”.`
                  : 'Nothing left to add.'}
            </p>
          )}
        </div>
      </div>
    );
  };

  // Offers are named by the band above the footer, so only a loan needs a line
  // here — and it states the shape, not the money, since the loan ledger owns
  // the money and the two must not disagree about whether "cost" means the fee
  // or the fee plus the cap.
  const summary = (() => {
    if (mode !== 'loan') return '';
    if (!loanPlayer) return 'Choose a player.';
    return loanDirection === 'lend'
      ? `${getPlayerDisplayName(loanPlayer, 'full')} out to ${target?.team_name ?? 'them'}, GW${startGw}–${endGw}.`
      : `${getPlayerDisplayName(loanPlayer, 'full')} in from ${target?.team_name ?? 'them'}, GW${startGw}–${endGw}.`;
  })();

  // Loan mode picks from my roster when lending, theirs when borrowing — both
  // filtered to statuses that can actually be loaned.
  const loanRosterSource = loanDirection === 'lend' ? myRoster : theirRoster;
  const loanEligibleRoster = useMemo(
    () => loanRosterSource.filter((p) => !NOT_LOANABLE_STATUSES.has(p.status)),
    [loanRosterSource],
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title={target ? `Approach ${target.team_name}` : 'Approach a club'}
      lead={
        <CrestBadge
          config={(target?.crest_config as CrestConfig | null) ?? null}
          teamName={target?.team_name}
          size={22}
        />
      }
      footer={
        <>
          <span className={styles.summary}>{summary}</span>
          {overBudget && <span className={styles.warn}>That is more than your {money(budget)} balance.</span>}
          {mode === 'loan' && startGw > lastLoanStart && (
            <span className={styles.warn}>Loans cannot start after GW{lastLoanStart}.</span>
          )}
          <button type="button" className={styles.ghost} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={styles.go} onClick={send} disabled={!canSend}>
            {busy ? 'Sending…' : mode === 'loan' ? 'Send loan proposal' : 'Send proposal'}
          </button>
        </>
      }
    >
      {/* Club strip — constant across all three modes. */}
      <div className={styles.clubs}>
        {others.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`${styles.club} ${t.id === targetId ? styles.clubOn : ''}`}
            onClick={() => {
              setTargetId(t.id);
              // The wanted players/rights belong to the old counterparty's squad.
              setWant([]);
              setWantRights([]);
            }}
          >
            <CrestBadge
              config={(t.crest_config as CrestConfig | null) ?? null}
              teamName={t.team_name}
              size={16}
            />
            {t.team_name}
          </button>
        ))}

        {/* The columns below list the counterparty's tradeable assets, not their
            club: their XI, their academy and where they actually have depth are
            what tell you whether the ask is realistic. The drawer opens over
            this dialog and hands the Escape key back when it closes. */}
        {target && (
          <SquadPeekButton
            teamId={target.id}
            teamName={target.team_name}
            className={styles.viewSquad}
            title={`Peek at ${target.team_name}'s squad`}
          >
            View squad
          </SquadPeekButton>
        )}
      </div>

      <div className={styles.modes}>
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            className={`${styles.mode} ${mode === m.key ? styles.modeOn : ''}`}
            onClick={() => {
              setMode(m.key);
              // A loan moves exactly one player, so a multi-player selection
              // carried in from an offer would silently send only the first.
              // Nothing is cleared going the other way: an offer can hold
              // whatever the loan had, and losing your work to a tab click was
              // the worst thing about the old three-mode row.
              if (m.key === 'loan') {
                setWant((w) => w.slice(0, 1));
                setGive([]);
                setGiveRights([]);
                setWantRights([]);
              }
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {mode === 'loan' ? (
        <>
          <div className={styles.dir}>
            <button
              type="button"
              className={`${styles.dirBtn} ${loanDirection === 'borrow' ? styles.dirOn : ''}`}
              onClick={() => { setLoanDirection('borrow'); setWant([]); }}
            >
              <span className={styles.dirTitle}>Loan in</span>
              <span className={styles.dirNote}>
                Take one of theirs · {loanInsRemaining} of {model.league.max_loan_ins ?? 2} slots free
              </span>
            </button>
            <button
              type="button"
              className={`${styles.dirBtn} ${loanDirection === 'lend' ? styles.dirOn : ''}`}
              onClick={() => { setLoanDirection('lend'); setWant([]); }}
            >
              <span className={styles.dirTitle}>Loan out</span>
              <span className={styles.dirNote}>
                Send one of yours · {loanOutsRemaining} of {model.league.max_loan_outs ?? 1} slot
                {(model.league.max_loan_outs ?? 1) !== 1 ? 's' : ''} free
              </span>
            </button>
          </div>

          {/* ── 1. The player ─────────────────────────────── */}
          <section className={styles.stage}>
            <div className={styles.stageHead}>
              <span className={styles.stageNum}>1</span>
              <span className={styles.stageLabel}>The player</span>
              {loanPlayer ? (
                <button type="button" className={styles.stageAction} onClick={() => setWant([])}>
                  Change
                </button>
              ) : (
                <span className={styles.stageQuiet}>
                  {loanEligibleRoster.length} eligible
                </span>
              )}
            </div>

            {loanPlayer ? (
              <div className={styles.chip}>
                <PositionBadge position={loanPlayer.primary_position as GranularPosition} size="sm" />
                <span className={styles.pickBody}>
                  <button
                    type="button"
                    className={`${styles.pickName} ${styles.pickNameBtn}`}
                    onClick={() => openPlayerById(loanPlayer.id)}
                    {...playerHoverProps(prefetchPlayer, loanPlayer)}
                  >
                    {getPlayerDisplayName(loanPlayer, 'full')}
                  </button>
                  <span className={styles.pickMeta}>
                    {loanPlayer.pl_team} · {recentPPG.toFixed(1)} projected PPG
                  </span>
                </span>
                <span className={styles.pickValue}>{money(Number(loanPlayer.market_value) || 0)}</span>
              </div>
            ) : loanEligibleRoster.length === 0 ? (
              <p className={styles.emptyNote}>
                {loanDirection === 'lend'
                  ? 'Nobody on your roster is eligible to be loaned out.'
                  : 'Pick a club above.'}
              </p>
            ) : (
              <div className={styles.list}>
                {loanEligibleRoster.map((p) => (
                  <PlayerRow
                    key={p.id}
                    p={p}
                    selected={false}
                    onPick={() => toggle(want, setWant, p.id, true)}
                  />
                ))}
              </div>
            )}
          </section>

          {/* ── 2. The spell ──────────────────────────────── */}
          {loanPlayer ? (
            <section className={styles.stage}>
              <div className={styles.stageHead}>
                <span className={styles.stageNum}>2</span>
                <span className={styles.stageLabel}>The spell</span>
                <span className={styles.stageMeta}>
                  GW{startGw} → GW{endGw} · {duration} weeks
                </span>
              </div>
              <GwRangeSlider
                min={gwNow + 1}
                maxStart={lastLoanStart}
                maxEnd={model.league.total_gameweeks ?? 38}
                startGw={startGw}
                endGw={endGw}
                minDuration={LOAN_MIN_DURATION}
                maxDuration={LOAN_MAX_DURATION}
                onChange={(s, e) => { setStartGw(s); setEndGw(e); }}
              />

              <label className={styles.recall} style={{ marginTop: 'var(--s3)' }}>
                <input
                  type="checkbox"
                  checked={hasRecall}
                  onChange={(e) => setHasRecall(e.target.checked)}
                />
                <span>
                  Early recall clause
                  {/* Named from the reader's side: as lender the recall is yours to
                      call and yours to pay for, as borrower it is a thing that can
                      be done to you. */}
                  <p className={styles.recallNote}>
                    {!hasRecall
                      ? 'No early recall — the player stays at the borrowing club for the full duration.'
                      : loanDirection === 'lend'
                        ? `You may cancel early with 1 week's notice, paying ${target?.team_name ?? 'the borrower'} a €25m flat penalty. Bonuses already earned are not refunded.`
                        : `${target?.team_name ?? 'The lender'} may cancel early with 1 week's notice, paying you a €25m flat penalty. Bonuses already earned are not refunded.`}
                  </p>
                </span>
              </label>
            </section>
          ) : (
            <div className={styles.stageShut}>
              <span className={styles.stageNum}>2</span>
              <span className={styles.stageLabel}>The spell</span>
              <span className={styles.stageShutNote}>Pick a player first</span>
            </div>
          )}

          {/* ── 3. The fee ────────────────────────────────── */}
          {loanPlayer ? (
            <section className={styles.stage}>
              <div className={styles.stageHead}>
                <span className={styles.stageNum}>3</span>
                <span className={styles.stageLabel}>The fee</span>
                <span className={styles.stageMeta}>Base {money(baseFee)}</span>
              </div>

              <div className={styles.templates}>
                <button
                  type="button"
                  className={`${styles.template} ${loanTemplate === 'fixed' ? styles.templateOn : ''}`}
                  onClick={() => setLoanTemplate('fixed')}
                >
                  <span className={styles.templateName}>Fixed</span>
                  <span className={styles.templateFee}>{money(Math.round(loanTemplateTerms.fixed.fee))}</span>
                  <span className={styles.templateBar}>
                    <span className={styles.templateUp} style={{ width: '100%' }} />
                  </span>
                  <span className={styles.templateNote}>
                    All of it up front. He can have a career week and it costs no more.
                  </span>
                </button>

                <button
                  type="button"
                  className={`${styles.template} ${loanTemplate === 'balanced' ? styles.templateOn : ''}`}
                  onClick={() => setLoanTemplate('balanced')}
                >
                  <span className={styles.templateName}>Balanced</span>
                  <span className={styles.templateFee}>
                    {money(Math.round(loanTemplateTerms.balanced.fee))} + €{loanTemplateTerms.balanced.rate.toFixed(3)}m/pt
                  </span>
                  <span className={styles.templateBar}>
                    <span
                      className={styles.templateUp}
                      style={{ width: `${committedPct(loanTemplateTerms.balanced)}%` }}
                    />
                    <span
                      className={styles.templateRisk}
                      style={{ width: `${100 - committedPct(loanTemplateTerms.balanced)}%` }}
                    />
                  </span>
                  <span className={styles.templateNote}>
                    Bonus stops at {balancedMaxPpg.toFixed(1)} PPG — {balancedHeadroom.toFixed(1)} above his baseline.
                  </span>
                </button>

                <button
                  type="button"
                  className={`${styles.template} ${loanTemplate === 'performance' ? styles.templateOn : ''}`}
                  onClick={() => setLoanTemplate('performance')}
                >
                  <span className={styles.templateName}>Performance</span>
                  <span className={styles.templateFee}>
                    {money(Math.round(loanTemplateTerms.performance.fee))} + €{loanTemplateTerms.performance.rate.toFixed(3)}m/pt
                  </span>
                  <span className={styles.templateBar}>
                    <span
                      className={styles.templateUp}
                      style={{ width: `${committedPct(loanTemplateTerms.performance)}%` }}
                    />
                    <span
                      className={styles.templateRisk}
                      style={{ width: `${100 - committedPct(loanTemplateTerms.performance)}%` }}
                    />
                  </span>
                  <span className={styles.templateNote}>
                    Bonus stops at {perfMaxPpg.toFixed(1)} PPG — {perfHeadroom.toFixed(1)} above his baseline.
                  </span>
                </button>
              </div>

              <div className={styles.legend}>
                <span>
                  <span className={styles.legendSw} style={{ background: 'var(--color-text-muted)' }} />
                  Paid on signing
                </span>
                <span>
                  <span className={styles.legendSw} style={{ background: 'var(--color-warning-text)' }} />
                  Paid only if he performs
                </span>
              </div>

              <div className={styles.adjust}>
                <span className={styles.adjustLabel}>Sweeten it</span>
                <div className={styles.adjustTrack}>
                  <div className={styles.adjustTrackBg} />
                  <input
                    type="range"
                    min={-0.20}
                    max={0.20}
                    step={0.05}
                    value={loanAdjust}
                    onChange={(e) => setLoanAdjust(parseFloat(e.target.value))}
                    className={styles.feeRangeInput}
                    aria-label="Price adjustment"
                  />
                </div>
                <span className={`${styles.adjustValue} ${loanAdjust > 0 ? styles.up : loanAdjust < 0 ? styles.down : ''}`}>
                  {loanAdjust === 0 ? 'standard · ±20%' : `${loanAdjust > 0 ? '+' : ''}${Math.round(loanAdjust * 100)}%`}
                </span>
              </div>
            </section>
          ) : (
            <div className={styles.stageShut}>
              <span className={styles.stageNum}>3</span>
              <span className={styles.stageLabel}>The fee</span>
              <span className={styles.stageShutNote}>Priced off his form and the length</span>
            </div>
          )}

          {/* ── What it costs ─────────────────────────────── */}
          {loanPlayer && (
            <div className={styles.ledger}>
              <div className={styles.ledgerItems}>
                <div className={styles.ledgerRow}>
                  <span>On signing</span>
                  <span className={styles.ledgerDots} />
                  <span className={styles.ledgerVal}>
                    {loanFinalTerms.fee > 0 ? money(loanFinalTerms.fee) : 'Free'}
                  </span>
                </div>
                {loanTemplate !== 'fixed' && (
                  <>
                    <div className={styles.ledgerRow}>
                      <span>Bonus at €{loanFinalTerms.rate.toFixed(3)}m per point</span>
                      <span className={styles.ledgerDots} />
                      <span className={`${styles.ledgerVal} ${styles.risk}`}>up to {money(loanFinalTerms.cap)}</span>
                    </div>
                    <div className={styles.ledgerRow}>
                      <span>Likely bonus if he holds {recentPPG.toFixed(1)} PPG</span>
                      <span className={styles.ledgerDots} />
                      <span className={styles.ledgerVal}>≈ €{loanEstBonusPayout.toFixed(1)}m</span>
                    </div>
                    <div className={styles.ledgerRow}>
                      <span>Bonus runs out at</span>
                      <span className={styles.ledgerDots} />
                      <span className={styles.ledgerVal}>
                        {loanFinalMaxPpg.toFixed(1)} PPG · +{loanFinalHeadroom.toFixed(1)}
                      </span>
                    </div>
                  </>
                )}
                <div className={styles.ledgerRow}>
                  <span>Recall clause</span>
                  <span className={styles.ledgerDots} />
                  <span className={styles.ledgerVal}>{hasRecall ? '€25m to break' : 'None'}</span>
                </div>
              </div>
              <div className={styles.ledgerTotal}>
                <span className={styles.ledgerKicker}>
                  {loanDirection === 'lend' ? 'Borrower pays at most' : 'You pay at most'}
                </span>
                <span className={styles.ledgerBig}>{money(loanMaxCost)}</span>
                <span className={styles.ledgerSub}>
                  {loanDirection === 'lend'
                    ? `They hold ${money(target?.faab_budget ?? 0)}`
                    : `Leaves ${money(Math.max(0, budget - loanFinalTerms.fee))} of ${money(budget)}`}
                </span>
              </div>
            </div>
          )}
        </>
      ) : (
        <div className={styles.body}>
          {/* ── Left: what you put up ─────────────────────── */}
          <div className={styles.side}>
            <div className={styles.sideLabel}>
              <span>You put up</span>
              <span>
                Squad {myRoster.length} / {model.league.roster_size ?? 20}
              </span>
            </div>

            {give.map((id) => {
              const p = byId.get(id);
              return p ? chosenPlayerRow(p, () => setGive(give.filter((x) => x !== id))) : null;
            })}
            {giveRights.map((id) => {
              const r = rightById.get(id);
              return r ? chosenRightRow(r, () => setGiveRights(giveRights.filter((x) => x !== id))) : null;
            })}
            {myCashOpen && cashRow({
              value: myCash,
              onChange: setMyCash,
              onRemove: () => { setMyCashOpen(false); setMyCash(0); },
              hint: myCash > 0
                ? `Leaves you ${money(Math.max(0, budget - myCash))} for the rest of the window`
                : `${money(budget)} available`,
              label: 'Cash you put up',
            })}

            {picking === 'mine' ? pickerPanel('mine') : (
              <button
                type="button"
                className={styles.add}
                onClick={() => { setPicking('mine'); setPickQuery(''); }}
              >
                + Add a player, a retained right, or cash
              </button>
            )}
          </div>

          <div className={styles.swap} aria-hidden="true">⇄</div>

          {/* ── Right: what comes back ────────────────────── */}
          <div className={`${styles.side} ${styles.sideThem}`}>
            <div className={styles.sideLabel}>
              <span>They put up</span>
              <span>
                {target?.team_name} · {money(target?.faab_budget ?? 0)}
              </span>
            </div>

            {want.map((id) => {
              const p = byId.get(id);
              return p ? chosenPlayerRow(p, () => setWant(want.filter((x) => x !== id))) : null;
            })}
            {wantRights.map((id) => {
              const r = rightById.get(id);
              return r ? chosenRightRow(r, () => setWantRights(wantRights.filter((x) => x !== id))) : null;
            })}
            {theirCashOpen && cashRow({
              value: theirCash,
              onChange: setTheirCash,
              onRemove: () => { setTheirCashOpen(false); setTheirCash(0); },
              hint: theirCash > 0
                ? 'They must be able to cover it when they accept'
                : `${money(target?.faab_budget ?? 0)} available`,
              label: 'Cash they put up',
            })}

            {picking === 'theirs' ? pickerPanel('theirs') : (
              <button
                type="button"
                className={styles.add}
                onClick={() => { setPicking('theirs'); setPickQuery(''); }}
              >
                + Add a player, a retained right, or cash
              </button>
            )}
          </div>
        </div>
      )}

      {/* What you have built, named by its shape. */}
      {mode === 'offer' && deal.kind !== 'empty' && (
        <div className={`${styles.ledger} ${styles.ledgerPlain}`}>
          <div className={styles.ledgerItems}>
            <div className={styles.dealHead}>{deal.headline}</div>
            <p className={styles.dealLine}>{deal.sentence}</p>
          </div>
          {deal.netFaab !== 0 && (
            <div className={styles.ledgerTotal}>
              <span className={styles.ledgerKicker}>
                {deal.netFaab > 0 ? 'Cash out' : 'Cash in'}
              </span>
              <span className={styles.ledgerBig}>{money(Math.abs(deal.netFaab))}</span>
              <span className={styles.ledgerSub}>
                {deal.netFaab > 0
                  ? `Leaves ${money(Math.max(0, budget - deal.netFaab))} of ${money(budget)}`
                  : `Takes you to ${money(budget - deal.netFaab)}`}
              </span>
            </div>
          )}
        </div>
      )}

      <div className={styles.messageWrap}>
        <input
          className={styles.message}
          placeholder="Add a note (optional)…"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          maxLength={280}
        />
      </div>

      {error && <p className={styles.error}>{error}</p>}
    </Modal>
  );
}
