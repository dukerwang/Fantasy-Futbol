/**
 * POST /api/sync/stats
 *
 * Modes:
 *   ?mode=fpl_form       — Bulk-sync FPL form / status / points (lightweight)
 *   ?mode=fpl_live&gw=N  — Sync per-match ratings for gameweek N via FPL live data
 *
 * The legacy fixture-based API-Football path has been removed in favour of
 * the FPL live rating system. The Supabase Edge Function trigger_ratings mode
 * was removed in migration 037 — this Next.js route is the single source of
 * truth for the scoring engine.
 */

import { calculateMatchRating, mapFplLiveToRawStats } from '@/lib/scoring/engine';
import { calculateMatchRatingV1 } from '@/lib/scoring/matchRatingV1Legacy';
import { loadReferenceStats } from '@/lib/scoring/matchups';
import { resolveAllStalledGameweeks } from '@/lib/scoring/matchupProcessor';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentFplSeason, getLatestReferenceStatsSeason } from '@/lib/season/currentSeason';
import type { GranularPosition, FplLivePlayerStats } from '@/types';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const FPL_BASE = 'https://fantasy.premierleague.com/api';


async function getCurrentGameweek(): Promise<number> {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
        next: { revalidate: 0 } // Always fresh — stale response picks wrong GW
    });
    const data = await res.json();
    const now = new Date();
    let gw = 0;
    for (const ev of data.events as any[]) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
            gw = Math.max(gw, ev.id);
        }
    }
    return gw;
}

export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const mode = searchParams.get('mode');

  if (mode === 'fpl_form') {
    return syncFplForm();
  }

  if (mode === 'fpl_live') {
    let gw = parseInt(searchParams.get('gw') ?? '0', 10);
    if (!gw) gw = await getCurrentGameweek();
    if (!gw) return NextResponse.json({ error: 'gw could not be determined' }, { status: 400 });
    return syncFplLiveRatings(gw);
  }

  return NextResponse.json(
    { error: 'Invalid mode. Use fpl_form or fpl_live.' },
    { status: 400 },
  );
}

// ── FPL Live Ratings Sync ─────────────────────────────────────────────────

async function syncFplLiveRatings(gameweek: number): Promise<NextResponse> {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  // 1. Fetch live data from FPL
  const fplRes = await fetch(`${FPL_BASE}/event/${gameweek}/live/`, {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' },
    next: { revalidate: 0 },
  });

  if (!fplRes.ok) {
    return NextResponse.json({ error: `FPL live error: ${fplRes.status}` }, { status: 502 });
  }

  const fplData = await fplRes.json();
  const elements = (fplData.elements ?? []) as FplLivePlayerStats[];

  // 2. Load Reference Stats once for the entire batch
  const refStatsSeason = await getLatestReferenceStatsSeason(supabase as any);
  const refStats = await loadReferenceStats(supabase as any, refStatsSeason);
  const fplSeason = await getCurrentFplSeason();

  // 3. Fetch fixtures to map teams to fixture IDs (for DGW support)
  const fixturesRes = await fetch(`${FPL_BASE}/fixtures/?event=${gameweek}`);
  const fixtures = await fixturesRes.json();
  const teamFixtures: Record<number, number[]> = {};
  fixtures.forEach((f: any) => {
    if (!teamFixtures[f.team_h]) teamFixtures[f.team_h] = [];
    if (!teamFixtures[f.team_a]) teamFixtures[f.team_a] = [];
    teamFixtures[f.team_h].push(f.id);
    teamFixtures[f.team_a].push(f.id);
  });

  // 4. Bulk lookup players to avoid N+1 queries
  const fplIds = elements.map(el => el.id);
  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, fpl_id, pl_team_id, primary_position')
    .in('fpl_id', fplIds);
  
  const playerMap = new Map();
  dbPlayers?.forEach(p => playerMap.set(p.fpl_id, p));

  let saved = 0;

  // 5. Process in batches
  for (let i = 0; i < elements.length; i += 50) {
    const chunk = elements.slice(i, i + 50);

    await Promise.all(
      chunk.map(async (el) => {
        const dbPlayer = playerMap.get(el.id);
        if (!dbPlayer) return;

        const playerFixIds = teamFixtures[dbPlayer.pl_team_id || 0] || [];
        
        // If player has played or is in squad, FPL provides 'explain' per match
        if (el.explain && el.explain.length > 0) {
          for (const ex of el.explain) {
            const fixtureId = ex.fixture;
            const fixtureMinutes = ex.stats.find((s: any) => s.identifier === 'minutes')?.value ?? 0;
            const totalMinutes = el.stats.minutes || 1;
            const ratio = fixtureMinutes / totalMinutes;

            const findExplain = (key: string) =>
              ex.stats.find((s: { identifier: string; value: number }) => s.identifier === key)?.value;

            const fixtureFplStats = {
              ...el.stats,
              minutes: fixtureMinutes,
              goals_scored: findExplain('goals_scored') ?? 0,
              assists: findExplain('assists') ?? 0,
              clean_sheets: findExplain('clean_sheets') ?? 0,
              goals_conceded: findExplain('goals_conceded') ?? 0,
              saves: findExplain('saves') ?? 0,
              penalties_saved: findExplain('penalties_saved') ?? 0,
              penalties_missed: findExplain('penalties_missed') ?? 0,
              yellow_cards: findExplain('yellow_cards') ?? 0,
              red_cards: findExplain('red_cards') ?? 0,
              own_goals: findExplain('own_goals') ?? 0,
              bonus: findExplain('bonus') ?? 0,
              bps: findExplain('bps') ?? 0,
              // Distribute non-point GW-aggregate stats by minute ratio.
              // FPL only itemises point-bearing stats in `explain`; ICT/xG and
              // the granular defensive counts are GW totals on `el.stats`.
              influence: (parseFloat(el.stats.influence) * ratio).toString(),
              creativity: (parseFloat(el.stats.creativity) * ratio).toString(),
              threat: (parseFloat(el.stats.threat) * ratio).toString(),
              ict_index: (parseFloat(el.stats.ict_index) * ratio).toString(),
              expected_goals: (parseFloat(el.stats.expected_goals) * ratio).toString(),
              expected_assists: (parseFloat(el.stats.expected_assists) * ratio).toString(),
              expected_goals_conceded: (parseFloat(el.stats.expected_goals_conceded) * ratio).toString(),
              // Granular defensive (25/26+) — also GW totals; allocate by minute ratio.
              tackles: Math.round((el.stats.tackles ?? 0) * ratio),
              clearances_blocks_interceptions: Math.round((el.stats.clearances_blocks_interceptions ?? 0) * ratio),
              recoveries: Math.round((el.stats.recoveries ?? 0) * ratio),
              defensive_contribution: Math.round((el.stats.defensive_contribution ?? 0) * ratio),
            };

            const rawStats = mapFplLiveToRawStats(fixtureFplStats);
            // V2 = new (Phase 1+2) engine with granular defense, recomputed
            // reference stats, and FPL defensive_contribution.
            const v2 = calculateMatchRating(
              rawStats,
              dbPlayer.primary_position as GranularPosition,
              refStats as any
            );
            // V1 = frozen pre-rebalance engine, written to the legacy columns
            // so the admin shadow view can compare apples-to-apples.
            const v1 = calculateMatchRatingV1(
              rawStats,
              dbPlayer.primary_position as GranularPosition,
            );

            const { error } = await supabase.from('player_stats').upsert(
              {
                player_id: dbPlayer.id,
                match_id: fixtureId,
                gameweek,
                season: fplSeason,
                stats: rawStats,
                fantasy_points: v1.fantasyPoints,
                match_rating: v1.rating,
                fantasy_points_v2: v2.fantasyPoints,
                match_rating_v2: v2.rating,
              },
              { onConflict: 'player_id,match_id' },
            );
            if (!error) saved++;
          }
        } else {
          // Fallback for players who didn't play (DNP)
          const fixtureId = playerFixIds[0] || (gameweek * 1000 + el.id);
          const rawStats = mapFplLiveToRawStats(el.stats);
          const v2 = calculateMatchRating(
            rawStats,
            dbPlayer.primary_position as GranularPosition,
            refStats as any
          );
          const v1 = calculateMatchRatingV1(
            rawStats,
            dbPlayer.primary_position as GranularPosition,
          );

          await supabase.from('player_stats').upsert(
            {
              player_id: dbPlayer.id,
              match_id: fixtureId,
              gameweek,
              season: fplSeason,
              stats: rawStats,
              fantasy_points: v1.fantasyPoints,
              match_rating: v1.rating,
              fantasy_points_v2: v2.fantasyPoints,
              match_rating_v2: v2.rating,
            },
            { onConflict: 'player_id,match_id' },
          );
          saved++;
        }
      }),
    );
  }

  // Recalculate total_points and form for all players from player_stats
  await supabase.rpc('update_player_fantasy_scores');

  // Recompute pre-computed form_rating (avg match_rating over last 3 appearances)
  await supabase.rpc('update_player_form_ratings');

  // Resolve all stalled GWs — not just the one being synced.
  // This catches GWs that were left as 'live' once getCurrentGameweek() rolled forward.
  const resolution = await resolveAllStalledGameweeks();

  return NextResponse.json({ ok: true, mode: 'fpl_live', gameweek, saved, resolution });
}

// tryResolveGameweekIfFinished replaced by resolveAllStalledGameweeks in matchupProcessor.ts
// That function scans ALL live GWs in the DB, not just the one being synced.

// ── Bulk FPL Form Sync (unchanged) ────────────────────────────────────────

async function syncFplForm(): Promise<NextResponse> {
  const fplRes = await fetch(`${FPL_BASE}/bootstrap-static/`, {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' },
    next: { revalidate: 0 },
  });

  if (!fplRes.ok) {
    return NextResponse.json({ error: `FPL API error: ${fplRes.status}` }, { status: 502 });
  }

  const fplData = await fplRes.json();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const elements = fplData.elements as FplFormElement[];
  let updated = 0;

  for (let i = 0; i < elements.length; i += 50) {
    const chunk = elements.slice(i, i + 50);
    await Promise.all(
      chunk.map((el) =>
        supabase
          .from('players')
          .update({
            fpl_status: el.status,
            fpl_news: el.news || null,
          })
          .eq('fpl_id', el.id)
          .then(({ error }) => { if (!error) updated++; }),
      ),
    );
  }

  return NextResponse.json({ ok: true, mode: 'fpl_form_sync', updated });
}

interface FplFormElement {
  id: number;
  status: string;
  news: string;
}
