import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { calculateTeamScore, loadReferenceStats, type PlayerScoreRecord } from '@/lib/scoring/matchups';
import { normalizeMatchupLineup } from '@/lib/lineups/normalizeMatchupLineup';

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
    .single();

  if (!matchup) return NextResponse.json({ error: 'Matchup not found' }, { status: 404 });

  // If not live OR scheduled, return the stored scores immediately
  if (matchup.status !== 'live' && matchup.status !== 'scheduled') {
    return NextResponse.json({
      score_a: matchup.score_a,
      score_b: matchup.score_b,
      live: false,
    });
  }

  // Extract all player IDs from both lineups
  const lineupA = normalizeMatchupLineup(matchup.lineup_a as any | null);
  const lineupB = normalizeMatchupLineup(matchup.lineup_b as any | null);
  const playerIds = new Set<string>();
  lineupA?.starters?.forEach((s: any) => playerIds.add(s.player_id));
  lineupA?.bench?.forEach((b: any) => playerIds.add(b.player_id));
  lineupB?.starters?.forEach((s: any) => playerIds.add(s.player_id));
  lineupB?.bench?.forEach((b: any) => playerIds.add(b.player_id));

  if (playerIds.size === 0) {
    return NextResponse.json({ score_a: matchup.score_a, score_b: matchup.score_b, live: true });
  }

  // 1. Load reference stats
  const season = '2025-26';
  const refStats = await loadReferenceStats(admin, season);

  // 2. Fetch player stats for this GW
  const { data: statsRows } = await admin
    .from('player_stats')
    .select('player_id, fantasy_points, stats')
    .in('player_id', Array.from(playerIds))
    .eq('gameweek', matchup.gameweek);

  const playerRecord = new Map<string, PlayerScoreRecord>();
  for (const row of statsRows ?? []) {
    const fixtureMins: number = (row.stats as any)?.minutes_played ?? 0;
    const pts: number = Number(row.fantasy_points) || 0;
    const existing = playerRecord.get(row.player_id);
    
    const fixture = { minutes: fixtureMins, fantasyPoints: pts };
    if (!existing) {
      playerRecord.set(row.player_id, { fixtures: [fixture] });
    } else {
      existing.fixtures.push(fixture);
    }
  }

  // 3. Fetch player positions & PL Team IDs
  const { data: playersData } = await admin
    .from('players')
    .select('id, primary_position, secondary_positions, pl_team_id')
    .in('id', Array.from(playerIds));

  const playerPositions = new Map<string, string[]>();
  const playerPlTeamId = new Map<string, number>();
  for (const p of playersData ?? []) {
    playerPositions.set(p.id, [p.primary_position, ...(p.secondary_positions || [])]);
    if (p.pl_team_id) playerPlTeamId.set(p.id, p.pl_team_id);
  }

  // 4. Calculate total scores using the central engine
  // Note: We'll assume the entire gameweek isn't 'finished' for live polling unless statuses indicate otherwise.
  // Actually, for 'live' matches, we want to see subs fire if their player finished.
  const scoreA = calculateTeamScore(lineupA, playerRecord, playerPositions, playerPlTeamId, refStats as any, false, new Set());
  const scoreB = calculateTeamScore(lineupB, playerRecord, playerPositions, playerPlTeamId, refStats as any, false, new Set());

  // Persist back to DB so they stay in sync
  await admin
    .from('matchups')
    .update({ score_a: scoreA, score_b: scoreB })
    .eq('id', matchupId);

  return NextResponse.json({ score_a: scoreA, score_b: scoreB, live: true });
}
