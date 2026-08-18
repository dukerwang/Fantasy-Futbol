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

export default async function GlobalPublicStatsPage() {
  const currentFpl = await getCurrentFplSeason();
  const kickedOff = await isFplSeasonKickedOff();

  let season = currentFpl;
  if (!kickedOff) {
    season = previousSeason(season);
  }

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
