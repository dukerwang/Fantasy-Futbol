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

  // 1. Fetch player to get fpl_id and team_id for cross-referencing
  const { data: dbPlayer, error: pError } = await supabase
    .from('players')
    .select('fpl_id, pl_team_id, name')
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

  const statsMap = new Map(dbStats?.map((s: any) => [Number(s.match_id), s]) ?? []);
  
  let teamMap = new Map<number, { name: string, short: string }>();
  let fixtureMap = new Map<number, any>();
  const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

  try {
    // 3. Fetch FPL bootstrap (cached 1hr)
    const bootRes = await fetch(`${FPL_BASE}/bootstrap-static/`, {
      headers: { 'User-Agent': USER_AGENT },
      next: { revalidate: 3600 }
    });
    if (bootRes.ok) {
      const bootData = await bootRes.json();
      bootData.teams?.forEach((t: any) => teamMap.set(t.id, { name: t.name, short: t.short_name }));
    }

    // 4. Fetch all fixtures (cached 1hr)
    const fixRes = await fetch(`${FPL_BASE}/fixtures/`, {
      headers: { 'User-Agent': USER_AGENT },
      next: { revalidate: 3600 }
    });
    if (fixRes.ok) {
      const fixData = await fixRes.json();
      fixData.forEach((f: any) => fixtureMap.set(f.id, f));
    }

    // 5. Try fetching player-specific history (cached 5m)
    let enrichedLog: any[] = [];
    let historyFetched = false;

    if (dbPlayer.fpl_id) {
      const histRes = await fetch(`${FPL_BASE}/element-summary/${dbPlayer.fpl_id}/`, {
        headers: { 'User-Agent': USER_AGENT },
        next: { revalidate: 300 }
      });
      
      if (histRes.ok) {
        const histData = await histRes.json();
        historyFetched = true;
        enrichedLog = (histData.history ?? []).map((h: any) => {
          const dbEntry = (statsMap.get(h.fixture) || statsMap.get(h.round * 1000 + dbPlayer.fpl_id)) as any;
          const opponent = teamMap.get(h.opponent_team)?.short ?? 'UNK';
          
          let resultString = '';
          if (h.team_h_score !== null && h.team_a_score !== null) {
            const isWin = h.was_home ? h.team_h_score > h.team_a_score : h.team_a_score > h.team_h_score;
            const isLoss = h.was_home ? h.team_h_score < h.team_a_score : h.team_a_score < h.team_h_score;
            const outcome = isWin ? 'W' : isLoss ? 'L' : 'D';
            resultString = `${outcome} ${h.team_h_score}-${h.team_a_score}`;
          }

          return {
            gameweek: h.round,
            opponent: h.was_home ? `${opponent} (H)` : `${opponent} (A)`,
            result: resultString,
            date: h.kickoff_time,
            isDNP: h.minutes === 0,
            fantasy_points: dbEntry ? Number(dbEntry.fantasy_points) : 0,
            match_rating: dbEntry ? Number(dbEntry.match_rating) : null,
            stats: dbEntry ? dbEntry.stats : { minutes_played: h.minutes, goals: 0, assists: 0 },
          };
        });
      }
    }

    // 6. Fallback if element-summary failed OR player has no fpl_id
    if (!historyFetched) {
      enrichedLog = (dbStats ?? []).map((s: any) => {
        const mid = Number(s.match_id);
        const f = fixtureMap.get(mid);
        let opponent = 'Unknown';
        let result = '';
        let isHome = false;

        if (f) {
          const isPlayerHome = f.team_h === dbPlayer.pl_team_id;
          isHome = isPlayerHome;
          const oppId = isPlayerHome ? f.team_a : f.team_h;
          opponent = teamMap.get(oppId)?.short ?? 'UNK';
          
          if (f.finished) {
            const isWin = isPlayerHome ? f.team_h_score > f.team_a_score : f.team_a_score > f.team_h_score;
            const isLoss = isPlayerHome ? f.team_h_score < f.team_a_score : f.team_a_score < f.team_h_score;
            const outcome = isWin ? 'W' : isLoss ? 'L' : 'D';
            result = `${outcome} ${f.team_h_score}-${f.team_a_score}`;
          }
        } else if (mid > 1000) {
          // Synthetic ID DNP lookup
          const gw = s.gameweek;
          const gwFixtures = Array.from(fixtureMap.values()).filter(fix => fix.event === gw && (fix.team_h === dbPlayer.pl_team_id || fix.team_a === dbPlayer.pl_team_id));
          if (gwFixtures.length > 0) {
            const firstFix = gwFixtures[0];
            const isPlayerHome = firstFix.team_h === dbPlayer.pl_team_id;
            isHome = isPlayerHome;
            const oppId = isPlayerHome ? firstFix.team_a : firstFix.team_h;
            opponent = teamMap.get(oppId)?.short ?? 'UNK';
          }
        }

        return {
          gameweek: s.gameweek,
          opponent: opponent !== 'Unknown' ? (isHome ? `${opponent} (H)` : `${opponent} (A)`) : opponent,
          result,
          isDNP: (s.stats?.minutes_played === 0),
          fantasy_points: Number(s.fantasy_points),
          match_rating: s.match_rating ? Number(s.match_rating) : null,
          stats: s.stats,
        };
      });
    }

    enrichedLog.sort((a: any, b: any) => b.gameweek - a.gameweek);
    return NextResponse.json({ gamelog: enrichedLog });

  } catch (err) {
    console.error('Critical failure in player game log generation', err);
    // Absolute baseline fallback
    const fallback = (dbStats ?? []).map((s: any) => ({
      ...s,
      fantasy_points: Number(s.fantasy_points),
      match_rating: s.match_rating ? Number(s.match_rating) : null,
      opponent: 'Unknown',
      result: '',
      isDNP: (s.stats?.minutes_played === 0),
    }));
    fallback.sort((a: any, b: any) => b.gameweek - a.gameweek);
    return NextResponse.json({ gamelog: fallback });
  }
}
