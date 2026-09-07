import type { GranularPosition } from '@/types';

/**
 * The position filter vocabulary shared by every players-pool view (table,
 * cards, explorer). A SELECT of fifteen options, not twelve chips — see
 * stats.module.css's header comment for why the four groups and two
 * cross-cuts (wide defenders, wingers) don't collapse onto the taxonomy.
 */
export type PosFilter = 'ALL' | 'GK' | 'DEF' | 'MID' | 'ATT' | 'WIDE_DEF' | 'WING' | GranularPosition;

const DEF_POSITIONS: GranularPosition[] = ['CB', 'LB', 'RB', 'LWB', 'RWB'];
const MID_POSITIONS: GranularPosition[] = ['DM', 'CM', 'AM'];
const ATT_POSITIONS: GranularPosition[] = ['LW', 'RW', 'ST'];
const WIDE_DEF_POSITIONS: GranularPosition[] = ['LB', 'RB', 'LWB', 'RWB'];
const WING_POSITIONS: GranularPosition[] = ['LW', 'RW'];

export const POS_FILTER_OPTIONS: { label: string; value: PosFilter }[] = [
  { label: 'All positions', value: 'ALL' },
  { label: 'GK', value: 'GK' },
  { label: 'DEF (CB/LB/RB/LWB/RWB)', value: 'DEF' },
  { label: 'Wide defenders (LB/RB/LWB/RWB)', value: 'WIDE_DEF' },
  { label: 'MID (DM/CM/AM)', value: 'MID' },
  { label: 'ATT (LW/RW/ST)', value: 'ATT' },
  { label: 'Wingers (LW/RW)', value: 'WING' },
  ...(['CB', 'LB', 'RB', 'LWB', 'RWB', 'DM', 'CM', 'AM', 'LW', 'RW', 'ST'] as GranularPosition[]).map((p) => ({
    label: p,
    value: p as PosFilter,
  })),
];

export function groupContains(group: PosFilter, pos: GranularPosition): boolean {
  if (group === 'ALL') return true;
  if (group === 'GK') return pos === 'GK';
  if (group === 'DEF') return DEF_POSITIONS.includes(pos);
  if (group === 'MID') return MID_POSITIONS.includes(pos);
  if (group === 'ATT') return ATT_POSITIONS.includes(pos);
  if (group === 'WIDE_DEF') return WIDE_DEF_POSITIONS.includes(pos);
  if (group === 'WING') return WING_POSITIONS.includes(pos);
  return pos === group;
}

export type PosType = 'primary' | 'secondary' | 'both';

interface PositionLike {
  primary_position: GranularPosition | null;
  secondary_positions: GranularPosition[];
}

/**
 * Resolves which of a player's positions counts as the "active" one under a
 * filter — the position his row's stats get shadow-mapped against. Shared by
 * every players-pool view so table and card filtering can't drift apart.
 */
export function resolveActivePosition(
  player: PositionLike,
  posFilter: PosFilter,
  posType: PosType
): GranularPosition | 'N/A' | null {
  const primary = player.primary_position;
  const secondaries = player.secondary_positions ?? [];

  if (!primary) {
    if (posFilter === 'ALL') return 'N/A';
    return null;
  }

  if (posType === 'primary') {
    if (groupContains(posFilter, primary)) {
      return primary;
    }
  } else if (posType === 'secondary') {
    const match = secondaries.find((pos) => groupContains(posFilter, pos));
    if (match) return match;
  } else if (posType === 'both') {
    if (groupContains(posFilter, primary)) {
      return primary;
    }
    const match = secondaries.find((pos) => groupContains(posFilter, pos));
    if (match) return match;
  }
  return null;
}
