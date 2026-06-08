import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Returns a Set of FPL team IDs whose matches have already kicked off
 * for the specified gameweek. Uses a hybrid approach:
 *   1. Queries the local `pl_fixtures` table (fast, no external latency).
 *   2. Falls back to FPL live API fetch if local table is empty.
 */
export async function getLockedPlTeamIds(admin: SupabaseClient, gameweek: number): Promise<Set<number>> {
    const lockedPlTeamIds = new Set<number>();
    const now = new Date();

    // 1. Try local database query first
    try {
        const { data: dbFixtures } = await admin
            .from('pl_fixtures')
            .select('team_h, team_a, kickoff_time')
            .eq('gameweek', gameweek);

        if (dbFixtures && dbFixtures.length > 0) {
            for (const f of dbFixtures) {
                if (f.kickoff_time && new Date(f.kickoff_time) <= now) {
                    lockedPlTeamIds.add(f.team_h);
                    lockedPlTeamIds.add(f.team_a);
                }
            }
            return lockedPlTeamIds;
        }
    } catch (dbErr) {
        console.error('[lockout] Failed to query local pl_fixtures:', dbErr);
    }

    // 2. Fall back to FPL API synchronously if local database has no data
    try {
        const res = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${gameweek}`, {
            headers: { 'User-Agent': 'FantasyFutbol/1.0' },
            next: { revalidate: 0 },
        });
        if (res.ok) {
            const fixtures = await res.json();
            interface FplFixtureRaw {
                team_h: number;
                team_a: number;
                kickoff_time: string | null;
            }
            for (const f of fixtures as FplFixtureRaw[]) {
                if (f.kickoff_time && new Date(f.kickoff_time) <= now) {
                    lockedPlTeamIds.add(f.team_h);
                    lockedPlTeamIds.add(f.team_a);
                }
            }
        }
    } catch (apiErr) {
        console.error('[lockout] Failed to fetch FPL fixtures backup:', apiErr);
    }

    return lockedPlTeamIds;
}
