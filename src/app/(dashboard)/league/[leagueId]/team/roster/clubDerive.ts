/**
 * Pure, client-side derivations for the My Club page.
 * Operates on the SquadEntry[] the server hands down; no I/O.
 *
 * Formation feasibility mirrors the app's real rules: POSITION_FLEX_MAP is
 * strict identity (see src/types), so a slot is fillable only by a player whose
 * own primary/secondary positions include that exact slot position.
 */

import { FORMATION_SLOTS, ALL_FORMATIONS } from '@/types';
import type { GranularPosition, Player } from '@/types';
import type { SquadEntry } from './ClubClient';

// ── Position colour + labels ────────────────────────────────────────────────
export const POS_VAR: Record<string, string> = {
  GK: '--color-pos-gk', CB: '--color-pos-cb',
  LB: '--color-pos-fb', RB: '--color-pos-fb',
  LWB: '--color-pos-wb', RWB: '--color-pos-wb',
  DM: '--color-pos-dm', CM: '--color-pos-cm', AM: '--color-pos-am',
  LW: '--color-pos-lw', RW: '--color-pos-rw', ST: '--color-pos-st',
};
export const posColor = (p: string): string => `var(${POS_VAR[p] || '--color-text-muted'})`;

export const POS_LONG: Record<string, string> = {
  GK: 'Goalkeeper', CB: 'Centre-Back', LB: 'Left-Back', RB: 'Right-Back',
  LWB: 'Left Wing-Back', RWB: 'Right Wing-Back', DM: 'Defensive Mid',
  CM: 'Central Mid', AM: 'Attacking Mid', LW: 'Left Winger', RW: 'Right Winger', ST: 'Striker',
};

// Depth-chart zones, attack first — matches PitchUI's vertical flow.
export const ZONES: { key: string; label: string; positions: string[] }[] = [
  { key: 'ST', label: 'Strikers', positions: ['ST'] },
  { key: 'W', label: 'Wingers', positions: ['LW', 'RW'] },
  { key: 'AM', label: 'Attacking Midfield', positions: ['AM'] },
  { key: 'CM', label: 'Central Midfield', positions: ['CM'] },
  { key: 'DM', label: 'Defensive Midfield', positions: ['DM'] },
  { key: 'WIDE', label: 'Wide Defence', positions: ['LWB', 'RWB', 'LB', 'RB'] },
  { key: 'CB', label: 'Central Defence', positions: ['CB'] },
  { key: 'GK', label: 'Goal', positions: ['GK'] },
];

// ── Status ───────────────────────────────────────────────────────────────────
export const STATUS: Record<string, { label: string; short: string; tone: string }> = {
  active: { label: 'First XI', short: 'First XI', tone: 'var(--color-accent)' },
  bench: { label: 'Bench', short: 'Bench', tone: 'var(--color-text-muted)' },
  ir: { label: 'Injured Reserve', short: 'IR', tone: 'var(--color-danger)' },
  taxi: { label: 'Academy', short: 'Academy', tone: 'var(--color-warning)' },
  loan_in: { label: 'Loan In', short: 'Loan In', tone: 'var(--color-accent-green)' },
  loan_out: { label: 'Loan Out', short: 'Loan Out', tone: 'var(--color-text-muted)' },
  pending_activation: { label: 'Returning', short: 'Returning', tone: 'var(--color-warning)' },
};
export const statusMeta = (s: string) => STATUS[s] ?? { label: s, short: s, tone: 'var(--color-text-muted)' };

export const INJURY: Record<string, { label: string; tone: string }> = {
  d: { label: 'Doubt', tone: 'var(--color-warning)' },
  i: { label: 'Injured', tone: 'var(--color-danger)' },
  s: { label: 'Susp', tone: 'var(--color-danger)' },
  u: { label: 'Out', tone: 'var(--color-danger)' },
  n: { label: 'Out', tone: 'var(--color-danger)' },
};

// ── Formatting ────────────────────────────────────────────────────────────────
export const money = (n: number): string => `€${Math.round(n).toLocaleString('en-GB')}m`;
export const signedMoney = (n: number): string =>
  `${n > 0 ? '+' : n < 0 ? '−' : ''}€${Math.abs(Math.round(n)).toLocaleString('en-GB')}m`;

export function ageOf(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

/** "Xd Yh" until an ISO deadline, or null when past / absent. */
export function countdown(iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
}

// ── Player helpers ────────────────────────────────────────────────────────────
export const positionsOf = (p: Player): string[] => [p.primary_position, ...((p.secondary_positions as string[]) ?? [])];
export const avgForm = (form: number[]): number => (form.length ? form.reduce((a, b) => a + b, 0) / form.length : 0);
export const seasonPts = (e: SquadEntry): number => Number(e.player.total_points ?? 0);
export const ppgOf = (e: SquadEntry): number => Number(e.player.ppg ?? 0);
export const valueOf = (e: SquadEntry): number => Number(e.player.market_value ?? 0);

// ── Squad-level derivations ──────────────────────────────────────────────────
const LINEUP_STATUSES = new Set(['active', 'bench', 'loan_in']);
export const lineupPool = (entries: SquadEntry[]) => entries.filter((e) => LINEUP_STATUSES.has(e.status));

export function squadTotals(entries: SquadEntry[]) {
  const value = entries.reduce((a, e) => a + valueOf(e), 0);
  const paid = entries.reduce((a, e) => a + Number(e.acquisitionValue ?? 0), 0);
  const ages = entries.map((e) => ageOf(e.player.date_of_birth)).filter((a): a is number => a != null);
  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : 0;
  const buckets = [
    { label: 'U21', test: (a: number) => a <= 21 },
    { label: '22–26', test: (a: number) => a >= 22 && a <= 26 },
    { label: '27–30', test: (a: number) => a >= 27 && a <= 30 },
    { label: '31+', test: (a: number) => a >= 31 },
  ].map((b) => ({ ...b, n: ages.filter(b.test).length }));
  return { value, paid, net: value - paid, avgAge, ages, buckets };
}

/** Composite "Overall" score per entry id — min-max normalised pts / ppg / value. */
export function overallScores(entries: SquadEntry[]): Record<string, number> {
  const nz = (v: number, arr: number[]) => {
    const mn = Math.min(...arr), mx = Math.max(...arr);
    return mx === mn ? 0.5 : (v - mn) / (mx - mn);
  };
  const pts = entries.map(seasonPts);
  const ppg = entries.map(ppgOf);
  const val = entries.map(valueOf);
  const out: Record<string, number> = {};
  entries.forEach((e) => {
    out[e.id] = 0.4 * nz(seasonPts(e), pts) + 0.35 * nz(ppgOf(e), ppg) + 0.25 * nz(valueOf(e), val);
  });
  return out;
}

// ── Formation feasibility (Kuhn's bipartite matching) ────────────────────────
function matchFormation(slots: GranularPosition[], players: Player[]): boolean {
  const slotOf: Record<number, number | undefined> = {};
  const assignedBy: Record<number, boolean> = {};
  function augment(pi: number, seen: Set<number>): boolean {
    const positions = positionsOf(players[pi]);
    for (let si = 0; si < slots.length; si++) {
      if (seen.has(si)) continue;
      if (!positions.includes(slots[si])) continue;
      seen.add(si);
      if (slotOf[si] === undefined || augment(slotOf[si]!, seen)) {
        slotOf[si] = pi;
        assignedBy[pi] = true;
        return true;
      }
    }
    return false;
  }
  let matched = 0;
  for (let pi = 0; pi < players.length; pi++) {
    if (augment(pi, new Set())) matched++;
    if (matched >= slots.length) break;
  }
  return Object.keys(slotOf).length >= slots.length;
}

export function formationReport(entries: SquadEntry[]) {
  const players = lineupPool(entries).map((e) => e.player);
  return ALL_FORMATIONS.map((name) => ({ name, ok: matchFormation(FORMATION_SLOTS[name], players) }));
}

// Deepest demand for each exact position across all supported formations.
const POS_MAX_NEED: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  ALL_FORMATIONS.forEach((f) => {
    const c: Record<string, number> = {};
    FORMATION_SLOTS[f].forEach((s) => { c[s] = (c[s] || 0) + 1; });
    Object.keys(c).forEach((p) => { m[p] = Math.max(m[p] || 0, c[p]); });
  });
  return m;
})();

/** Positions the lineup pool cannot cover to the depth some formation wants. */
export function shortages(entries: SquadEntry[]) {
  const players = lineupPool(entries).map((e) => e.player);
  return Object.keys(POS_MAX_NEED)
    .map((pos) => ({ pos, have: players.filter((p) => positionsOf(p).includes(pos)).length, need: POS_MAX_NEED[pos] }))
    .filter((s) => s.have < s.need);
}
