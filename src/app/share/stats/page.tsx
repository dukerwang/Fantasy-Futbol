import { createAdminClient } from '@/lib/supabase/admin';
import GlobalStatsTable from '@/app/(dashboard)/league/[leagueId]/stats/GlobalStatsTable';
import type { Player } from '@/types';
import { getCurrentFplSeason, isFplSeasonKickedOff, previousSeason } from '@/lib/season/currentSeason';
import { loadSeasonLeaderboard } from '@/lib/stats/seasonStats';
import { PRECOMPUTED_STATS_2025_26 } from '@/lib/season/archived_stats_2025_26';

export const dynamic = 'force-dynamic';

export interface StatPlayer extends Player {
  owner_team_id: string | null;
  owner_team_name: string | null;
}

/**
 * `?season=YYYY-YY` pins the table to one season. Without it the page follows
 * the live one, which means a completed season becomes unreachable the moment
 * the next kicks off — there was no way to look at 2025-26 again once GW1
 * 2026-27 started, which is the whole point of an archive.
 */
function parseSeason(raw: string | undefined): string | null {
  if (!raw) return null;
  return /^\d{4}-\d{2}$/.test(raw) ? raw : null;
}

export default async function GlobalPublicStatsPage({
  searchParams,
}: {
  searchParams: Promise<{ season?: string }>;
}) {
  const requested = parseSeason((await searchParams).season);
  const currentFpl = await getCurrentFplSeason();
  const kickedOff = await isFplSeasonKickedOff();

  let season = currentFpl;
  if (!kickedOff) {
    season = previousSeason(season);
  }
  if (requested) season = requested;

  // Instant response for completed 2025-26 archived season
  if (season === '2025-26') {
    return (
      <GlobalStatsTable
        leagueId=""
        leagueName="Global Leaderboard"
        players={PRECOMPUTED_STATS_2025_26.players as StatPlayer[]}
        season="2025-26"
        shadowMaps={PRECOMPUTED_STATS_2025_26.shadowMaps}
      />
    );
  }

  const admin = createAdminClient();
  const { players, shadowMaps } = await loadSeasonLeaderboard(admin, season);

  // Global context: No owners exist
  const statPlayers: StatPlayer[] = players.map((p: any) => ({
    ...p,
    owner_team_id: null,
    owner_team_name: null,
  }));

  return (
    <GlobalStatsTable
      leagueId=""
      leagueName="Global Leaderboard"
      players={statPlayers}
      season={season}
      shadowMaps={shadowMaps}
    />
  );
}
