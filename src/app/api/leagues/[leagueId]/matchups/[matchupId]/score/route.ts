import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import type { GranularPosition, MatchupLineup } from '@/types';

interface Props {
  params: Promise<{ leagueId: string; matchupId: string }>;
}

export async function GET(_req: NextRequest, { params }: Props) {
  const { leagueId, matchupId } = await params;

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const admin = createAdminClient();

  // Verify league membership
  const { data: member } = await admin
    .from('teams')
    .select('id')
    .eq('league_id', leagueId)
    .eq('user_id', user.id)
    .single();

  const { data: league } = await admin
    .from('leagues')
    .select('commissioner_id')
    .eq('id', leagueId)
    .single();

  if (!member && league?.commissioner_id !== user.id) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  // Fetch the matchup
  const { data: matchup } = await admin
    .from('matchups')
    .select('id, league_id, gameweek, score_a, score_b, lineup_a, lineup_b, status')
    .eq('id', matchupId)
    .eq('league_id', leagueId)
    .in('status', ['scheduled', 'live', 'completed']) // Include 'completed' to allow fetching scores for past matchups
    .single();

  if (!matchup) return NextResponse.json({ error: 'Matchup not found' }, { status: 404 });

  // If not live OR scheduled, return the stored scores immediately
  // We allow 'scheduled' here to handle the window where the match has started but sync hasn't flipped the DB status yet.
  if (matchup.status !== 'live' && matchup.status !== 'scheduled') {
    return NextResponse.json({
      score_a: matchup.score_a,
      score_b: matchup.score_b,
      live: false,
    });
  }

  // Extract starter player IDs from both lineups
  const lineupA = matchup.lineup_a as MatchupLineup | null;
  const lineupB = matchup.lineup_b as MatchupLineup | null;
  const starterIdsA = (lineupA?.starters ?? []).map((s) => s.player_id);
  const starterIdsB = (lineupB?.starters ?? []).map((s) => s.player_id);
  const allStarterIds = [...new Set([...starterIdsA, ...starterIdsB])];

  // No lineups saved yet — return stored scores
  if (allStarterIds.length === 0) {
    return NextResponse.json({ score_a: matchup.score_a, score_b: matchup.score_b, live: true });
  }

  // REVERT: Use the matchup's own gameweek instead of fetching it from FPL every time.
  // We confirmed matchup.gameweek stores the correct FPL Gameweek ID.
  const currentFplGw = matchup.gameweek;
  
  const { data: statsRows } = await admin
    .from('player_stats')
    .select('player_id, fantasy_points')
    .in('player_id', allStarterIds)
    .eq('gameweek', currentFplGw);

  const statsMap = new Map<string, number>(
    (statsRows ?? []).map((s: any) => [s.player_id, Number(s.fantasy_points)]),
  );

  // Sum points for each team's starters
  const scoreA = starterIdsA.reduce((sum, id) => sum + (statsMap.get(id) ?? 0), 0);
  const scoreB = starterIdsB.reduce((sum, id) => sum + (statsMap.get(id) ?? 0), 0);

  // Persist the updated live scores back to the matchup row
  await admin
    .from('matchups')
    .update({ score_a: scoreA, score_b: scoreB })
    .eq('id', matchupId);

  return NextResponse.json({ score_a: scoreA, score_b: scoreB, live: true });
}
