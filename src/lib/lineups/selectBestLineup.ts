import {
  ALL_FORMATIONS,
  BENCH_FLEX_MAP,
  FORMATION_SLOTS,
  type BenchSlot,
  type Formation,
  type GranularPosition,
} from '@/types';

export interface FormationCandidate {
  id: string;
  /** The value to maximise, such as gameweek points or the club overall score. */
  score: number;
  /** Primary and secondary positions. A candidate can only fill one of these exact slots. */
  positions: GranularPosition[];
}

export interface SelectedStarter {
  playerId: string;
  slot: GranularPosition;
}

export interface BestLineup {
  formation: Formation;
  starters: SelectedStarter[];
  bench: Record<BenchSlot, string | null>;
  totalScore: number;
}

type Edge = {
  to: number;
  rev: number;
  capacity: number;
  cost: number;
};

const BENCH_SLOTS: BenchSlot[] = ['DEF', 'MID', 'ATT', 'FLEX'];
const SCORE_SCALE = 10_000;

function addEdge(graph: Edge[][], from: number, to: number, capacity: number, cost: number) {
  const forward: Edge = { to, rev: graph[to].length, capacity, cost };
  const reverse: Edge = { to: from, rev: graph[from].length, capacity: 0, cost: -cost };
  graph[from].push(forward);
  graph[to].push(reverse);
}

/**
 * Finds the highest-scoring assignment for one formation. This is a small
 * max-cost flow problem: a player can take one slot, each slot needs one
 * player, and a path only exists when an exact primary or secondary position
 * matches that slot.
 */
export function selectForFormation(candidates: FormationCandidate[], formation: Formation): BestLineup | null {
  const players = candidates
    .filter((candidate) => Number.isFinite(candidate.score) && candidate.positions.length > 0)
    .slice()
    .sort((a, b) => a.id.localeCompare(b.id));
  const slots = FORMATION_SLOTS[formation];
  const source = 0;
  const playerStart = 1;
  const slotStart = playerStart + players.length;
  const sink = slotStart + slots.length;
  const graph: Edge[][] = Array.from({ length: sink + 1 }, () => []);

  players.forEach((player, index) => {
    const playerNode = playerStart + index;
    // A score cent outweighs every deterministic tie value across an XI.
    const value = Math.round(player.score * 100) * SCORE_SCALE - index;
    addEdge(graph, source, playerNode, 1, 0);
    slots.forEach((slot, slotIndex) => {
      if (player.positions.includes(slot)) {
        addEdge(graph, playerNode, slotStart + slotIndex, 1, value);
      }
    });
  });
  slots.forEach((_, slotIndex) => addEdge(graph, slotStart + slotIndex, sink, 1, 0));

  let flow = 0;
  while (flow < slots.length) {
    const distance = Array<number>(graph.length).fill(Number.NEGATIVE_INFINITY);
    const previousNode = Array<number>(graph.length).fill(-1);
    const previousEdge = Array<number>(graph.length).fill(-1);
    const queued = Array<boolean>(graph.length).fill(false);
    const queue = [source];
    distance[source] = 0;
    queued[source] = true;

    while (queue.length > 0) {
      const node = queue.shift()!;
      queued[node] = false;
      graph[node].forEach((edge, edgeIndex) => {
        if (edge.capacity === 0 || distance[node] === Number.NEGATIVE_INFINITY) return;
        const next = distance[node] + edge.cost;
        if (next <= distance[edge.to]) return;
        distance[edge.to] = next;
        previousNode[edge.to] = node;
        previousEdge[edge.to] = edgeIndex;
        if (!queued[edge.to]) {
          queue.push(edge.to);
          queued[edge.to] = true;
        }
      });
    }

    if (previousNode[sink] === -1) return null;
    for (let node = sink; node !== source; node = previousNode[node]) {
      const parent = previousNode[node];
      const edge = graph[parent][previousEdge[node]];
      edge.capacity -= 1;
      graph[node][edge.rev].capacity += 1;
    }
    flow += 1;
  }

  const startersBySlot: Array<SelectedStarter | null> = Array(slots.length).fill(null);
  players.forEach((player, playerIndex) => {
    const playerNode = playerStart + playerIndex;
    graph[playerNode].forEach((edge) => {
      if (edge.to < slotStart || edge.to >= sink || edge.capacity !== 0) return;
      const slotIndex = edge.to - slotStart;
      startersBySlot[slotIndex] = { playerId: player.id, slot: slots[slotIndex] };
    });
  });

  const starters = startersBySlot.filter((starter): starter is SelectedStarter => starter !== null);
  if (starters.length !== slots.length) return null;
  const starterIds = new Set(starters.map((starter) => starter.playerId));
  const bench = selectBench(players, starterIds);
  const scoreById = new Map(players.map((player) => [player.id, player.score]));

  return {
    formation,
    starters,
    bench,
    totalScore: starters.reduce((total, starter) => total + (scoreById.get(starter.playerId) ?? 0), 0),
  };
}

function selectBench(candidates: FormationCandidate[], starterIds: Set<string>): Record<BenchSlot, string | null> {
  const available = candidates
    .filter((candidate) => !starterIds.has(candidate.id))
    .slice()
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const bench = Object.fromEntries(BENCH_SLOTS.map((slot) => [slot, null])) as Record<BenchSlot, string | null>;

  for (const slot of BENCH_SLOTS) {
    const index = available.findIndex((candidate) =>
      candidate.positions.some((position) => BENCH_FLEX_MAP[slot].includes(position)),
    );
    if (index < 0) continue;
    bench[slot] = available[index].id;
    available.splice(index, 1);
  }

  return bench;
}

/**
 * Returns the legal formation with the highest aggregate candidate score.
 * `ALL_FORMATIONS` is the tie-breaker, preserving a stable first match.
 */
export function selectBestLineup(candidates: FormationCandidate[]): BestLineup | null {
  let best: BestLineup | null = null;
  for (const formation of ALL_FORMATIONS) {
    const result = selectForFormation(candidates, formation);
    if (result && (!best || result.totalScore > best.totalScore)) best = result;
  }
  return best;
}
