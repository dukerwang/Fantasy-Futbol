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
  const seeding = getSeeding(bracketSize);
  
  for (let i = 0; i < teams.length; i++) {
    const seed = teams[i].seed;
    const slotIdx = seeding.indexOf(seed);
    if (slotIdx !== -1) {
      slots[slotIdx] = teams[i].teamId;
    }
  }

  return slots;
}

/** Standard tournament seed ordering algorithm */
function getSeeding(bracketSize: number): number[] {
  if (bracketSize === 1) return [1];
  let rounds = Math.log2(bracketSize);
  let pls = [1, 2];
  for (let i = 1; i < rounds; i++) {
    let nextLayer: number[] = [];
    let length = pls.length * 2 + 1;
    pls.forEach((d) => {
      nextLayer.push(d);
      nextLayer.push(length - d);
    });
    pls = nextLayer;
  }
  return pls;
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

export function buildRoundSpecs(
  bracketSize: number,
  type: TournamentType,
  totalLeagueTeams: number,
): RoundSpec[] {
  const totalRounds = Math.log2(bracketSize);
  const rounds: RoundSpec[] = [];

  for (let i = 0; i < totalRounds; i++) {
    const matchCount = bracketSize / Math.pow(2, i + 1);
    const isFinal = i === totalRounds - 1;
    const name = roundName(bracketSize, i, totalRounds);

    let startGw = 0;
    let endGw = 0;
    let isTwoLeg = false;

    if (type === 'secondary_cup') {
      // LEAGUE CUP: R16 (MW9), QF (MW16), SF (MW21 & MW24), Final (MW31)
      // Because bracket size could be less than 16, we align from the Final backwards.
      const roundOffsetFromFinal = totalRounds - 1 - i; 
      if (roundOffsetFromFinal === 0) { // Final
        startGw = 31; endGw = 31; isTwoLeg = false;
      } else if (roundOffsetFromFinal === 1) { // SF
        startGw = 21; endGw = 24; isTwoLeg = true;
      } else if (roundOffsetFromFinal === 2) { // QF
        startGw = 16; endGw = 16; isTwoLeg = false;
      } else if (roundOffsetFromFinal === 3) { // R16
        startGw = 9; endGw = 9; isTwoLeg = false;
      } else { // R32 or beyond (fallback)
        startGw = 1; endGw = 1; isTwoLeg = false;
      }
    } else if (type === 'primary_cup') {
      // CHAMPIONS CUP: QF (32-33), SF (34-35), Final (38)
      isTwoLeg = !isFinal;
      const roundOffsetFromFinal = totalRounds - 1 - i;
      if (roundOffsetFromFinal === 0) { // Final
        startGw = 38; endGw = 38;
      } else if (roundOffsetFromFinal === 1) { // SF
        startGw = 34; endGw = 35;
      } else if (roundOffsetFromFinal === 2) { // QF
        startGw = 32; endGw = 33;
      } else { // R16 (fallback)
        startGw = 30; endGw = 31;
      }
    } else if (type === 'consolation_cup') {
      // EUROPA CUP
      isTwoLeg = !isFinal;
      const roundOffsetFromFinal = totalRounds - 1 - i;
      
      if (totalLeagueTeams >= 7) {
        // 7-10 teams from standings (7-10 has 2 teams from bottom natively) OR
        // Wait, 7 teams has Europa fed by eliminations, so it generates 5 teams -> 4 teams effectively?
        // But the backend `buildRoundSpecs` determines the framework size!
        // If the bracketSize is generated correctly externally, we map its rounds perfectly.
        if (roundOffsetFromFinal === 0) { // Final
          startGw = 38; endGw = 38;
        } else if (roundOffsetFromFinal === 1) { // SF
          startGw = 36; endGw = 37;
        } else if (roundOffsetFromFinal === 2) { // QF
          startGw = 34; endGw = 35;
        }
      } else {
        // 4-6 teams (where Europa is purely fed by SF eliminations into a single match, except maybe 5 teams which has QF fed)
        // Just map from Final backwards:
        if (roundOffsetFromFinal === 0) { // Final
          startGw = 38; endGw = 38;
        } else if (roundOffsetFromFinal === 1) { // SF
          startGw = 36; endGw = 37;
        }
      }
    }

    rounds.push({
      name,
      roundNumber: i + 1,
      startGameweek: startGw,
      endGameweek: endGw,
      isTwoLeg,
      matchCount,
    });
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
