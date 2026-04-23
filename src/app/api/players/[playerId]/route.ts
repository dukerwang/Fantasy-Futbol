import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

const FPL_BASE = 'https://fantasy.premierleague.com/api';

/**
 * GET /api/players/[playerId]
 *
 * Returns the game-by-game log for a player by bridging our database stats
 * with the FPL element-summary endpoint for chronological completeness (DNPs, opponent, dates).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ playerId: string }> },
) {
  const { playerId } = await params;
  const supabase = await createClient();

  // 1. Fetch player to get fpl_id for cross-referencing
  const { data: dbPlayer, error: pError } = await supabase
    .from('players')
    .select('fpl_id')
    .eq('id', playerId)
    .single();

  if (pError || !dbPlayer) {
    return NextResponse.json({ error: pError?.message ?? 'Player not found' }, { status: 404 });
  }

  // 2. Fetch our custom fantasy_points and ratings
  const { data: dbStats } = await supabase
    .from('player_stats')
    .select('match_id, gameweek, fantasy_points, match_rating, stats')
    .eq('player_id', playerId);

  let gamelog = dbStats ?? [];

  if (dbPlayer.fpl_id) {
    try {
      // 3. Fetch FPL bootstrap to map team IDs to names (cached aggressively)
      const bootRes = await fetch(`${FPL_BASE}/bootstrap-static/`, { next: { revalidate: 3600 } });
      const bootData = await bootRes.json();
      const teamMap = new Map<number, string>();
      for (const t of bootData.teams) {
        teamMap.set(t.id, t.short_name);
      }

      // 4. Fetch FPL element-summary for comprehensive match array
      const histRes = await fetch(`${FPL_BASE}/element-summary/${dbPlayer.fpl_id}/`, { next: { revalidate: 300 } });
      const histData = await histRes.json();

      // Use match_id (fixture_id) for mapping to avoid DGW duplication
      const statsMap = new Map(dbStats?.map((s: any) => [s.match_id, s]) ?? []);

      const enrichedLog = histData.history.map((h: any) => {
        // Fallback to gameweek-based mapping for legacy records if fixture mapping fails
        const dbEntry = statsMap.get(h.fixture) || (dbStats as any[])?.find((s: any) => s.gameweek === h.round && s.match_id === (h.round * 1000 + dbPlayer.fpl_id));
        
        const opponentName = teamMap.get(h.opponent_team) ?? 'UNK';
        const resultString = h.team_h_score !== null && h.team_a_score !== null
          ? `${h.team_h_score}-${h.team_a_score}`
          : '';
        const isDNP = h.minutes === 0;

        return {
          gameweek: h.round,
          opponent: h.was_home ? `${opponentName} (H)` : `${opponentName} (A)`,
          result: resultString,
          date: h.kickoff_time,
          isDNP,
          fantasy_points: dbEntry ? dbEntry.fantasy_points : 0,
          match_rating: dbEntry ? dbEntry.match_rating : null,
          stats: dbEntry ? dbEntry.stats : { minutes_played: h.minutes, goals: 0, assists: 0 },
        };
      });

      // Sort chronologically descending
      enrichedLog.sort((a: any, b: any) => b.gameweek - a.gameweek);
      gamelog = enrichedLog;
    } catch (err) {
      console.error('Failed to augment game log from FPL', err);
      // Fallback to purely our db sorted descending
      gamelog.sort((a: any, b: any) => b.gameweek - a.gameweek);
    }
  } else {
    gamelog.sort((a: any, b: any) => b.gameweek - a.gameweek);
  }

  return NextResponse.json({ gamelog });
}
