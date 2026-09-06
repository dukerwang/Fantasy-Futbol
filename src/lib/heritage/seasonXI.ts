/**
 * src/lib/heritage/seasonXI.ts
 *
 * The Title-Winning XI: the side a champion actually fielded across a season.
 *
 * WHY IT IS DERIVED. Nothing in the schema stores "the squad that won it".
 * There is no end-of-season roster archive, and the champion's roster on the
 * final day is not the answer either — it misses the striker who carried thirty
 * gameweeks and was sold in March. What IS archived is the lineup of every
 * matchup (`season_matchups_archive.lineup_a/lineup_b`, migration 064), so the
 * XI is reconstructed from who actually started, slot by slot.
 *
 * THE METHOD. Take the club's most-used formation that season, then fill each
 * of its slots with the player who started there most often. Where a formation
 * repeats a slot — two CBs, two DMs — the openings go to the top N by
 * appearances in that slot, so one centre-back cannot take both.
 *
 * Only a COMPLETED season has archived lineups, so this returns null for the
 * season in progress. That is a real limit of the feature, not a bug to route
 * around: `matchups.lineup_a` exists for the live season, but a title-winning
 * XI for a title nobody has won yet is not a thing.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { FORMATION_SLOTS, type Formation, type GranularPosition, type MatchupLineup } from '@/types';

export interface XIPlayer {
  playerId: string;
  name: string;
  slot: GranularPosition;
  /** Starts in this slot, for this club, that season. */
  appearances: number;
  points: number;
}

export interface SeasonXI {
  season: string;
  teamId: string;
  formation: Formation;
  /** Eleven players in FORMATION_SLOTS order. A slot nobody filled is dropped. */
  starters: XIPlayer[];
  /** Everyone else who started at least once, most-used first. */
  squad: XIPlayer[];
  playersUsed: number;
  /** Points scored by the eleven, in the gameweeks they started. */
  pointsFromXI: number;
}

/** One archived start: who, where, and in which gameweek. */
export interface StartRecord {
  playerId: string;
  slot: GranularPosition;
  gameweek: number;
}

/**
 * The pure half: given every start and the formations used, work out the XI.
 * Kept separate from the fetch so it can be tested without a database.
 */
export function deriveXI(
  starts: StartRecord[],
  formations: Formation[],
  pointsFor: (playerId: string, gameweek: number) => number,
): { formation: Formation; starters: Omit<XIPlayer, 'name'>[]; squad: Omit<XIPlayer, 'name'>[] } | null {
  if (!starts.length || !formations.length) return null;

  // Most-used formation. Ties break on the first seen, which is chronological.
  const fCount = new Map<Formation, number>();
  for (const f of formations) fCount.set(f, (fCount.get(f) ?? 0) + 1);
  const formation = [...fCount.entries()].sort((a, b) => b[1] - a[1])[0][0];

  const slots = FORMATION_SLOTS[formation] as GranularPosition[];

  // starts, indexed by slot then player.
  const bySlot = new Map<GranularPosition, Map<string, { apps: number; points: number }>>();
  for (const s of starts) {
    if (!bySlot.has(s.slot)) bySlot.set(s.slot, new Map());
    const m = bySlot.get(s.slot)!;
    const cur = m.get(s.playerId) ?? { apps: 0, points: 0 };
    cur.apps += 1;
    cur.points += pointsFor(s.playerId, s.gameweek);
    m.set(s.playerId, cur);
  }

  // How many openings each slot type has in this formation (CB × 2, and so on).
  const openings = new Map<GranularPosition, number>();
  for (const slot of slots) openings.set(slot, (openings.get(slot) ?? 0) + 1);

  const chosen = new Set<string>();
  const perSlot = new Map<GranularPosition, Omit<XIPlayer, 'name'>[]>();

  for (const [slot, count] of openings) {
    const ranked = [...(bySlot.get(slot) ?? new Map()).entries()]
      // Most starts wins the shirt; points break a tie, because two players
      // with nine starts each are separated by what they did with them.
      .sort((a, b) => b[1].apps - a[1].apps || b[1].points - a[1].points)
      .filter(([id]) => !chosen.has(id))
      .slice(0, count)
      .map(([playerId, v]) => {
        chosen.add(playerId);
        return { playerId, slot, appearances: v.apps, points: Math.round(v.points * 10) / 10 };
      });
    perSlot.set(slot, ranked);
  }

  // Emit in FORMATION_SLOTS order so the pitch renders without re-sorting.
  const starters: Omit<XIPlayer, 'name'>[] = [];
  const cursor = new Map<GranularPosition, number>();
  for (const slot of slots) {
    const i = cursor.get(slot) ?? 0;
    cursor.set(slot, i + 1);
    const p = perSlot.get(slot)?.[i];
    if (p) starters.push(p);
  }

  // Everyone else who started. A player who filled two different slots is
  // listed once, under the slot he filled most, but with ALL of his starts and
  // points — otherwise a utility player reads as two half-seasons.
  const rest = new Map<string, { slot: GranularPosition; slotApps: number; apps: number; points: number }>();
  for (const [slot, players] of bySlot) {
    for (const [playerId, v] of players) {
      if (chosen.has(playerId)) continue;
      const cur = rest.get(playerId);
      if (!cur) {
        rest.set(playerId, { slot, slotApps: v.apps, apps: v.apps, points: v.points });
        continue;
      }
      cur.apps += v.apps;
      cur.points += v.points;
      if (v.apps > cur.slotApps) {
        cur.slot = slot;
        cur.slotApps = v.apps;
      }
    }
  }

  const squad = [...rest.entries()]
    .map(([playerId, v]) => ({
      playerId,
      slot: v.slot,
      appearances: v.apps,
      points: Math.round(v.points * 10) / 10,
    }))
    .sort((a, b) => b.appearances - a.appearances || b.points - a.points);

  return { formation, starters, squad };
}

/**
 * The XI a club fielded in an archived season. Null for a season with no
 * archived lineups — including the one in progress.
 */
export async function loadSeasonXI(
  admin: SupabaseClient,
  leagueId: string,
  season: string,
  teamId: string,
): Promise<SeasonXI | null> {
  const { data: rows } = await admin
    .from('season_matchups_archive')
    .select('gameweek, team_a_id, team_b_id, lineup_a, lineup_b')
    .eq('league_id', leagueId)
    .eq('season', season)
    .or(`team_a_id.eq.${teamId},team_b_id.eq.${teamId}`);

  if (!rows || rows.length === 0) return null;

  const starts: StartRecord[] = [];
  const formations: Formation[] = [];

  for (const r of rows as any[]) {
    const lineup: MatchupLineup | null = r.team_a_id === teamId ? r.lineup_a : r.lineup_b;
    if (!lineup?.starters?.length) continue;
    if (lineup.formation) formations.push(lineup.formation);
    for (const s of lineup.starters) {
      if (!s?.player_id || !s?.slot) continue;
      starts.push({ playerId: s.player_id, slot: s.slot, gameweek: r.gameweek });
    }
  }

  if (!starts.length) return null;

  // Points for exactly those (player, gameweek) pairs. Paginated: a full
  // season for a 25-man squad is comfortably under a page, but
  // player_stats is one of the tables PostgREST silently truncates.
  const playerIds = [...new Set(starts.map((s) => s.playerId))];
  const points = new Map<string, number>();
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: stats } = await admin
      .from('player_stats')
      .select('player_id, gameweek, fantasy_points')
      .eq('season', season)
      .in('player_id', playerIds)
      .range(from, from + PAGE - 1);
    if (!stats || stats.length === 0) break;
    for (const s of stats as any[]) {
      points.set(`${s.player_id}::${s.gameweek}`, Number(s.fantasy_points ?? 0));
    }
    if (stats.length < PAGE) break;
  }

  const derived = deriveXI(
    starts,
    formations,
    (playerId, gameweek) => points.get(`${playerId}::${gameweek}`) ?? 0,
  );
  if (!derived) return null;

  const { data: players } = await admin
    .from('players')
    .select('id, name')
    .in('id', playerIds);
  const nameOf = new Map((players ?? []).map((p: any) => [p.id, p.name as string]));

  const withNames = <T extends { playerId: string }>(x: T) =>
    ({ ...x, name: nameOf.get(x.playerId) ?? 'Unknown' });

  const starters = derived.starters.map(withNames) as XIPlayer[];
  const squad = derived.squad.map(withNames) as XIPlayer[];

  return {
    season,
    teamId,
    formation: derived.formation,
    starters,
    squad,
    playersUsed: playerIds.length,
    pointsFromXI: Math.round(starters.reduce((n, p) => n + p.points, 0) * 10) / 10,
  };
}
