import type { Formation, GranularPosition, MatchupLineup } from '@/types';
import { FORMATION_SLOTS, inferFormationFromStarterSlots } from '@/types';

function sortedSlots(slots: GranularPosition[]): string {
  return JSON.stringify([...slots].sort());
}

function migrateLegacyWideMidfielders(
  starters: { player_id: string; slot: string | GranularPosition }[],
): { player_id: string; slot: GranularPosition }[] {
  return starters.map((s) => {
    if (s.slot === 'LM') return { ...s, slot: 'LW' };
    if (s.slot === 'RM') return { ...s, slot: 'RW' };
    return s as { player_id: string; slot: GranularPosition };
  });
}

/**
 * Some historical rows can have `formation` disagree with the multiset of starter `slot`s
 * (usually due to a bad formation template in an older build). When that happens, infer
 * the formation from the slots so UI + scoring stay consistent.
 */
export function normalizeMatchupLineup(lineup: MatchupLineup | null): MatchupLineup | null {
  if (!lineup) return null;
  if (!Array.isArray(lineup.starters) || lineup.starters.length !== 11) return lineup;

  // 1) Migrate legacy LM/RM slots to LW/RW
  let starters = migrateLegacyWideMidfielders(lineup.starters);

  let next: MatchupLineup = { ...lineup, starters };

  const formation = next.formation;
  const expected = sortedSlots(FORMATION_SLOTS[formation]);
  const given = sortedSlots(next.starters.map((s) => s.slot));

  if (expected === given) return next;

  const inferred = inferFormationFromStarterSlots(next.starters);
  if (!inferred) return next;

  return { ...next, formation: inferred };
}
