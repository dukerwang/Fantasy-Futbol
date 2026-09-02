import { createAdminClient } from '@/lib/supabase/admin';
import { createClient } from '@/lib/supabase/server';
import { notFound, redirect } from 'next/navigation';
import type { Matchup } from '@/types';
import { getFplStatus } from '@/lib/fpl/api';
import { processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';
import { getFinalisedGameweeks } from '@/lib/scoring/gameweekState';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';
import MatchupsClient from './MatchupsClient';

export const dynamic = 'force-dynamic';

interface Props {
    params: Promise<{ leagueId: string }>;
    searchParams: Promise<{ gw?: string }>;
}

/**
 * The matchup select, written ONCE.
 */
const MATCHUP_SELECT = `
    *,
    team_a:teams!matchups_team_a_id_fkey(id, team_name, user_id, crest_config),
    team_b:teams!matchups_team_b_id_fkey(id, team_name, user_id, crest_config)
`;

export default async function MatchupsPage({ params, searchParams }: Props) {
    const { leagueId } = await params;
    const { gw } = await searchParams;

    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) redirect('/login');

    const admin = createAdminClient();

    // Parallel initial fetch: League, Team membership, All League Matchups, Stats Season, and FPL Status
    const [
        { data: league },
        { data: member },
        { data: allMatchupsData },
        statsSeason,
        fplStatus,
    ] = await Promise.all([
        admin
            .from('leagues')
            .select('id, name, commissioner_id, status, current_season')
            .eq('id', leagueId)
            .single(),
        admin
            .from('teams')
            .select('id')
            .eq('league_id', leagueId)
            .eq('user_id', user.id)
            .single(),
        admin
            .from('matchups')
            .select(MATCHUP_SELECT)
            .eq('league_id', leagueId)
            .order('gameweek', { ascending: true }),
        getCurrentFplSeason(undefined, true),
        getFplStatus().catch(() => ({ currentGw: 1, isFinished: false, isLive: false, nextGwIsClose: false, nextDeadline: null, nextGw: null, displayGw: 1 })),
    ]);

    if (!league) notFound();
    if (!member && league.commissioner_id !== user.id) redirect('/dashboard');

    const currentFplGw = fplStatus.currentGw ?? 1;
    const isCurrentFplGwFinished = fplStatus.isFinished ?? false;

    let matchupsList = (allMatchupsData ?? []) as Matchup[];
    let gameweeks = Array.from(new Set(matchupsList.map((row) => row.gameweek))).sort((a, b) => a - b);

    // Self-healing safety net if schedule missing
    if (league.status === 'active' && gameweeks.length === 0) {
        const { ensureSeasonScaffold } = await import('@/lib/schedule/ensureSeasonScaffold');
        const scaffold = await ensureSeasonScaffold(admin, leagueId, league.current_season);
        if (scaffold.matchupsCreated) {
            const { data: refreshedMatchups } = await admin
                .from('matchups')
                .select(MATCHUP_SELECT)
                .eq('league_id', leagueId)
                .order('gameweek', { ascending: true });
            matchupsList = (refreshedMatchups ?? []) as Matchup[];
            gameweeks = Array.from(new Set(matchupsList.map((row) => row.gameweek))).sort((a, b) => a - b);
        }
    }

    let targetGw = parseInt(gw ?? '0', 10);
    if (!targetGw) {
        if (currentFplGw > 1) {
            targetGw = currentFplGw;
        } else if (gameweeks.length > 0) {
            const activeMatchup = matchupsList.find((m) => m.status === 'live' || m.status === 'scheduled');
            if (activeMatchup) {
                targetGw = activeMatchup.gameweek;
            } else {
                targetGw = gameweeks[gameweeks.length - 1];
            }
        } else {
            targetGw = 1;
        }
    }

    if (gameweeks.length > 0 && !gameweeks.includes(targetGw)) {
        const snapped = gameweeks.find((g) => g >= targetGw) ?? gameweeks[gameweeks.length - 1]!;
        redirect(`/league/${leagueId}/matchups?gw=${snapped}`);
    }

    // SERVER-SIDE SYNC: If we are in the current gameweek and scores are 0.0,
    // force a sync before rendering to prevent the "0.0 flash" in the UI.
    const isCurrentGw = targetGw === currentFplGw;
    const needsSync = isCurrentGw && matchupsList.some(m => 
        m.gameweek === targetGw &&
        m.status !== 'completed' && 
        (parseFloat(String(m.score_a)) === 0 && parseFloat(String(m.score_b)) === 0)
    );

    if (needsSync) {
        await processMatchupsForGameweek(targetGw, isCurrentFplGwFinished);
        const { data: freshData } = await admin
            .from('matchups')
            .select(MATCHUP_SELECT)
            .eq('league_id', leagueId)
            .order('gameweek', { ascending: true });
        if (freshData) matchupsList = freshData as Matchup[];
    }

    // Fetch finalised gameweeks for the whole season in one quick query
    const finalisedGwsSet = await getFinalisedGameweeks(admin, statsSeason, gameweeks);

    const displaySeason = league.current_season ?? '2025-26';
    const formattedSeason = displaySeason.replace(/^\d{2}(\d{2})-(\d{2})$/, '$1/$2');

    return (
        <MatchupsClient
            allMatchups={matchupsList}
            initialGw={targetGw}
            gameweeks={gameweeks}
            leagueId={leagueId}
            formattedSeason={formattedSeason}
            myTeamId={member?.id}
            currentFplGw={currentFplGw}
            isCurrentFplGwFinished={isCurrentFplGwFinished}
            finalisedGws={Array.from(finalisedGwsSet)}
        />
    );
}
