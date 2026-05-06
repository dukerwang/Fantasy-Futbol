/**
 * POST /api/sync/stats
 *
 * Modes:
 *   ?mode=fpl_form       — Bulk-sync FPL form / status / points (lightweight)
 *   ?mode=fpl_live&gw=N  — Sync per-match ratings for gameweek N via FPL live data
 *   ?mode=trigger_ratings&gw=N — Invoke the Edge Function for full rating sync
 *
 * The legacy fixture-based API-Football path has been removed in favour of
 * the FPL live rating system.
 */

import { calculateMatchRating, mapFplLiveToRawStats } from '@/lib/scoring/engine';
import { loadReferenceStats } from '@/lib/scoring/matchups';
import { processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';
import { createAdminClient } from '@/lib/supabase/admin';
import { getCurrentFplSeason, getLatestReferenceStatsSeason } from '@/lib/season/currentSeason';
import type { GranularPosition, FplLivePlayerStats } from '@/types';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const FPL_BASE = 'https://fantasy.premierleague.com/api';


async function getCurrentGameweek(): Promise<number> {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
        next: { revalidate: 3600 }
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

  if (mode === 'trigger_ratings') {
    const gw = parseInt(searchParams.get('gw') ?? '0', 10);
    if (!gw) return NextResponse.json({ error: 'gw is required' }, { status: 400 });
    return triggerEdgeFunctionRatings(gw);
  }

  return NextResponse.json(
    { error: 'Invalid mode. Use fpl_form, fpl_live, or trigger_ratings.' },
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

            const fixtureFplStats = {
              ...el.stats,
              minutes: fixtureMinutes,
              goals_scored: ex.stats.find((s: any) => s.identifier === 'goals_scored')?.value ?? 0,
              assists: ex.stats.find((s: any) => s.identifier === 'assists')?.value ?? 0,
              clean_sheets: ex.stats.find((s: any) => s.identifier === 'clean_sheets')?.value ?? 0,
              goals_conceded: ex.stats.find((s: any) => s.identifier === 'goals_conceded')?.value ?? 0,
              saves: ex.stats.find((s: any) => s.identifier === 'saves')?.value ?? 0,
              penalties_saved: ex.stats.find((s: any) => s.identifier === 'penalties_saved')?.value ?? 0,
              penalties_missed: ex.stats.find((s: any) => s.identifier === 'penalties_missed')?.value ?? 0,
              yellow_cards: ex.stats.find((s: any) => s.identifier === 'yellow_cards')?.value ?? 0,
              red_cards: ex.stats.find((s: any) => s.identifier === 'red_cards')?.value ?? 0,
              bonus: ex.stats.find((s: any) => s.identifier === 'bonus')?.value ?? 0,
              bps: ex.stats.find((s: any) => s.identifier === 'bps')?.value ?? 0,
              // Distribute non-point stats by minute ratio
              influence: (parseFloat(el.stats.influence) * ratio).toString(),
              creativity: (parseFloat(el.stats.creativity) * ratio).toString(),
              threat: (parseFloat(el.stats.threat) * ratio).toString(),
              ict_index: (parseFloat(el.stats.ict_index) * ratio).toString(),
              expected_goals: (parseFloat(el.stats.expected_goals) * ratio).toString(),
              expected_assists: (parseFloat(el.stats.expected_assists) * ratio).toString(),
              expected_goals_conceded: (parseFloat(el.stats.expected_goals_conceded) * ratio).toString(),
            };

            const rawStats = mapFplLiveToRawStats(fixtureFplStats);
            const { rating, fantasyPoints } = calculateMatchRating(
              rawStats,
              dbPlayer.primary_position as GranularPosition,
              refStats as any
            );

            const { error } = await supabase.from('player_stats').upsert(
              {
                player_id: dbPlayer.id,
                match_id: fixtureId,
                gameweek,
                season: fplSeason,
                stats: rawStats,
                fantasy_points: fantasyPoints,
                match_rating: rating,
              },
              { onConflict: 'player_id,match_id' },
            );
            if (!error) saved++;
          }
        } else {
          // Fallback for players who didn't play (DNP)
          const fixtureId = playerFixIds[0] || (gameweek * 1000 + el.id);
          const rawStats = mapFplLiveToRawStats(el.stats);
          const { rating, fantasyPoints } = calculateMatchRating(
            rawStats,
            dbPlayer.primary_position as GranularPosition,
            refStats as any
          );

          await supabase.from('player_stats').upsert(
            {
              player_id: dbPlayer.id,
              match_id: fixtureId,
              gameweek,
              season: fplSeason,
              stats: rawStats,
              fantasy_points: fantasyPoints,
              match_rating: rating,
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

  // Precision Finish: resolve league matchups immediately if FPL marks the GW as finished.
  // events[gw].finished = true means bonus points are applied and the GW is fully locked.
  const resolution = await tryResolveGameweekIfFinished(gameweek);

  return NextResponse.json({ ok: true, mode: 'fpl_live', gameweek, saved, resolution });
}

// ── Precision Finish: resolve league matchups as soon as FPL locks the GW ────

async function tryResolveGameweekIfFinished(gameweek: number): Promise<{
  resolved: boolean;
  reason: string;
  detail?: string;
}> {
  try {
    // Check bootstrap-static for events[gameweek].finished — this is set by FPL
    // only after bonus points are applied and all GW data is locked.
    const bsRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      next: { revalidate: 0 },
    });
    if (!bsRes.ok) return { resolved: false, reason: 'fpl_api_error' };

    const bsData = await bsRes.json();
    const gwEvent = (bsData.events as any[]).find((e) => e.id === gameweek);

    if (!gwEvent?.finished) {
      return { resolved: false, reason: 'gw_not_finished_yet' };
    }

    const admin = createAdminClient();

    // Check if there are any unresolved matchups for this GW — idempotency guard
    const { data: unresolved } = await admin
      .from('matchups')
      .select('id')
      .eq('gameweek', gameweek)
      .neq('status', 'completed')
      .limit(1);

    if (!unresolved || unresolved.length === 0) {
      return { resolved: false, reason: 'already_resolved' };
    }

    await processMatchupsForGameweek(gameweek, true);
    return { resolved: true, reason: 'fpl_gw_finished' };
  } catch (err: any) {
    // Non-blocking — stats sync still succeeds even if resolution fails
    return { resolved: false, reason: 'error', detail: String(err) };
  }
}

// ── Trigger Edge Function ─────────────────────────────────────────────────

async function triggerEdgeFunctionRatings(gameweek: number): Promise<NextResponse> {
  const edgeFnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/sync-ratings`;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

  try {
    const res = await fetch(edgeFnUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${serviceKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ gameweek }),
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `Edge function error: ${res.status}`, detail: text },
        { status: 502 },
      );
    }

    const result = await res.json();
    return NextResponse.json({ ok: true, mode: 'trigger_ratings', gameweek, result });
  } catch (err) {
    return NextResponse.json(
      { error: 'Failed to invoke Edge Function', detail: String(err) },
      { status: 500 },
    );
  }
}

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
