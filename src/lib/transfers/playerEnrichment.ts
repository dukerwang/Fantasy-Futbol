/**
 * The canonical player stat/rank merge.
 *
 * `player_rankings` is a VIEW and cannot be nested-joined through PostgREST, so
 * every surface that shows a player has to fetch it separately and merge by
 * hand. That merge was duplicated in three places with three different shapes:
 *
 *   - `players/page.tsx:171-192`   — rankings + archive, including total_points
 *   - `trades/page.tsx:290-305`    — rankings + archive, WITHOUT total_points
 *   - `auctions/route.ts:180-190`  — neither
 *
 * The third is a live bug: the free-agent list renders correctly from the RSC
 * payload, then `TransferMarketClient` polls `GET /auctions` every 15 seconds
 * and overwrites it with unmerged rows — so `overall_rank`, `ppg` and
 * `form_rating` silently regress a few seconds after the page loads. Routing
 * everything through here fixes that by construction.
 *
 * This module takes the players/page.tsx shape (the superset) as canonical, so
 * the trades surface now also reads `total_points` from the archive when one
 * exists. That is the correct reading: during an archived season the live
 * `players.total_points` column has already been reset by the next sync.
 */

import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';
import { getCurrentFplSeason, isFplSeasonKickedOff } from '@/lib/season/currentSeason';
import type { createAdminClient } from '@/lib/supabase/admin';
import type { Player } from '@/types';

type AdminClient = ReturnType<typeof createAdminClient>;

/**
 * The fields a rankings row or an archive row can contribute. Both sources
 * carry the same names, which is what lets one merge handle either.
 */
export interface StatOverrides {
  total_points?: number | string | null;
  ppg?: number | string | null;
  form_rating?: number | string | null;
  overall_rank?: number | null;
  position_ranks?: Player['position_ranks'];
}

export interface EnrichmentMaps {
  /** Season whose archive was used. Callers pass this to effective-PPG lookups. */
  season: string;
  previousSeason: string;
  rankMap: Map<string, StatOverrides>;
  archiveMap: Map<string, StatOverrides>;
}

/** What enrichment needs to read off the row it is given. */
type EnrichablePlayer = { id: string } & Partial<StatOverrides>;

/**
 * Which season's numbers to display.
 *
 * A league sitting in `current_season` that the FPL bootstrap says has not
 * kicked off yet must show LAST season's figures — otherwise every player reads
 * as 0 points during the entire preseason, which is when transfer activity is
 * heaviest. Mirrors `players/page.tsx:157-163` and `trades/page.tsx:139-145`.
 */
export async function resolveDisplaySeason(league: {
  current_season?: string | null;
  previous_season?: string | null;
}): Promise<{ season: string; previousSeason: string }> {
  const currentFpl = await getCurrentFplSeason();
  const kickedOff = await isFplSeasonKickedOff();

  let season = league.current_season || currentFpl;
  if (season === currentFpl && !kickedOff) {
    season = league.previous_season || season;
  }

  return { season, previousSeason: league.previous_season || '2024-25' };
}

/** Fetch the rankings view and the season archive once, for merging. */
export async function fetchEnrichmentMaps(
  admin: AdminClient,
  league: { current_season?: string | null; previous_season?: string | null },
): Promise<EnrichmentMaps> {
  const { season, previousSeason } = await resolveDisplaySeason(league);

  const [{ data: rankings }, { data: archives }] = await Promise.all([
    admin.from('player_rankings').select('*'),
    admin
      .from('season_player_stats_archive')
      .select('player_id, total_points, ppg, form_rating, overall_rank, position_ranks')
      .eq('season', season),
  ]);

  const byPlayerId = (rows: unknown[]): Map<string, StatOverrides> =>
    new Map(
      (rows as ({ player_id: string } & StatOverrides)[]).map((r) => [r.player_id, r]),
    );

  return {
    season,
    previousSeason,
    rankMap: byPlayerId(rankings ?? []),
    archiveMap: byPlayerId(archives ?? []),
  };
}

/**
 * Merge rank + archive onto one player row. Archive wins when present — it is
 * the frozen truth for a completed season; the live columns belong to whatever
 * season the last sync wrote.
 */
export function enrichPlayer<T extends EnrichablePlayer>(
  player: T,
  maps: Pick<EnrichmentMaps, 'rankMap' | 'archiveMap'>,
): T & StatOverrides {
  const ranks = maps.rankMap.get(player.id);
  const arch = maps.archiveMap.get(player.id);

  return {
    ...player,
    total_points: arch ? Number(arch.total_points) : player.total_points,
    ppg: arch ? Number(arch.ppg) : player.ppg,
    form_rating: arch ? Number(arch.form_rating) : player.form_rating,
    overall_rank: arch ? arch.overall_rank : ranks?.overall_rank,
    position_ranks: arch ? arch.position_ranks : ranks?.position_ranks,
  };
}

/** Convenience: enrich a list (returns a new array). */
export function enrichPlayers<T extends EnrichablePlayer>(
  players: T[],
  maps: Pick<EnrichmentMaps, 'rankMap' | 'archiveMap'>,
): (T & StatOverrides)[] {
  return players.map((p) => enrichPlayer(p, maps));
}

/** Re-exported so callers need only one import for a player fetch. */
export { FULL_PLAYER_SELECT };
