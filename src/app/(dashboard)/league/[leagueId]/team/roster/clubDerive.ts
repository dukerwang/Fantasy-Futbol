/**
 * Pure, client-side derivations for the club page — yours or any rival's.
 * Operates on the SquadEntry[] the server hands down; no I/O.
 *
 * Formation feasibility mirrors the app's real rules: POSITION_FLEX_MAP is
 * strict identity (see src/types), so a slot is fillable only by a player whose
 * own primary/secondary positions include that exact slot position.
 */

import { FORMATION_SLOTS, ALL_FORMATIONS } from '@/types';
import type { Formation, GranularPosition, Player } from '@/types';
import type { SquadEntry } from './ClubClient';
import { selectBestLineup, selectForFormation } from '@/lib/lineups/selectBestLineup';

// ── Position colour + labels ────────────────────────────────────────────────
const POS_VAR: Record<string, string> = {
  GK: '--color-pos-gk', CB: '--color-pos-cb',
  LB: '--color-pos-fb', RB: '--color-pos-fb',
  LWB: '--color-pos-wb', RWB: '--color-pos-wb',
  DM: '--color-pos-dm', CM: '--color-pos-cm', AM: '--color-pos-am',
  LW: '--color-pos-lw', RW: '--color-pos-rw', ST: '--color-pos-st',
};
export const posColor = (p: string): string => `var(${POS_VAR[p] || '--color-text-muted'})`;

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
/**
 * Every `tone` here is an INK — it is painted as `color` on a status word — so
 * each one has to be the text-role token rather than the fill-role one. Three
 * were not, and each failed in exactly one theme:
 *
 *   --color-accent       on "First XI"   4.33:1 dark   -> --color-accent-ink
 *   --color-warning      on "Academy"    2.09:1 light  -> --color-warning-text
 *   --color-accent-green on "Loan In"    (the 1.0 alias for the same fill)
 *
 * This is rule 5 from the auction room port — accent is a fill,
 * --color-accent-ink is the text — and rule 4 from the hub, which added
 * --color-warning-text for the same reason.
 */
const STATUS: Record<string, { label: string; short: string; tone: string }> = {
  active: { label: 'First XI', short: 'First XI', tone: 'var(--color-accent-ink)' },
  bench: { label: 'Bench', short: 'Bench', tone: 'var(--color-text-muted)' },
  ir: { label: 'Injured Reserve', short: 'IR', tone: 'var(--color-danger)' },
  taxi: { label: 'Academy', short: 'Academy', tone: 'var(--color-warning-text)' },
  loan_in: { label: 'Loan In', short: 'Loan In', tone: 'var(--color-accent-ink)' },
  loan_out: { label: 'Loan Out', short: 'Loan Out', tone: 'var(--color-text-muted)' },
  pending_activation: { label: 'Returning', short: 'Returning', tone: 'var(--color-warning-text)' },
};
export const statusMeta = (s: string) => STATUS[s] ?? { label: s, short: s, tone: 'var(--color-text-muted)' };

export const INJURY: Record<string, { label: string; tone: string }> = {
  d: { label: 'Doubt', tone: 'var(--color-warning-text)' },
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

/**
 * "Xd Yh" until an ISO deadline, or null when past / absent.
 *
 * `from` is a CLOCK-SKEW ANCHOR and must be a server timestamp, the same
 * contract `buildHomeModel`'s own countdown has had since League Home was
 * built. This function used to read `Date.now()` itself, which made it a
 * hydration hazard rather than a styling nit: the server rendered "5h", the
 * client hydrated a moment later and could compute "4h", and once a deadline
 * lapsed between the two it returned `null` on one side and a string on the
 * other — so an element existed in the server HTML and not in the client tree.
 * React reports that as a failed hydration and does not patch it.
 */
export function countdown(from: string, iso: string | null): string | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime() - new Date(from).getTime();
  if (ms <= 0) return null;
  const h = Math.floor(ms / 3_600_000);
  const d = Math.floor(h / 24);
  return d > 0 ? `${d}d ${h % 24}h` : `${h}h`;
}

// ── Player helpers ────────────────────────────────────────────────────────────
const positionsOf = (p: Player): string[] => (p.primary_position ? [p.primary_position as string] : []).concat((p.secondary_positions as string[]) ?? []);
export const avgForm = (form: number[]): number => (form.length ? form.reduce((a, b) => a + b, 0) / form.length : 0);
export const seasonPts = (e: SquadEntry): number => Number(e.player.total_points ?? 0);
export const ppgOf = (e: SquadEntry): number => Number(e.player.ppg ?? 0);
export const valueOf = (e: SquadEntry): number => Number(e.player.market_value ?? 0);

// ── Squad-level derivations ──────────────────────────────────────────────────
const LINEUP_STATUSES = new Set(['active', 'bench', 'loan_in']);
const lineupPool = (entries: SquadEntry[]) => entries.filter((e) => LINEUP_STATUSES.has(e.status));

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

/**
 * A matchday XI evaluates expected minutes, Futbolpedia outlook quality,
 * real-world starter calibre (market value), and sample-weighted form.
 * Early-season points are cautiously discounted so 2 gameweeks cannot
 * distort the side.
 */
export function projectedScores(entries: SquadEntry[]): Record<string, number> {
  const normalise = (values: number[]) => {
    const usable = values.filter(Number.isFinite);
    if (!usable.length) return (_: number) => 0.5;
    const low = Math.min(...usable);
    const high = Math.max(...usable);
    return (value: number) => {
      if (!Number.isFinite(value)) return 0.5;
      return high === low ? 0.5 : (value - low) / (high - low);
    };
  };

  const minutesRoleMap: Record<string, number> = {
    nailed: 1.0,
    likely_starter: 0.85,
    rotation_risk: 0.45,
    fringe: 0.15,
  };
  const qualityMap: Record<string, number> = {
    elite: 1.0,
    high: 0.85,
    solid: 0.65,
    squad: 0.40,
  };
  const availabilityMap: Record<string, number> = {
    a: 1.0,
    d: 0.95,
    i: 0.85,
    s: 0.80,
    u: 0.20,
    n: 0.20,
  };

  const valNorm = normalise(entries.map(valueOf));
  const formNorm = normalise(entries.map((e) => avgForm(e.form)));

  const scores: Record<string, number> = {};

  entries.forEach((entry) => {
    const facets = entry.projection;
    const minRole = facets?.minutesRole ? (minutesRoleMap[facets.minutesRole] ?? 0.65) : 0.65;
    const qual = facets?.quality ? (qualityMap[facets.quality] ?? 0.65) : 0.65;
    const riskPenalty = Math.min((facets?.riskFlags?.length ?? 0) * 0.02, 0.06);
    const outlook = Math.max(0.2, (minRole * 0.7 + qual * 0.3) - riskPenalty);

    const appearances = facets?.recentAppearances ?? (entry.form.filter((p) => p > 0).length);
    const confidence = Math.min(appearances / 8, 1.0);
    const currentForm = formNorm(avgForm(entry.form));
    const calibre = valNorm(valueOf(entry));

    // When confidence is low (e.g. early season), anchor performance to player calibre
    // rather than falling back to current-season points ranks which distort the XI.
    const perf = confidence * currentForm + (1 - confidence) * calibre;

    const fitness = availabilityMap[entry.player.fpl_status ?? 'a'] ?? 0.90;

    // 65% market calibre anchor + 20% form/performance + 15% outlook quality
    const composite = (0.65 * calibre + 0.20 * perf + 0.15 * outlook) * fitness;
    scores[entry.id] = composite;
  });

  return scores;
}

export function projectedLineup(entries: SquadEntry[], preferredFormation?: Formation | null) {
  const eligible = lineupPool(entries).filter((entry) => entry.player.primary_position);
  const scores = projectedScores(eligible);
  const candidates = eligible.map((entry) => ({
    id: entry.player.id,
    score: scores[entry.id] ?? 0,
    positions: positionsOf(entry.player) as GranularPosition[],
  }));

  if (preferredFormation) {
    const forced = selectForFormation(candidates, preferredFormation);
    if (forced) return forced;
  }

  return selectBestLineup(candidates);
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
