/**
 * POST /api/admin/backfill-scoring-v2
 *
 * Walks every completed gameweek of the current FPL season, refetches the FPL
 * `event/{gw}/live` payload, and writes V2 (new engine) values into the
 * `_v2` shadow columns on `player_stats` and `matchups`.
 *
 *   - `player_stats.match_rating_v2` / `fantasy_points_v2`
 *   - `matchups.score_a_v2` / `score_b_v2`
 *
 * The V1 (legacy) columns are left untouched. After the user reviews the v1
 * vs v2 deltas in /admin/scoring-v2, the Phase 3D promotion migration copies
 * v2 → v1 and drops the v2 columns.
 *
 * Query params:
 *   ?from=1&to=38    — restrict the GW range (defaults to 1..currentFinishedGw)
 *   ?stats=true      — refresh player_stats v2 (default true)
 *   ?matchups=true   — refresh matchups v2     (default true)
 *
 * Auth: CRON_SECRET via x-cron-secret header or Authorization: Bearer.
 * Runtime: long-running; allow up to 5 minutes.
 */

import { calculateMatchRating, mapFplLiveToRawStats } from '@/lib/scoring/engine';
import { calculateTeamScore, loadReferenceStats } from '@/lib/scoring/matchups';
import { normalizeMatchupLineup } from '@/lib/lineups/normalizeMatchupLineup';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentFplSeason, getLatestReferenceStatsSeason } from '@/lib/season/currentSeason';
import type { GranularPosition, FplLivePlayerStats, RawStats } from '@/types';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const FPL_BASE = 'https://fantasy.premierleague.com/api';

async function fetchCompletedGws(): Promise<number[]> {
  const res = await fetch(`${FPL_BASE}/bootstrap-static/`, {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`bootstrap-static error: ${res.status}`);
  const data = await res.json();
  return (data.events ?? []).filter((e: any) => e.finished).map((e: any) => e.id as number);
}

async function fetchGwLive(gw: number): Promise<FplLivePlayerStats[]> {
  const res = await fetch(`${FPL_BASE}/event/${gw}/live/`, {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`FPL live GW${gw} error: ${res.status}`);
  const data = await res.json();
  return (data.elements ?? []) as FplLivePlayerStats[];
}

async function fetchGwFixtures(gw: number): Promise<Record<number, number[]>> {
  const res = await fetch(`${FPL_BASE}/fixtures/?event=${gw}`, {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' },
    next: { revalidate: 0 },
  });
  if (!res.ok) throw new Error(`fixtures GW${gw} error: ${res.status}`);
  const fixtures = await res.json();
  const out: Record<number, number[]> = {};
  for (const f of fixtures) {
    (out[f.team_h] ??= []).push(f.id);
    (out[f.team_a] ??= []).push(f.id);
  }
  return out;
}

export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const doStats = searchParams.get('stats') !== 'false';
  const doMatchups = searchParams.get('matchups') !== 'false';
  const fromArg = parseInt(searchParams.get('from') ?? '1', 10);
  const toArg = parseInt(searchParams.get('to') ?? '0', 10);

  const supabase = createAdminClient();
  const fplSeason = await getCurrentFplSeason();
  const refStatsSeason = await getLatestReferenceStatsSeason(supabase);
  const refStats = await loadReferenceStats(supabase, refStatsSeason);

  const allCompleted = await fetchCompletedGws();
  const targetGws = allCompleted
    .filter((gw) => gw >= fromArg && (toArg === 0 || gw <= toArg))
    .sort((a, b) => a - b);

  const summary: {
    gameweek: number;
    statsUpdated: number;
    matchupsUpdated: number;
    statsErrors: number;
    matchupErrors: number;
  }[] = [];

  // Pre-load fpl_id → player mapping once (cheap; reused per GW).
  const { data: allPlayers } = await supabase
    .from('players')
    .select('id, fpl_id, pl_team_id, primary_position, secondary_positions')
    .not('fpl_id', 'is', null);
  const playerByFplId = new Map<number, {
    id: string; pl_team_id: number | null; primary_position: string; secondary_positions: string[] | null;
  }>();
  const playerById = new Map<string, {
    pl_team_id: number | null; primary_position: string; secondary_positions: string[] | null;
  }>();
  for (const p of allPlayers ?? []) {
    playerByFplId.set(p.fpl_id as number, p as any);
    playerById.set(p.id, p as any);
  }

  for (const gameweek of targetGws) {
    let statsUpdated = 0;
    let matchupsUpdated = 0;
    let statsErrors = 0;
    let matchupErrors = 0;

    // ── 1. player_stats v2 backfill ────────────────────────────────────
    if (doStats) {
      const elements = await fetchGwLive(gameweek);
      const teamFixtures = await fetchGwFixtures(gameweek);

      for (let i = 0; i < elements.length; i += 50) {
        const chunk = elements.slice(i, i + 50);
        await Promise.all(chunk.map(async (el) => {
          const dbPlayer = playerByFplId.get(el.id);
          if (!dbPlayer) return;
          const playerFixIds = teamFixtures[dbPlayer.pl_team_id ?? 0] ?? [];

          const writeOne = async (fixtureId: number, rawStats: RawStats) => {
            const v2 = calculateMatchRating(
              rawStats,
              dbPlayer.primary_position as GranularPosition,
              refStats as any,
            );
            const { error } = await supabase
              .from('player_stats')
              .update({
                stats: rawStats,
                fantasy_points_v2: v2.fantasyPoints,
                match_rating_v2: v2.rating,
              })
              .eq('player_id', dbPlayer.id)
              .eq('match_id', fixtureId)
              .eq('gameweek', gameweek);
            if (error) statsErrors++;
            else statsUpdated++;
          };

          if (el.explain && el.explain.length > 0) {
            for (const ex of el.explain) {
              const fixtureId = ex.fixture;
              const find = (key: string) =>
                ex.stats.find((s: any) => s.identifier === key)?.value;
              const fixtureMinutes = (find('minutes') ?? 0) as number;
              const totalMinutes = el.stats.minutes || 1;
              const ratio = fixtureMinutes / totalMinutes;

              const fixtureFplStats = {
                ...el.stats,
                minutes: fixtureMinutes,
                goals_scored: find('goals_scored') ?? 0,
                assists: find('assists') ?? 0,
                clean_sheets: find('clean_sheets') ?? 0,
                goals_conceded: find('goals_conceded') ?? 0,
                saves: find('saves') ?? 0,
                penalties_saved: find('penalties_saved') ?? 0,
                penalties_missed: find('penalties_missed') ?? 0,
                yellow_cards: find('yellow_cards') ?? 0,
                red_cards: find('red_cards') ?? 0,
                own_goals: find('own_goals') ?? 0,
                bonus: find('bonus') ?? 0,
                bps: find('bps') ?? 0,
                influence: (parseFloat(el.stats.influence) * ratio).toString(),
                creativity: (parseFloat(el.stats.creativity) * ratio).toString(),
                threat: (parseFloat(el.stats.threat) * ratio).toString(),
                ict_index: (parseFloat(el.stats.ict_index) * ratio).toString(),
                expected_goals: (parseFloat(el.stats.expected_goals) * ratio).toString(),
                expected_assists: (parseFloat(el.stats.expected_assists) * ratio).toString(),
                expected_goals_conceded: (parseFloat(el.stats.expected_goals_conceded) * ratio).toString(),
                tackles: Math.round((el.stats.tackles ?? 0) * ratio),
                clearances_blocks_interceptions: Math.round((el.stats.clearances_blocks_interceptions ?? 0) * ratio),
                recoveries: Math.round((el.stats.recoveries ?? 0) * ratio),
                defensive_contribution: Math.round((el.stats.defensive_contribution ?? 0) * ratio),
              };
              const rawStats = mapFplLiveToRawStats(fixtureFplStats);
              await writeOne(fixtureId, rawStats);
            }
          } else if (el.stats.minutes > 0) {
            // No explain block but the player has minutes — shouldn't happen
            // for finished GWs, but handle defensively with the fallback fixture.
            const fixtureId = playerFixIds[0] || (gameweek * 1000 + el.id);
            const rawStats = mapFplLiveToRawStats(el.stats);
            await writeOne(fixtureId, rawStats);
          }
        }));
      }
    }

    // ── 2. matchups score_*_v2 backfill ────────────────────────────────
    if (doMatchups) {
      const { data: gwMatchups } = await supabase
        .from('matchups')
        .select('id, lineup_a, lineup_b, team_a_id, team_b_id')
        .eq('gameweek', gameweek);

      if (gwMatchups && gwMatchups.length > 0) {
        // Collect player IDs for this GW's matchups
        const playerIds = new Set<string>();
        for (const m of gwMatchups) {
          (m.lineup_a as any)?.starters?.forEach((s: any) => playerIds.add(s.player_id));
          (m.lineup_a as any)?.bench?.forEach((b: any) => playerIds.add(b.player_id));
          (m.lineup_b as any)?.starters?.forEach((s: any) => playerIds.add(s.player_id));
          (m.lineup_b as any)?.bench?.forEach((b: any) => playerIds.add(b.player_id));
        }
        const { data: statsRows } = await supabase
          .from('player_stats')
          .select('player_id, fantasy_points_v2, stats')
          .eq('gameweek', gameweek)
          .in('player_id', Array.from(playerIds));

        const playerRecordV2 = new Map<string, { fixtures: { minutes: number; fantasyPoints: number; stats: RawStats | null }[] }>();
        for (const r of statsRows ?? []) {
          const stats = (r.stats as any) ?? null;
          const fixtureMins: number = stats?.minutes_played ?? 0;
          const pts: number = Number(r.fantasy_points_v2) || 0;
          const fix = { minutes: fixtureMins, fantasyPoints: pts, stats };
          const ex = playerRecordV2.get(r.player_id);
          if (!ex) playerRecordV2.set(r.player_id, { fixtures: [fix] });
          else ex.fixtures.push(fix);
        }

        const playerPositions = new Map<string, string[]>();
        const playerPlTeamId = new Map<string, number>();
        for (const pid of playerIds) {
          const p = playerById.get(pid);
          if (!p) continue;
          playerPositions.set(pid, [p.primary_position, ...(p.secondary_positions ?? [])]);
          if (p.pl_team_id) playerPlTeamId.set(pid, p.pl_team_id);
        }

        for (const m of gwMatchups) {
          const lineupA = normalizeMatchupLineup(m.lineup_a as any);
          const lineupB = normalizeMatchupLineup(m.lineup_b as any);
          // GW is finished → role-aware re-score against lineup slot.
          const scoreAv2 = calculateTeamScore(
            lineupA, playerRecordV2, playerPositions, playerPlTeamId, refStats as any, true, new Set(),
          );
          const scoreBv2 = calculateTeamScore(
            lineupB, playerRecordV2, playerPositions, playerPlTeamId, refStats as any, true, new Set(),
          );
          const { error } = await supabase
            .from('matchups')
            .update({ score_a_v2: scoreAv2, score_b_v2: scoreBv2 })
            .eq('id', m.id);
          if (error) matchupErrors++;
          else matchupsUpdated++;
        }
      }
    }

    summary.push({ gameweek, statsUpdated, matchupsUpdated, statsErrors, matchupErrors });
  }

  return NextResponse.json({
    ok: true,
    season: fplSeason,
    refStatsSeason,
    gameweeks: targetGws,
    summary,
  });
}
