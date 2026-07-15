import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';
import { createAdminClient } from '@/lib/supabase/admin';
import { FULL_PLAYER_SELECT } from '@/lib/constants/queries';

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

  const admin = createAdminClient();
  const { searchParams } = new URL(_req.url);
  const leagueId = searchParams.get('leagueId');
  let targetSeason = searchParams.get('season');

  const currentFplSeason = await getCurrentFplSeason();
  const { isFplSeasonKickedOff, previousSeason } = await import('@/lib/season/currentSeason');
  const kickedOff = await isFplSeasonKickedOff();

  // 1. Resolve season from leagueId if provided
  if (leagueId) {
    const { data: lg } = await admin
      .from('leagues')
      .select('current_season, previous_season')
      .eq('id', leagueId)
      .single();
    if (lg?.current_season) {
      targetSeason = lg.current_season;
      if (targetSeason === currentFplSeason && !kickedOff) {
        targetSeason = lg.previous_season ?? targetSeason;
      }
    }
  }

  if (!targetSeason) {
    targetSeason = currentFplSeason;
    if (targetSeason === currentFplSeason && !kickedOff) {
      targetSeason = previousSeason(targetSeason);
    }
  }

  const isCurrentFplSeason = targetSeason === currentFplSeason;

  // 2. Fetch full player record
  const { data: fullPlayer, error: pError } = await admin
    .from('players')
    .select(FULL_PLAYER_SELECT)
    .eq('id', playerId)
    .single();

  if (pError || !fullPlayer) {
    return NextResponse.json({ error: pError?.message ?? 'Player not found' }, { status: 404 });
  }

  // 3. Fetch rankings (from player_rankings if current FPL season, otherwise from archive)
  let overallRank = null;
  let posRanks = null;
  let seasonPpg = fullPlayer.ppg;
  let seasonFormRating = fullPlayer.form_rating;

  if (isCurrentFplSeason) {
    const { data: rankRow } = await admin
      .from('player_rankings')
      .select('overall_rank, position_ranks')
      .eq('player_id', playerId)
      .maybeSingle();
    overallRank = rankRow?.overall_rank ?? null;
    posRanks = rankRow?.position_ranks ?? null;
  } else {
    // Past season: load metrics and rankings from the archive
    const { data: archRow } = await admin
      .from('season_player_stats_archive')
      .select('ppg, form_rating, overall_rank, position_ranks')
      .eq('player_id', playerId)
      .eq('season', targetSeason)
      .maybeSingle();

    if (archRow) {
      overallRank = archRow.overall_rank;
      posRanks = archRow.position_ranks;
      seasonPpg = Number(archRow.ppg);
      seasonFormRating = Number(archRow.form_rating);
    } else {
      overallRank = null;
      posRanks = null;
      seasonPpg = 0;
      seasonFormRating = 0;
    }
  }

  // Merge rankings + resolved stats into the player record
  const playerRecord = {
    ...fullPlayer,
    ppg: seasonPpg,
    form_rating: seasonFormRating,
    overall_rank: overallRank,
    position_ranks: posRanks,
  };

  // Slim record still needed for gamelog lookups
  const dbPlayer = { fpl_id: fullPlayer.fpl_id, pl_team_id: fullPlayer.pl_team_id, name: fullPlayer.name };

  // 4. Fetch our custom fantasy_points and ratings (filtered by targetSeason)
  const { data: dbStats } = await supabase
    .from('player_stats')
    .select('match_id, gameweek, fantasy_points, match_rating, stats')
    .eq('player_id', playerId)
    .eq('season', targetSeason);

  const statsMap = new Map(dbStats?.map((s: any) => [Number(s.match_id), s]) ?? []);

  // 4.5 Fetch player career history from season_player_stats_archive
  const { data: historyData } = await supabase
    .from('season_player_stats_archive')
    .select('season, total_points, ppg, form_rating, overall_rank, position_ranks')
    .eq('player_id', playerId)
    .order('season', { ascending: false });
  
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

    if (isCurrentFplSeason && dbPlayer.fpl_id) {
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
    return NextResponse.json({ player: playerRecord, gamelog: enrichedLog, history: historyData ?? [] });

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
    return NextResponse.json({ player: playerRecord, gamelog: fallback, history: historyData ?? [] });
  }
}
