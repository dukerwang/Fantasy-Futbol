/**
 * Round-robin schedule generator using the circle/polygon method.
 * Pure TypeScript — no DB or network calls.
 */

/**
 * Generates one full rotation of round-robin matchups.
 * - Even N: produces N−1 rounds, N/2 pairs each.
 * - Odd N: adds a virtual BYE team → N rounds; the team paired with BYE sits out.
 *
 * Returns an array of rounds, each round being an array of [teamA, teamB] pairs.
 */
export function roundRobinRounds(teamIds: string[]): [string, string][][] {
  const circle = [...teamIds];

  // Pad to even length with a BYE sentinel
  if (circle.length % 2 !== 0) circle.push('__BYE__');

  const total = circle.length;
  const numRounds = total - 1;
  const rounds: [string, string][][] = [];

  for (let r = 0; r < numRounds; r++) {
    const pairs: [string, string][] = [];

    for (let i = 0; i < total / 2; i++) {
      const a = circle[i];
      const b = circle[total - 1 - i];
      // Skip BYE pairings
      if (a !== '__BYE__' && b !== '__BYE__') {
        pairs.push([a, b]);
      }
    }

    rounds.push(pairs);

    // Rotate: fix circle[0], move circle[total-1] to position 1
    const last = circle[total - 1];
    for (let i = total - 1; i > 1; i--) {
      circle[i] = circle[i - 1];
    }
    circle[1] = last;
  }

  return rounds;
}

/**
 * Builds a full GW schedule from startGw to endGw (inclusive).
 * - Repeats rotations until all GWs are filled.
 * - Shuffles round order within each rotation for variety.
 * - Flips home/away on every other rotation.
 *
 * Returns [] if startGw > endGw or fewer than 2 teams.
 */
export function buildSchedule(
  teamIds: string[],
  startGw: number,
  endGw = 38,
): { gw: number; pairs: [string, string][] }[] {
  if (startGw > endGw || teamIds.length < 2) return [];

  const baseRounds = roundRobinRounds(teamIds);
  if (baseRounds.length === 0) return [];

  const result: { gw: number; pairs: [string, string][] }[] = [];
  let gw = startGw;
  let rotation = 0;

  while (gw <= endGw) {
    // Shuffle round indices for this rotation
    const indices = shuffleArray(baseRounds.map((_, i) => i));
    const flip = rotation % 2 === 1;

    for (const roundIdx of indices) {
      if (gw > endGw) break;
      const round = baseRounds[roundIdx];
      const pairs: [string, string][] = flip
        ? round.map(([a, b]) => [b, a])
        : [...round.map(([a, b]) => [a, b] as [string, string])];

      result.push({ gw, pairs });
      gw++;
    }

    rotation++;
  }

  return result;
}

function shuffleArray<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
