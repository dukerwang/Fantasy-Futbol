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
import { loadReferenceStats } from '@/lib/scoring/matchups';
import { resolveAllStalledGameweeks, processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';
import { isFinishedProvisionalGraceElapsed } from '@/lib/scoring/gameweekTiming';
import { getCurrentFplSeason, getLatestReferenceStatsSeason } from '@/lib/season/currentSeason';
import { snapshotCurrentFplFixtures } from '@/lib/fixtures/upsertFixtures';
import { recomputePositionRanks, type RecomputeResult } from '@/lib/stats/seasonStats';
import type { GranularPosition, FplLivePlayerStats } from '@/types';
import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

export const maxDuration = 300;

const FPL_BASE = 'https://fantasy.premierleague.com/api';

/**
 * Real FPL fixture ids for a season are 1-380. Anything at or above this is a
 * placeholder this route minted for a player with no fixture to attach to
 * (gameweek * 1000 + element id), and is safe to delete once a real one lands.
 */
const SYNTHETIC_MATCH_ID_FLOOR = 1000;


interface GameweekWindow {
    gw: number;
    /** Deadline has passed and FPL hasn't marked it finished — worth a live sync. */
    isLiveWindow: boolean;
}

/**
 * The current gameweek, plus whether it's actually worth running a live sync
 * for it right now. Backs the pg_cron tick's idle short-circuit (below) — an
 * explicit `?gw=` call always runs the full sync regardless of this flag.
 *
 * A GW stays "live" through finished_provisional (all fixtures blew full
 * time) until FINISHED_PROVISIONAL_GRACE_MINUTES have passed since its last
 * kickoff — matching resolveAllStalledGameweeks' lock gate. Without this,
 * the sync self-skipped the instant finished_provisional flipped true, so
 * player_stats froze on whatever it last captured — which, right at that
 * moment, is typically still missing bonus points and the
 * influence/creativity/threat/ict_index fields FPL only publishes some time
 * after full time. That's what zeroed out Declan Rice's DM rating on
 * 2026-08-21: nothing was ever going to re-sync the real numbers in, grace
 * period on the lock or not. Keeping the sync itself alive through the same
 * window is what actually gives it a chance to catch the corrected data.
 */
async function getCurrentGameweekWindow(): Promise<GameweekWindow> {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
        next: { revalidate: 0 } // Always fresh — stale response picks wrong GW
    });
    const data = await res.json();
    const now = new Date();
    let gw = 0;
    let finished = false;
    let finishedProvisional = false;
    for (const ev of data.events as any[]) {
        if (ev.deadline_time && new Date(ev.deadline_time) <= now && ev.id >= gw) {
            gw = ev.id;
            finished = !!ev.finished;
            finishedProvisional = !!ev.finished_provisional;
        }
    }
    if (!gw) return { gw, isLiveWindow: false };
    if (finished) return { gw, isLiveWindow: false };
    if (!finishedProvisional) return { gw, isLiveWindow: true };
    const graceElapsed = await isFinishedProvisionalGraceElapsed(gw);
    return { gw, isLiveWindow: !graceElapsed };
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
    const gwParam = searchParams.get('gw');
    let gw = parseInt(gwParam ?? '0', 10);
    // An explicit ?gw= is a deliberate call (manual backfill/re-sync) and
    // always runs the full sync. Auto-derived gw is the pg_cron tick — cheap
    // to run every 2 minutes most of the time because most ticks land outside
    // an actual live window and skip before touching the ~600-player payload,
    // though it stays "live" (and keeps paying that cost) through the
    // finished_provisional grace window too — see getCurrentGameweekWindow.
    let isLiveWindow = true;
    if (!gw) {
      const window = await getCurrentGameweekWindow();
      gw = window.gw;
      isLiveWindow = window.isLiveWindow;
    }
    if (!gw) return NextResponse.json({ error: 'gw could not be determined' }, { status: 400 });
    if (!isLiveWindow) {
      return NextResponse.json({ ok: true, mode: 'fpl_live', gameweek: gw, skipped: 'not_live_window' });
    }
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
  const fplSeason = await getCurrentFplSeason(undefined, true);

  // 3. Fetch fixtures to map teams to fixture IDs (for DGW support)
  const fixturesRes = await fetch(`${FPL_BASE}/fixtures/?event=${gameweek}`);
  const fixtures = await fixturesRes.json();

  interface FplFixtureRaw {
    id: number;
    event: number | null;
    team_h: number;
    team_a: number;
    kickoff_time: string | null;
  }

  // Snapshot this gameweek's fixtures, season-stamped and slug-keyed. Without
  // the season stamp these rows are overwritten by next season's at the same
  // fixture ids, which is what erased the 2025-26 fixture list.
  try {
    const snap = await snapshotCurrentFplFixtures(supabase, fplSeason, gameweek);
    if (snap.skipped > 0) {
      console.warn(`pl_fixtures: skipped ${snap.skipped} fixture(s) with unrecognised clubs`);
    }
  } catch (err) {
    console.error('Failed to snapshot PL fixtures:', err);
  }

  const teamFixtures: Record<number, number[]> = {};
  fixtures.forEach((f: FplFixtureRaw) => {
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
          // The gameweek's real fixtures for THIS player, straight from the
          // payload describing them. The old code asked teamFixtures for them,
          // keyed on players.pl_team_id — a seasonal id the player sync
          // overwrites — and when that lookup came back short it treated a
          // double gameweek as a single one and deleted the first match while
          // writing the second. 156 appearances were lost that way in 2025-26.
          const realFixtureIds = el.explain
            .map((ex: { fixture: number }) => ex.fixture)
            .filter((id: number) => id < SYNTHETIC_MATCH_ID_FLOOR);

          if (realFixtureIds.length > 0) {
            // One delete per player per gameweek, clearing only rows that no
            // longer describe a match they featured in — synthetic placeholders
            // and stale fixture ids — and never a sibling of a double gameweek.
            await supabase
              .from('player_stats')
              .delete()
              .eq('player_id', dbPlayer.id)
              .eq('season', fplSeason)
              .eq('gameweek', gameweek)
              .not('match_id', 'in', `(${realFixtureIds.join(',')})`);
          }

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
              bps: Math.round((el.stats.bps ?? 0) * ratio),
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
            // Calculate using the official promoted V2 scoring engine
            const v2 = calculateMatchRating(
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
                fantasy_points: v2.fantasyPoints,
                match_rating: v2.rating,
              },
              { onConflict: 'player_id,season,match_id' },
            );
            if (!error) saved++;
          }
        } else {
          // Fallback for players who didn't play (DNP)
          const fixtureId = playerFixIds[0] || (gameweek * SYNTHETIC_MATCH_ID_FLOOR + el.id);
          const rawStats = mapFplLiveToRawStats(el.stats);
          const v2 = calculateMatchRating(
            rawStats,
            dbPlayer.primary_position as GranularPosition,
            refStats as any
          );

          // Clear stale placeholders only. A real fixture row here means an
          // earlier sync recorded an appearance FPL is momentarily not
          // explaining; deleting it would erase a match that was played.
          await supabase
            .from('player_stats')
            .delete()
            .eq('player_id', dbPlayer.id)
            .eq('season', fplSeason)
            .eq('gameweek', gameweek)
            .gte('match_id', SYNTHETIC_MATCH_ID_FLOOR)
            .neq('match_id', fixtureId);

          await supabase.from('player_stats').upsert(
            {
              player_id: dbPlayer.id,
              match_id: fixtureId,
              gameweek,
              season: fplSeason,
              stats: rawStats,
              fantasy_points: v2.fantasyPoints,
              match_rating: v2.rating,
            },
            { onConflict: 'player_id,season,match_id' },
          );
          saved++;
        }
      }),
    );
  }

  // Recalculate total_points and form for all players from player_stats
  await supabase.rpc('update_player_fantasy_scores', { p_season: fplSeason });

  // Recompute pre-computed form_rating (avg match_rating over last 5 appearances)
  await supabase.rpc('update_player_form_ratings', { p_season: fplSeason });

  // Positional ranks are re-scored per position (migration 085) and so must be
  // recomputed here, once totals are settled, rather than derived in the view.
  let positionRanks: RecomputeResult | null = null;
  try {
    positionRanks = await recomputePositionRanks(supabase, fplSeason);
  } catch (err) {
    // A rank refresh failing must not lose the stats that were just written.
    console.error('recomputePositionRanks failed:', err);
  }

  // Eagerly recompute this gameweek's matchup totals so Realtime subscribers
  // (LiveMatchupCard, matchup detail pages) see fresh scores on the sync's own
  // schedule instead of waiting for someone to load a page. `finished=false`
  // — this is a live-pass update, not the final lock-in, which stays exactly
  // where it already was: resolveAllStalledGameweeks below.
  try {
    await processMatchupsForGameweek(gameweek, false);
  } catch (err) {
    console.error('processMatchupsForGameweek (live pass) failed:', err);
  }

  // Resolve all stalled GWs — not just the one being synced.
  // This catches GWs that were left as 'live' once getCurrentGameweekWindow() rolled forward.
  const resolution = await resolveAllStalledGameweeks();

  return NextResponse.json({ ok: true, mode: 'fpl_live', gameweek, saved, resolution, positionRanks });
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

  // Snapshot the whole season's fixtures, season-stamped and slug-keyed.
  try {
    const season = await getCurrentFplSeason(undefined, true);
    const snap = await snapshotCurrentFplFixtures(supabase, season);
    if (snap.skipped > 0) {
      console.warn(`pl_fixtures: skipped ${snap.skipped} fixture(s) with unrecognised clubs`);
    }
  } catch (err) {
    console.error('Failed to sync PL fixtures in fpl_form mode:', err);
  }

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
