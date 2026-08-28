import {
  ALL_FORMATIONS,
  FORMATION_SLOTS,
  POSITION_FLEX_MAP,
} from '@/types';
import type { Formation, GranularPosition, MatchupLineup, BenchSlot, Player } from '@/types';
import { getPlayerDisplayName } from '@/lib/players/displayName';

export type LineupPlacement =
  | { kind: 'starter'; slot: GranularPosition }
  | { kind: 'bench'; slot: BenchSlot }
  | { kind: 'out' };

export function placementMapFromLineup(
  lineup: MatchupLineup | null | undefined,
): Map<string, LineupPlacement> {
  const m = new Map<string, LineupPlacement>();
  if (!lineup) return m;
  for (const s of lineup.starters ?? []) {
    if (s.player_id && s.slot) {
      m.set(s.player_id, { kind: 'starter', slot: s.slot });
    }
  }
  for (const b of lineup.bench ?? []) {
    if (b.player_id && b.slot) {
      m.set(b.player_id, { kind: 'bench', slot: b.slot as BenchSlot });
    }
  }
  return m;
}

export function placementMapFromPayload(
  starters: { player_id: string; slot: GranularPosition }[],
  bench: { player_id: string; slot: BenchSlot }[],
): Map<string, LineupPlacement> {
  const m = new Map<string, LineupPlacement>();
  for (const s of starters) {
    if (s.player_id && s.slot) {
      m.set(s.player_id, { kind: 'starter', slot: s.slot });
    }
  }
  for (const b of bench) {
    if (b.player_id && b.slot) {
      m.set(b.player_id, { kind: 'bench', slot: b.slot });
    }
  }
  return m;
}

export function placementKey(p: LineupPlacement | undefined): string {
  if (!p || p.kind === 'out') return 'out';
  return `${p.kind}:${p.slot}`;
}

/**
 * Returns whether all locked starters can be assigned to exact matching slots in the target formation.
 */
export function canFitLockedStartersIntoFormation(
  lockedStarters: Array<{ playerId: string; slot: GranularPosition }>,
  targetFormation: Formation,
): boolean {
  if (lockedStarters.length === 0) return true;

  const neededCounts: Partial<Record<GranularPosition, number>> = {};
  for (const s of lockedStarters) {
    neededCounts[s.slot] = (neededCounts[s.slot] ?? 0) + 1;
  }

  const targetSlots = FORMATION_SLOTS[targetFormation];
  const availableCounts: Partial<Record<GranularPosition, number>> = {};
  for (const pos of targetSlots) {
    availableCounts[pos] = (availableCounts[pos] ?? 0) + 1;
  }

  for (const [pos, needed] of Object.entries(neededCounts) as [GranularPosition, number][]) {
    if ((availableCounts[pos] ?? 0) < needed) {
      return false;
    }
  }

  return true;
}

/**
 * Evaluates all 12 formations against the current set of locked starters,
 * returning a map of disabled status and tooltip reasons.
 */
export function getFormationLockStatus(
  lockedStarters: Array<{ playerId: string; slot: GranularPosition }>,
  playerNames?: Map<string, string>,
): Record<Formation, { disabled: boolean; reason?: string }> {
  const result = {} as Record<Formation, { disabled: boolean; reason?: string }>;

  const neededCounts: Partial<Record<GranularPosition, number>> = {};
  const playersByPos: Partial<Record<GranularPosition, string[]>> = {};

  for (const s of lockedStarters) {
    neededCounts[s.slot] = (neededCounts[s.slot] ?? 0) + 1;
    if (!playersByPos[s.slot]) playersByPos[s.slot] = [];
    const pName = playerNames?.get(s.playerId) ?? s.playerId;
    playersByPos[s.slot]!.push(pName);
  }

  for (const f of ALL_FORMATIONS) {
    const targetSlots = FORMATION_SLOTS[f];
    const availableCounts: Partial<Record<GranularPosition, number>> = {};
    for (const pos of targetSlots) {
      availableCounts[pos] = (availableCounts[pos] ?? 0) + 1;
    }

    const missingReasons: string[] = [];
    for (const [pos, needed] of Object.entries(neededCounts) as [GranularPosition, number][]) {
      const avail = availableCounts[pos] ?? 0;
      if (avail < needed) {
        const names = playersByPos[pos]?.join(', ') ?? pos;
        missingReasons.push(
          `needs ${needed} ${pos} slot${needed > 1 ? 's' : ''} for locked player${needed > 1 ? 's' : ''} (${names}), but ${f} only has ${avail}`,
        );
      }
    }

    if (missingReasons.length > 0) {
      result[f] = {
        disabled: true,
        reason: `Cannot switch to ${f}: ${missingReasons.join('; ')}.`,
      };
    } else {
      result[f] = { disabled: false };
    }
  }

  return result;
}

function canPlayerPlaySlot(player: Player, slotPos: GranularPosition): boolean {
  const positions: GranularPosition[] = [
    player.primary_position,
    ...(player.secondary_positions ?? []),
  ];
  const allowed = POSITION_FLEX_MAP[slotPos];
  return positions.some((p) => allowed.includes(p));
}

/**
 * Deterministically maps starters when changing formations under smart-lock:
 * 1. Locked starters are pinned to their matching slot positions first.
 * 2. Unlocked starters are mapped to matching or eligible slots.
 */
export function assignStartersForFormation(
  currentAssignments: Record<number, string | null>,
  currentSlots: GranularPosition[],
  newFormation: Formation,
  lockedPlayerIds: Set<string>,
  playerMap: Map<string, { player: Player }>,
): Record<number, string | null> {
  const newSlots = FORMATION_SLOTS[newFormation];
  const newAssignments: Record<number, string | null> = {};
  for (let i = 0; i < newSlots.length; i++) newAssignments[i] = null;
  const usedPlayers = new Set<string>();

  // Pass 1: Pin locked starters to matching new slots
  for (let i = 0; i < currentSlots.length; i++) {
    const pid = currentAssignments[i];
    if (!pid || !lockedPlayerIds.has(pid)) continue;
    const requiredPos = currentSlots[i];

    const targetIdx = newSlots.findIndex(
      (pos, idx) => pos === requiredPos && newAssignments[idx] === null,
    );
    if (targetIdx !== -1) {
      newAssignments[targetIdx] = pid;
      usedPlayers.add(pid);
    }
  }

  // Pass 2: Map unlocked starters that previously held the same position
  const oldByPosition = new Map<GranularPosition, string[]>();
  for (let i = 0; i < currentSlots.length; i++) {
    const pid = currentAssignments[i];
    if (!pid || usedPlayers.has(pid)) continue;
    const pos = currentSlots[i];
    if (!oldByPosition.has(pos)) oldByPosition.set(pos, []);
    oldByPosition.get(pos)!.push(pid);
  }

  for (let i = 0; i < newSlots.length; i++) {
    if (newAssignments[i] !== null) continue;
    const slotPos = newSlots[i];
    const candidates = oldByPosition.get(slotPos) ?? [];
    const available = candidates.find((id) => {
      if (usedPlayers.has(id)) return false;
      const entry = playerMap.get(id);
      return entry ? canPlayerPlaySlot(entry.player, slotPos) : false;
    });
    if (available) {
      newAssignments[i] = available;
      usedPlayers.add(available);
    }
  }

  // Pass 3: Map remaining unlocked starters to any compatible slot
  const remainingUnlocked = Object.values(currentAssignments).filter(
    (id): id is string => id != null && !usedPlayers.has(id),
  );

  for (let i = 0; i < newSlots.length; i++) {
    if (newAssignments[i] !== null) continue;
    const slotPos = newSlots[i];
    const cand = remainingUnlocked.find((id) => {
      if (usedPlayers.has(id)) return false;
      const entry = playerMap.get(id);
      return entry ? canPlayerPlaySlot(entry.player, slotPos) : false;
    });
    if (cand) {
      newAssignments[i] = cand;
      usedPlayers.add(cand);
    }
  }

  return newAssignments;
}

export interface SmartLockValidationResult {
  valid: boolean;
  error?: string;
  lockedNames?: string[];
}

/**
 * Validates that every locked player maintains the exact same placement key
 * (starter:SLOT, bench:SLOT, or out) between the previous and new lineup.
 */
export function validateLineupSmartLock(
  prevLineup: MatchupLineup | null | undefined,
  starters: { player_id: string; slot: GranularPosition }[],
  bench: { player_id: string; slot: BenchSlot }[],
  lockedPlayerIds: Set<string>,
  playerMap: Map<string, any>,
  getPlayerName?: (p: any) => string,
): SmartLockValidationResult {
  if (!prevLineup || lockedPlayerIds.size === 0) {
    return { valid: true };
  }

  const prevMap = placementMapFromLineup(prevLineup);
  const newMap = placementMapFromPayload(starters, bench);
  const touched = new Set<string>([...prevMap.keys(), ...newMap.keys()]);
  const lockedViolations: string[] = [];

  for (const pid of touched) {
    if (!lockedPlayerIds.has(pid)) continue;
    const prevKey = placementKey(prevMap.get(pid));
    const nextKey = placementKey(newMap.get(pid));

    if (prevKey !== nextKey) {
      const entry = playerMap.get(pid);
      const player = entry?.player ?? entry;
      const name = getPlayerName
        ? getPlayerName(player)
        : player
          ? getPlayerDisplayName(player, 'initial_last')
          : pid;
      lockedViolations.push(name);
    }
  }

  if (lockedViolations.length > 0) {
    const uniqueNames = [...new Set(lockedViolations)];
    return {
      valid: false,
      error: `Cannot change lineup for players whose club has already kicked off: ${uniqueNames.join(', ')}`,
      lockedNames: uniqueNames,
    };
  }

  return { valid: true };
}
