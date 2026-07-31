/**
 * Gaffa — per-league auction settings
 *
 * One read for both bid routes, so the free-agent floor and the quiet-hours
 * window can never diverge between the free-agent path and the sale-listing
 * path. They previously did diverge on expiry duration, in five places.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { DEFAULT_QUIET_HOURS } from './timer';
import type { QuietHours } from './timer';

/** Matches leagues.free_agent_bid_floor's default in migration 095. */
export const DEFAULT_BID_FLOOR = 0.5;

export interface LeagueAuctionSettings {
    /** null disables the guard entirely — only when a league sets a zero-length window. */
    quietHours: QuietHours | null;
    /** Fraction of market value a free-agent bid must at least reach. */
    bidFloor: number;
}

export async function getLeagueAuctionSettings(
    admin: SupabaseClient,
    leagueId: string,
): Promise<LeagueAuctionSettings> {
    const { data } = await admin
        .from('leagues')
        .select('free_agent_bid_floor, auction_quiet_start, auction_quiet_end, auction_timezone')
        .eq('id', leagueId)
        .single();

    const floorRaw = Number(data?.free_agent_bid_floor);
    const bidFloor = Number.isFinite(floorRaw) && floorRaw > 0 ? floorRaw : DEFAULT_BID_FLOOR;

    // Postgres TIME renders as 'HH:MM:SS'; the timer wants 'HH:MM'.
    const trim = (t: string | null | undefined) => (t ? t.slice(0, 5) : null);
    const start = trim(data?.auction_quiet_start as string | null) ?? DEFAULT_QUIET_HOURS.start;
    const end = trim(data?.auction_quiet_end as string | null) ?? DEFAULT_QUIET_HOURS.end;

    // auction_timezone has no DB default because there is no safe one — it must
    // match where the managers live. Fall back rather than skip the guard: an
    // approximately-right window still prevents a 4am close.
    const timeZone = (data?.auction_timezone as string | null) || DEFAULT_QUIET_HOURS.timeZone;

    return {
        bidFloor,
        quietHours: start === end ? null : { start, end, timeZone },
    };
}
