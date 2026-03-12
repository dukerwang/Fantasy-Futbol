/**
 * Tournament Engine — bracket generation, seeding, bye assignment, and advancement.
 */
import type { TournamentType } from '@/types';

// ─── Helpers ──────────────────────────────────────────────────

/** Next power of 2 ≥ n */
export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return p;
}

/** Standard round name for a bracket of `total` slots at depth `roundIdx` (0-based from first round). */
export function roundName(totalSlots: number, roundIdx: number, totalRounds: number): string {
  const remaining = totalSlots / Math.pow(2, roundIdx);
  if (roundIdx === totalRounds - 1) return 'Final';
  if (remaining === 4) return 'Semi-Final';
  if (remaining === 8) return 'Quarter-Final';
  return `Round of ${remaining}`;
}

// ─── Seeding ──────────────────────────────────────────────────

export interface SeedEntry {
  teamId: string;
  seed: number; // 1 = best
}

/**
 * Given a list of team IDs ordered by seed (index 0 = seed 1),
 * produce a bracket-ordered array of size `bracketSize` (power of 2).
 * Empty slots (byes) are represented by `null`.
 *
 * Uses standard tournament seeding (1v16, 8v9, 5v12, 4v13, …)
 * so higher seeds face lower seeds and byes go to the top.
 */
export function seedBracket(teams: SeedEntry[], bracketSize: number): (string | null)[] {
  const slots: (string | null)[] = new Array(bracketSize).fill(null);

  // Standard seeding order for powers of 2
  const order = seedOrder(bracketSize);
  for (let i = 0; i < teams.length; i++) {
    slots[order[i]] = teams[i].teamId;
  }

  return slots;
}

/** Recursive standard tournament seed ordering. */
function seedOrder(size: number): number[] {
  if (size === 1) return [0];
  const half = seedOrder(size / 2);
  const result: number[] = [];
  for (const pos of half) {
    result.push(pos * 2);
    result.push(pos * 2 + 1);
  }
  return result;
}

// ─── Round Schedule ───────────────────────────────────────────

export interface RoundSpec {
  name: string;
  roundNumber: number;
  startGameweek: number;
  endGameweek: number;
  isTwoLeg: boolean;
  matchCount: number;
}

/**
 * Build round specs for a tournament.
 *
 * @param bracketSize  Power-of-2 bracket size
 * @param startGw      First gameweek of the tournament
 * @param type         Tournament type (affects leg format)
 */
export function buildRoundSpecs(
  bracketSize: number,
  startGw: number,
  type: TournamentType,
): RoundSpec[] {
  const totalRounds = Math.log2(bracketSize);
  const rounds: RoundSpec[] = [];
  let gw = startGw;

  for (let i = 0; i < totalRounds; i++) {
    const matchCount = bracketSize / Math.pow(2, i + 1);
    const isFinal = i === totalRounds - 1;

    // Primary cup: 2-leg except Final; Secondary cup: all single-leg; Consolation: 2-leg except Final
    let isTwoLeg = false;
    if (type === 'primary_cup' && !isFinal) isTwoLeg = true;
    if (type === 'consolation_cup' && !isFinal) isTwoLeg = true;
    // secondary_cup is always single-leg

    const name = roundName(bracketSize, i, totalRounds);
    const endGw = isTwoLeg ? gw + 1 : gw;

    rounds.push({
      name,
      roundNumber: i + 1,
      startGameweek: gw,
      endGameweek: endGw,
      isTwoLeg,
      matchCount,
    });

    gw = endGw + 1; // next round starts after this one ends
  }

  return rounds;
}

// ─── Tiebreaker ───────────────────────────────────────────────

/**
 * Tiebreaker: the team whose starting XI contains the highest-scoring individual player wins.
 * Returns the winning team_id, or null if still tied (shouldn't happen in practice).
 *
 * @param teamAPlayers  Array of { playerId, points } for team A's starting XI
 * @param teamBPlayers  Array of { playerId, points } for team B's starting XI
 * @param teamAId       Team A's ID
 * @param teamBId       Team B's ID
 */
export function resolveTiebreaker(
  teamAPlayers: { playerId: string; points: number }[],
  teamBPlayers: { playerId: string; points: number }[],
  teamAId: string,
  teamBId: string,
): string | null {
  const maxA = Math.max(0, ...teamAPlayers.map(p => p.points));
  const maxB = Math.max(0, ...teamBPlayers.map(p => p.points));

  if (maxA > maxB) return teamAId;
  if (maxB > maxA) return teamBId;
  return null; // true tie — extremely rare
}
