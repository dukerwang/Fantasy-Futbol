import type { SupabaseClient } from '@supabase/supabase-js';
import { insertMatchups } from './insertMatchups';
import { createAllTournaments, getPreviousSeason } from '@/lib/tournaments/createTournaments';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';
import { resolveCurrentGw } from '@/lib/season/currentGameweek';

export interface SeasonScaffoldResult {
  matchupsCreated: boolean;
  tournamentsCreated: boolean;
}

// A league with no previous season has nothing but pre-season standings to
// seed cups from, so seeding is arbitrary (and byes doubly so) if generated
// at draft time. Waiting until real form exists fixes that; a league with a
// previous season seeds from its archived final standings instead, which are
// meaningful immediately, so only the inaugural season needs the delay.
const INAUGURAL_SEASON_CUP_SEED_GW = 7;

/**
 * Creates everything a league needs once its draft completes: the
 * head-to-head schedule immediately, and all three cup brackets once seeding
 * is meaningful (see `INAUGURAL_SEASON_CUP_SEED_GW` above).
 *
 * Why this exists as one call. The two generators used to be invoked
 * separately, and `draft/pick` only ever called `insertMatchups`. A draft that
 * ended on a manual final pick therefore produced a league with a schedule and
 * no cups — and the page-load backfills nested `createAllTournaments` inside an
 * "are there zero matchups?" branch, so once the schedule existed the cups could
 * never be created by any path. Two leagues in production are still in that
 * state. Keeping both generators behind one function is what stops the pair
 * drifting apart again.
 *
 * Safe to call on every load for an active league: `insertMatchups` skips when
 * the league already has matchups, `createTournament` skips per
 * (league, type, season), and an inaugural-season league below the GW
 * threshold skips cup creation entirely — each a cheap no-op.
 *
 * Failures are logged, never thrown — a cup that can't be built must not take
 * down the page or the pick that triggered it. Each generator is attempted
 * independently so one failing doesn't suppress the other.
 */
export async function ensureSeasonScaffold(
  admin: SupabaseClient,
  leagueId: string,
  season?: string | null,
): Promise<SeasonScaffoldResult> {
  const result: SeasonScaffoldResult = {
    matchupsCreated: false,
    tournamentsCreated: false,
  };

  try {
    const scheduleResult = await insertMatchups(admin, leagueId);
    result.matchupsCreated = !scheduleResult.skipped && (scheduleResult.matchups ?? 0) > 0;
  } catch (err) {
    console.error(`[ensureSeasonScaffold] schedule failed for ${leagueId}:`, err);
  }

  try {
    const resolvedSeason = season ?? (await getCurrentFplSeason());
    const previousSeason = await getPreviousSeason(admin, leagueId);
    const seedingReady =
      previousSeason != null || (await resolveCurrentGw()) >= INAUGURAL_SEASON_CUP_SEED_GW;

    if (seedingReady) {
      const cupResult = await createAllTournaments(admin, leagueId, resolvedSeason);
      result.tournamentsCreated = cupResult.tournamentsCreated.some(
        (r) => r.ok && !r.skipped,
      );
    }
  } catch (err) {
    console.error(`[ensureSeasonScaffold] cups failed for ${leagueId}:`, err);
  }

  return result;
}
