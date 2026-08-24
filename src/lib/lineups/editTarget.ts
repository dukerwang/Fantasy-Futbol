import type { SupabaseClient } from '@supabase/supabase-js';
import { hasGameweekLastKickoffPassed } from '@/lib/fixtures/lockout';
import type { MatchupLineup } from '@/types';

const MATCHUP_SELECT = 'id, team_a_id, team_b_id, lineup_a, lineup_b, gameweek, status';

export type LineupEditMatchup = {
    id: string;
    team_a_id: string;
    team_b_id: string | null;
    lineup_a: MatchupLineup | null;
    lineup_b: MatchupLineup | null;
    gameweek: number;
    status: string;
};

/**
 * Which matchup the squad editor (and academy lock checks) should target.
 *
 * This week's row stays the scoring document until it is `completed` — home,
 * matchups, and live scores do not follow this handoff. Once that gameweek's
 * last dated kickoff has passed, managers edit *next* week's matchup instead
 * of sitting on a fully frozen pitch until the 09:00 UK review. League-wide:
 * same handoff moment for everyone.
 */
export async function resolveLineupEditMatchup(
    admin: SupabaseClient,
    teamId: string,
    currentFplGw: number,
): Promise<LineupEditMatchup | null> {
    const teamFilter = `team_a_id.eq.${teamId},team_b_id.eq.${teamId}`;

    const byGameweek = async (gw: number): Promise<LineupEditMatchup | null> => {
        const { data } = await admin
            .from('matchups')
            .select(MATCHUP_SELECT)
            .eq('gameweek', gw)
            .or(teamFilter)
            .maybeSingle();
        return (data as LineupEditMatchup | null) ?? null;
    };

    const nextScheduledAfter = async (gw: number): Promise<LineupEditMatchup | null> => {
        const { data } = await admin
            .from('matchups')
            .select(MATCHUP_SELECT)
            .eq('status', 'scheduled')
            .or(teamFilter)
            .gt('gameweek', gw)
            .order('gameweek', { ascending: true })
            .limit(1)
            .maybeSingle();
        return (data as LineupEditMatchup | null) ?? null;
    };

    const earliestOpen = async (): Promise<LineupEditMatchup | null> => {
        const { data } = await admin
            .from('matchups')
            .select(MATCHUP_SELECT)
            .in('status', ['scheduled', 'live'])
            .or(teamFilter)
            .order('gameweek', { ascending: true })
            .limit(1)
            .maybeSingle();
        return (data as LineupEditMatchup | null) ?? null;
    };

    const advanceIfLastKickoffPassed = async (
        row: LineupEditMatchup,
    ): Promise<LineupEditMatchup> => {
        if (await hasGameweekLastKickoffPassed(admin, row.gameweek)) {
            return (await nextScheduledAfter(row.gameweek)) ?? row;
        }
        return row;
    };

    if (currentFplGw > 0) {
        const current = await byGameweek(currentFplGw);
        if (current && current.status !== 'completed') {
            return advanceIfLastKickoffPassed(current);
        }
    }

    const open = await earliestOpen();
    if (open) return advanceIfLastKickoffPassed(open);
    return null;
}
