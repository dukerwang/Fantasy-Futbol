/**
 * src/lib/honours/getClubHonours.ts
 *
 * Gaffa — club honours (the trophy cabinet's data layer).
 *
 * Pivots the season archives from "what happened in season X" (which the league
 * history page already renders) into "what has this club won", which nothing
 * showed before.
 *
 * WINNERS ONLY. No runners-up, no podium, no tier or rank field: each
 * competition is its own designed object, so ranking them here would only
 * invite the UI to render a medal ramp instead of the trophies.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type HonourKind =
  | 'league_title'
  | 'champions_cup'
  | 'league_cup'
  | 'consolation_cup';

export interface Honour {
  season: string;
  kind: HonourKind;
  /** What the competition was called in that season, as archived. */
  label: string;
  awardedAt: string | null;
}

/** One competition a club has won, with every season it won it. */
export interface HonourGroup {
  kind: HonourKind;
  label: string;
  count: number;
  /** Newest first. */
  seasons: string[];
}

/**
 * Display order, and the order trophies stand in the cabinet. The league title
 * leads because it is the 38-matchweek prize; the cups follow in prize order
 * (see DEFAULT_PRIZE_CONFIG in src/lib/offseason/prizeDistribution.ts).
 */
export const HONOUR_ORDER: HonourKind[] = [
  'league_title',
  'champions_cup',
  'league_cup',
  'consolation_cup',
];

export const HONOUR_LABELS: Record<HonourKind, string> = {
  league_title: 'League Title',
  champions_cup: 'Champions Cup',
  league_cup: 'League Cup',
  consolation_cup: 'Consolation Cup',
};

const TYPE_TO_KIND: Record<string, HonourKind> = {
  primary_cup: 'champions_cup',
  secondary_cup: 'league_cup',
  consolation_cup: 'consolation_cup',
};

/**
 * Fallback for archive rows written before migration 143 added
 * `tournament_type`. The three names are hardcoded in createTournaments.ts.
 */
const NAME_TO_KIND: Record<string, HonourKind> = {
  'Champions Cup': 'champions_cup',
  'League Cup': 'league_cup',
  'Consolation Cup': 'consolation_cup',
};

/**
 * Every honour won by each of `teamIds`, keyed by team id. Batched rather than
 * per-club so a page listing every club in the league costs two queries, not
 * two per club.
 *
 * Teams with nothing get an empty array, never a missing key.
 */
export async function getClubHonours(
  admin: SupabaseClient,
  leagueId: string,
  teamIds: string[],
): Promise<Map<string, Honour[]>> {
  const out = new Map<string, Honour[]>();
  for (const id of teamIds) out.set(id, []);
  if (teamIds.length === 0) return out;

  const [cupsRes, titlesRes, liveTitle] = await Promise.all([
    admin
      .from('season_cup_winners_archive')
      .select('season, tournament_name, tournament_type, winner_id, created_at')
      .eq('league_id', leagueId)
      .in('winner_id', teamIds),
    admin
      .from('season_standings_archive')
      .select('season, team_id, archived_at')
      .eq('league_id', leagueId)
      .eq('final_rank', 1)
      .in('team_id', teamIds),
    resolveLiveTitle(admin, leagueId),
  ]);

  type CupRow = {
    season: string; tournament_name: string | null;
    tournament_type: string | null; winner_id: string; created_at: string | null;
  };
  for (const row of (cupsRes.data ?? []) as CupRow[]) {
    const kind =
      TYPE_TO_KIND[row.tournament_type ?? ''] ?? NAME_TO_KIND[row.tournament_name ?? ''];
    if (!kind) continue; // A renamed cup with no type is not something to guess at.
    out.get(row.winner_id)?.push({
      season: row.season,
      kind,
      label: row.tournament_name ?? HONOUR_LABELS[kind],
      awardedAt: row.created_at ?? null,
    });
  }

  const titleSeasons = new Set<string>();
  type TitleRow = { season: string; team_id: string; archived_at: string | null };
  for (const row of (titlesRes.data ?? []) as TitleRow[]) {
    titleSeasons.add(`${row.team_id}|${row.season}`);
    out.get(row.team_id)?.push({
      season: row.season,
      kind: 'league_title',
      label: HONOUR_LABELS.league_title,
      awardedAt: row.archived_at ?? null,
    });
  }

  // See resolveLiveTitle: the current season's champion in the gap between the
  // last matchweek resolving and the reset running.
  if (liveTitle && teamIds.includes(liveTitle.teamId)) {
    if (!titleSeasons.has(`${liveTitle.teamId}|${liveTitle.season}`)) {
      out.get(liveTitle.teamId)?.push({
        season: liveTitle.season,
        kind: 'league_title',
        label: HONOUR_LABELS.league_title,
        awardedAt: null,
      });
    }
  }

  for (const list of out.values()) {
    list.sort((a, b) => (a.season === b.season ? 0 : a.season < b.season ? 1 : -1));
  }
  return out;
}

/**
 * The current season's champion, in the window between the last matchweek
 * resolving and the reset actually running — weeks, not days. Standings cannot
 * move once every matchup is complete, so nothing shown here can change
 * retroactively once shown.
 *
 * DO NOT reintroduce `league.status === 'offseason'` as a shortcut here. It was
 * in the first version and it awards phantom titles: `offseason` means BETWEEN
 * seasons, `current_season` has already rolled to the new one, and a league that
 * has just reset has a full fixture list of unplayed matchups with every team on
 * zero — so `league_standings` rank 1 is a tie-break of nothing. Caught against
 * a real reset league that would have been given a title for a season it had not
 * played a minute of. A league in offseason has its finished season in
 * `season_standings_archive` already, so this path has nothing to add there.
 *
 * The only rule is: the current season's own fixture list is complete, and there
 * was a fixture list at all.
 */
async function resolveLiveTitle(
  admin: SupabaseClient,
  leagueId: string,
): Promise<{ teamId: string; season: string } | null> {
  const { data: league } = await admin
    .from('leagues')
    .select('season, current_season')
    .eq('id', leagueId)
    .single();
  if (!league) return null;

  const { count: total } = await admin
    .from('matchups')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId);
  if (!total) return null;

  const { count: unfinished } = await admin
    .from('matchups')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId)
    .neq('status', 'completed');
  if ((unfinished ?? 0) > 0) return null;

  const { data: leader } = await admin
    .from('league_standings')
    .select('team_id')
    .eq('league_id', leagueId)
    .eq('rank', 1)
    .maybeSingle();
  if (!leader) return null;

  return {
    teamId: (leader as { team_id: string }).team_id,
    season: (league as { current_season?: string; season: string }).current_season ?? league.season,
  };
}

/** Collapses a club's honours into one entry per competition, in cabinet order. */
export function groupHonours(honours: Honour[]): HonourGroup[] {
  const byKind = new Map<HonourKind, Honour[]>();
  for (const h of honours) {
    const list = byKind.get(h.kind) ?? [];
    list.push(h);
    byKind.set(h.kind, list);
  }

  return HONOUR_ORDER.flatMap((kind) => {
    const list = byKind.get(kind);
    if (!list || list.length === 0) return [];
    return [
      {
        kind,
        label: list[0].label || HONOUR_LABELS[kind],
        count: list.length,
        seasons: list.map((h) => h.season),
      },
    ];
  });
}
