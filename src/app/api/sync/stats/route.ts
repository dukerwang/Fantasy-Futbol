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
import type { GranularPosition, FplLivePlayerStats } from '@/types';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 60; // 1 minute max for Vercel Hobby tier

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
  const refStats = await loadReferenceStats(supabase as any, '2025-26');

  let saved = 0;

  // 3. Process in batches of 50
  for (let i = 0; i < elements.length; i += 50) {
    const chunk = elements.slice(i, i + 50);

    await Promise.all(
      chunk.map(async (el) => {
        if (el.stats.minutes === 0) return;

        // Look up player by fpl_id
        const { data: dbPlayer } = await supabase
          .from('players')
          .select('id, primary_position')
          .eq('fpl_id', el.id)
          .single();

        if (!dbPlayer) return;

        const rawStats = mapFplLiveToRawStats(el.stats);
        
        // Use the same refStats loaded from the DB
        const { rating, fantasyPoints } = calculateMatchRating(
          rawStats,
          dbPlayer.primary_position as GranularPosition,
          refStats as any
        );

        const { error } = await supabase.from('player_stats').upsert(
          {
            player_id: dbPlayer.id,
            match_id: gameweek * 1000 + el.id, // composite key: gw + fpl_id
            gameweek,
            season: '2025-26',
            stats: rawStats,
            fantasy_points: fantasyPoints,
            match_rating: rating,
          },
          { onConflict: 'player_id,match_id' },
        );

        if (!error) saved++;
      }),
    );
  }

  // Recalculate total_points and form for all players from player_stats
  await supabase.rpc('update_player_fantasy_scores');

  // Recompute pre-computed form_rating (avg match_rating over last 3 appearances)
  await supabase.rpc('update_player_form_ratings');

  return NextResponse.json({ ok: true, mode: 'fpl_live', gameweek, saved });
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
