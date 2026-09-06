/**
 * src/lib/heritage/honoursBoard.ts
 *
 * The honours board: every club in the league with what it has won, most
 * decorated first. Heritage's centrepiece.
 *
 * Thin on purpose — `getClubHonours` already pivots the season archives into
 * per-club honours, and `groupHonours` already groups them by competition.
 * This adds the league-wide ordering, the totals, and the reigning champion,
 * which is all the board itself needs.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { getClubHonours, groupHonours, type HonourGroup } from '@/lib/honours/getClubHonours';
import type { CrestConfig } from '@/components/crest/types';

export interface BoardClub {
  teamId: string;
  teamName: string;
  managerName: string | null;
  crestConfig: CrestConfig | null;
  honours: HonourGroup[];
  /** Every trophy as its own object, newest first — the board draws one pip each. */
  trophies: { kind: HonourGroup['kind']; season: string }[];
  total: number;
}

export interface HonoursBoard {
  clubs: BoardClub[];
  totalTrophies: number;
  /** Seasons that have actually been archived, newest first. */
  seasons: string[];
}

/**
 * Ordered by weight of silverware. Ties break on league titles first — two
 * clubs on three trophies are not level if one of them has the 38-matchweek
 * prize and the other has three consolation cups — then alphabetically, so the
 * order is stable rather than dependent on row order from the database.
 */
function byWeight(a: BoardClub, b: BoardClub): number {
  if (b.total !== a.total) return b.total - a.total;
  const titles = (c: BoardClub) => c.trophies.filter((t) => t.kind === 'league_title').length;
  if (titles(b) !== titles(a)) return titles(b) - titles(a);
  return a.teamName.localeCompare(b.teamName);
}

export async function loadHonoursBoard(
  admin: SupabaseClient,
  leagueId: string,
): Promise<HonoursBoard> {
  const { data: teams } = await admin
    .from('teams')
    .select('id, team_name, crest_config, user:users!user_id(username)')
    .eq('league_id', leagueId)
    .order('team_name');

  const rows = (teams ?? []) as any[];
  if (rows.length === 0) return { clubs: [], totalTrophies: 0, seasons: [] };

  // One batched call for the whole league, not one per club.
  const byTeam = await getClubHonours(admin, leagueId, rows.map((t) => t.id));

  const seasons = new Set<string>();
  const clubs: BoardClub[] = rows.map((t) => {
    const honours = byTeam.get(t.id) ?? [];
    for (const h of honours) seasons.add(h.season);
    const trophies = [...honours]
      .sort((x, y) => y.season.localeCompare(x.season))
      .map((h) => ({ kind: h.kind, season: h.season }));
    return {
      teamId: t.id,
      teamName: t.team_name,
      managerName: t.user?.username ?? null,
      crestConfig: t.crest_config ?? null,
      honours: groupHonours(honours),
      trophies,
      total: trophies.length,
    };
  });

  clubs.sort(byWeight);

  return {
    clubs,
    totalTrophies: clubs.reduce((n, c) => n + c.total, 0),
    seasons: [...seasons].sort((a, b) => b.localeCompare(a)),
  };
}

/**
 * The club that won the most recent archived league title, with the season it
 * won. Null until a season has actually been archived — during a league's
 * first season nobody is champion of anything, and saying so is better than
 * showing the current table-topper as though they had won it.
 */
export function reigningChampion(board: HonoursBoard): { club: BoardClub; season: string } | null {
  let best: { club: BoardClub; season: string } | null = null;
  for (const club of board.clubs) {
    for (const t of club.trophies) {
      if (t.kind !== 'league_title') continue;
      if (!best || t.season.localeCompare(best.season) > 0) best = { club, season: t.season };
    }
  }
  return best;
}
