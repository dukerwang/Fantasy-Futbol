/**
 * Whether a gameweek's scores are settled or still provisional.
 *
 * From 2026/27 FPL locks a gameweek down at 09:00 UK on the day after its final
 * match, and withholds the ICT block plus final bonus until then. Everything
 * scored before that point is an estimate — good enough to follow along with,
 * but not the number that ends up in the record.
 *
 * `gameweek_sync_state.final_synced_at` is written by the post-lockdown stats
 * pass in /api/sync/stats, so it answers the question the UI actually needs:
 * not "has FPL finished?" but "do we hold FPL's reviewed figures yet?".
 */

import type { SupabaseClient } from '@supabase/supabase-js';

/** Gameweeks (of those asked about) whose reviewed stats we already hold. */
export async function getFinalisedGameweeks(
    client: SupabaseClient,
    season: string,
    gameweeks: number[],
): Promise<Set<number>> {
    if (gameweeks.length === 0) return new Set();
    const { data } = await client
        .from('gameweek_sync_state')
        .select('gameweek')
        .eq('season', season)
        .not('final_synced_at', 'is', null)
        .in('gameweek', gameweeks);
    return new Set((data ?? []).map((r: { gameweek: number }) => r.gameweek));
}

/** Whether one gameweek's scores are final. */
export async function isGameweekFinalised(
    client: SupabaseClient,
    season: string,
    gameweek: number,
): Promise<boolean> {
    const finalised = await getFinalisedGameweeks(client, season, [gameweek]);
    return finalised.has(gameweek);
}
