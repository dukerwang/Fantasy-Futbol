import type { SupabaseClient } from '@supabase/supabase-js';
import {
  FORMATION_SLOTS,
  POSITION_FLEX_MAP,
  BENCH_FLEX_MAP,
} from '@/types';
import type { Formation, GranularPosition, MatchupLineup, BenchSlot } from '@/types';

type RosterRow = {
  player_id: string;
  status: string;
  player: {
    id: string;
    primary_position: GranularPosition;
    secondary_positions?: GranularPosition[] | null;
  };
};

// Prefer the league's default shape first — otherwise bots/backfills can "look wrong"
// even when a simpler valid XI exists.
const FORMATION_TRIAL_ORDER: Formation[] = [
  '4-3-3',
  '4-4-2',
  '4-1-4-1',
  '4-2-3-1',
  '3-4-3',
  '4-2-1-3',
];

/**
 * Build a valid MatchupLineup from a team's roster (excludes IR and taxi).
 * Used by bot-lineup cron and manual / cron backfills when matchup JSON is empty.
 */
export async function generateValidLineup(
  admin: SupabaseClient,
  teamId: string,
): Promise<{ lineup: MatchupLineup | null; debug: string }> {
  const { data: rosterData, error } = await admin
    .from('roster_entries')
    .select(
      `
            id, status, player_id,
            player:players(id, primary_position, secondary_positions, pl_team_id, is_active)
        `,
    )
    .eq('team_id', teamId);

  if (!rosterData) {
    return { lineup: null, debug: `roster query failed: ${error?.message}` };
  }

  if (rosterData.length === 0) {
    return { lineup: null, debug: 'no roster_entries found for team' };
  }

  const rows = rosterData as unknown as RosterRow[];

  const availableEntries = rows.filter(
    (e) =>
      e.status !== 'ir' &&
      e.status !== 'taxi' &&
      e.player?.primary_position,
  );

  const posCounts: Record<string, number> = {};
  availableEntries.forEach((e) => {
    const p = e.player.primary_position;
    posCounts[p] = (posCounts[p] || 0) + 1;
  });
  const posSummary = Object.entries(posCounts)
    .map(([p, c]) => `${p}:${c}`)
    .join(',');

  if (availableEntries.length === 0) {
    return {
      lineup: null,
      debug: `${rosterData.length} entries but 0 eligible (IR/taxi or missing primary_position)`,
    };
  }

  const getCat = (p: string) => {
    if (p === 'GK') return 'GK';
    if (['CB', 'LB', 'RB'].includes(p)) return 'DEF';
    if (['DM', 'CM', 'LM', 'RM', 'AM'].includes(p)) return 'MID';
    return 'ATT';
  };

  function positionsFor(e: RosterRow): GranularPosition[] {
    return [e.player.primary_position, ...(e.player.secondary_positions || [])];
  }

  function buildBenchForFormation(
    _formation: Formation,
    starters: { player_id: string; slot: GranularPosition }[],
  ): { player_id: string; slot: BenchSlot }[] | null {
    const usedIds = new Set(starters.map((s) => s.player_id));
    const remaining = availableEntries.filter((e) => !usedIds.has(e.player.id));
    if (remaining.length < 4) return null;

    const bench: { player_id: string; slot: BenchSlot }[] = [];
    const benchSlots: BenchSlot[] = ['DEF', 'MID', 'ATT', 'FLEX'];
    const pool = [...remaining];

    for (const bSlot of benchSlots) {
      const allowed = BENCH_FLEX_MAP[bSlot];
      const idx = pool.findIndex((e) => {
        const positions = positionsFor(e);
        return positions.some((p) => allowed.includes(p));
      });
      if (idx === -1) return null;
      const c = pool[idx]!;
      bench.push({ player_id: c.player.id, slot: bSlot });
      pool.splice(idx, 1);
    }

    return bench;
  }

  let bestLineup: MatchupLineup | null = null;

  for (const formation of FORMATION_TRIAL_ORDER) {
    const slots = FORMATION_SLOTS[formation];
    const starters: { player_id: string; slot: GranularPosition }[] = [];
    const usedIds = new Set<string>();

    for (const slotPos of slots) {
      const allowed = POSITION_FLEX_MAP[slotPos];
      const candidate = availableEntries.find((e) => {
        if (usedIds.has(e.player.id)) return false;
        return positionsFor(e).some((p: GranularPosition) => allowed.includes(p));
      });

      if (candidate) {
        starters.push({ player_id: candidate.player.id, slot: slotPos });
        usedIds.add(candidate.player.id);
      } else {
        starters.push({ player_id: '', slot: slotPos });
      }
    }

    for (let i = 0; i < starters.length; i++) {
      if (starters[i].player_id !== '') continue;
      const slotPos = starters[i].slot;
      const slotCat = getCat(slotPos);

      const candidate = availableEntries.find((e) => {
        if (usedIds.has(e.player.id)) return false;
        return getCat(e.player.primary_position) === slotCat;
      });

      if (candidate) {
        starters[i].player_id = candidate.player.id;
        usedIds.add(candidate.player.id);
      }
    }

    for (let i = 0; i < starters.length; i++) {
      if (starters[i].player_id !== '') continue;

      const candidate = availableEntries.find((e) => !usedIds.has(e.player.id));
      if (candidate) {
        starters[i].player_id = candidate.player.id;
        usedIds.add(candidate.player.id);
      }
    }

    if (!starters.every((s) => s.player_id !== '')) continue;

    const bench = buildBenchForFormation(formation, starters);
    if (!bench) continue;

    bestLineup = { formation, starters, bench };
    break;
  }

  return {
    lineup: bestLineup,
    debug: bestLineup
      ? `generated ${bestLineup.formation} [${posSummary}]`
      : `${availableEntries.length} players [${posSummary}] - no full XI + bench possible`,
  };
}
