import type { Formation, GranularPosition, MatchupLineup } from '@/types';
import { FORMATION_SLOTS, inferFormationFromStarterSlots } from '@/types';

function sortedSlots(slots: GranularPosition[]): string {
  return JSON.stringify([...slots].sort());
}

function countSlots(slots: GranularPosition[]): Record<GranularPosition, number> {
  const out: Partial<Record<GranularPosition, number>> = {};
  for (const s of slots) out[s] = (out[s] ?? 0) + 1;
  return out as Record<GranularPosition, number>;
}

function isLegacyFourTwoThreeOneLwRwSlotMultiset(slots: GranularPosition[]): boolean {
  const c = countSlots(slots);
  return (
    (c.GK ?? 0) === 1 &&
    (c.LB ?? 0) === 1 &&
    (c.RB ?? 0) === 1 &&
    (c.CB ?? 0) === 2 &&
    (c.LW ?? 0) === 1 &&
    (c.RW ?? 0) === 1 &&
    (c.DM ?? 0) === 2 &&
    (c.AM ?? 0) === 1 &&
    (c.ST ?? 0) === 1
  );
}

function remapLegacyFourTwoThreeOneLwRwStarters(
  starters: { player_id: string; slot: GranularPosition }[],
): { player_id: string; slot: GranularPosition }[] {
  return starters.map((s) => {
    if (s.slot === 'LW') return { ...s, slot: 'LM' };
    if (s.slot === 'RW') return { ...s, slot: 'RM' };
    return s;
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

  // 1) Migrate a brief incorrect template for 4-2-3-1 that used LW/RW instead of LM/RM.
  //    This keeps stored player assignments identical — only the slot labels change.
  let starters = lineup.starters;
  const starterSlots = starters.map((s) => s.slot);
  if (lineup.formation === '4-2-3-1' && isLegacyFourTwoThreeOneLwRwSlotMultiset(starterSlots)) {
    starters = remapLegacyFourTwoThreeOneLwRwStarters(starters);
  }

  let next: MatchupLineup = { ...lineup, starters };

  const formation = next.formation;
  const expected = sortedSlots(FORMATION_SLOTS[formation]);
  const given = sortedSlots(next.starters.map((s) => s.slot));

  if (expected === given) return next;

  const inferred = inferFormationFromStarterSlots(next.starters);
  if (!inferred) return next;

  return { ...next, formation: inferred };
}
