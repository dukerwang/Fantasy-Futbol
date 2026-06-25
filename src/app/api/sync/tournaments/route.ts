/**
 * POST /api/sync/tournaments
 *
 * Actions (via `action` search param):
 *   - create:   Generate a new tournament for a league
 *   - advance:  Process completed gameweeks and advance winners
 *
 * Create params:
 *   league_id, type (primary_cup | secondary_cup | consolation_cup), start_gameweek
 *
 * Advance params:
 *   tournament_id, gameweek
 */
import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { processMatchupsForGameweek } from '@/lib/scoring/matchupProcessor';
import { createTournament } from '@/lib/tournaments/createTournaments';
import { executeAdvanceTournament } from '@/lib/tournaments/advanceTournament';
import type { TournamentType } from '@/types';

export const maxDuration = 60;

export async function GET(req: NextRequest) { return POST(req); }

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret') ??
    req.headers.get('authorization')?.replace('Bearer ', '');
  if (!secret || !process.env.CRON_SECRET || secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const action = searchParams.get('action');

  if (action === 'create') return handleCreate(req, searchParams);
  if (action === 'advance') return handleAdvance(req, searchParams);
  if (action === 'resolve_stalled') return handleResolveStalled();

  return NextResponse.json({ error: 'Invalid action. Use ?action=create, ?action=advance, or ?action=resolve_stalled' }, { status: 400 });
}

// ─── CREATE TOURNAMENT ────────────────────────────────────────

async function handleCreate(_req: NextRequest, params: URLSearchParams) {
  const leagueId = params.get('league_id');
  const type = params.get('type') as TournamentType | null;
  const startGw = parseInt(params.get('start_gameweek') ?? '1', 10);

  if (!leagueId || !type) {
    return NextResponse.json({ error: 'league_id and type required' }, { status: 400 });
  }

  const validTypes: TournamentType[] = ['primary_cup', 'secondary_cup', 'consolation_cup'];
  if (!validTypes.includes(type)) {
    return NextResponse.json({ error: `Invalid type. Must be one of: ${validTypes.join(', ')}` }, { status: 400 });
  }

  const admin = createAdminClient();

  // Fetch season from league
  const { data: leagueRow, error: leagueErr } = await admin
    .from('leagues')
    .select('current_season')
    .eq('id', leagueId)
    .single();

  if (leagueErr || !leagueRow) {
    return NextResponse.json({ error: 'League not found' }, { status: 404 });
  }

  const season = leagueRow.current_season ?? '2025-26';
  const result = await createTournament(admin, leagueId, type, startGw, season);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }

  return NextResponse.json(result);
}

// ─── ADVANCE TOURNAMENT ──────────────────────────────────────

async function handleAdvance(_req: NextRequest, params: URLSearchParams) {
  const tournamentId = params.get('tournament_id');
  const gameweek = parseInt(params.get('gameweek') ?? '0', 10);

  if (!tournamentId || !gameweek) {
    return NextResponse.json({ error: 'tournament_id and gameweek required' }, { status: 400 });
  }

  try {
    // Delegate to the shared lib (same function used by matchupProcessor)
    const result = await executeAdvanceTournament(tournamentId, gameweek);
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

// ─── RESOLVE STALLED GAMEWEEKS ───────────────────────────────

/**
 * Detects and force-resolves stalled gameweeks sequentially.
 * If >48 hours have passed since the last non-postponed fixture's kickoff,
 * the gameweek is force-finished. Tournament brackets are advanced automatically.
 */
async function handleResolveStalled() {
  const admin = createAdminClient();

  // Derive current GW and fetch FPL events for use as the primary completion signal
  let currentGw = 0;
  let fplEvents: any[] = [];
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { next: { revalidate: 0 } });
    if (!fplRes.ok) return NextResponse.json({ error: 'Failed to fetch FPL data' }, { status: 502 });

    const fplData = await fplRes.json();
    fplEvents = fplData.events as any[];
    const now = new Date();
    for (const ev of fplEvents) {
      if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
        if (ev.id > currentGw) {
          currentGw = ev.id;
        }
      }
    }
  } catch (err) {
    return NextResponse.json({ error: 'FPL API error', detail: String(err) }, { status: 502 });
  }

  // 1. Activation migration for current/past rounds
  const { data: activeRounds } = await admin
    .from('tournament_rounds')
    .select('id')
    .lte('start_gameweek', currentGw);
    
  if (activeRounds && activeRounds.length > 0) {
    const roundIds = activeRounds.map(r => r.id);
    await admin
      .from('tournament_matchups')
      .update({ status: 'active' })
      .in('round_id', roundIds)
      .not('team_a_id', 'is', null)
      .not('team_b_id', 'is', null)
      .eq('status', 'pending');
  }

  // 2. Future Reset: if active but in future round, reset to pending
  // This handles the user's issue where MW38 matches were accidentally marked active.
  const { data: futureRounds } = await admin
    .from('tournament_rounds')
    .select('id')
    .gt('start_gameweek', currentGw);
    
  if (futureRounds && futureRounds.length > 0) {
    const futureRoundIds = futureRounds.map(r => r.id);
    await admin
      .from('tournament_matchups')
      .update({ status: 'pending' })
      .in('round_id', futureRoundIds)
      .eq('status', 'active');
  }

  // 3. Auto-complete tournaments past their final date
  const { data: activeTourneys } = await admin
    .from('tournaments')
    .select('id')
    .eq('status', 'active');
    
  if (activeTourneys) {
    for (const t of activeTourneys) {
      const { data: lastRounds } = await admin
        .from('tournament_rounds')
        .select('end_gameweek')
        .eq('tournament_id', t.id)
        .order('end_gameweek', { ascending: false })
        .limit(1);
        
      if (lastRounds && lastRounds.length > 0 && lastRounds[0].end_gameweek < currentGw) {
        await admin.from('tournaments').update({ status: 'completed' }).eq('id', t.id);
      }
    }
  }

  // 2. Identify gameweeks to check (current and last 4)
  const gwsToCheck = [];
  for (let i = 0; i < 5; i++) {
    const gw = currentGw - i;
    if (gw >= 1) gwsToCheck.push(gw);
  }
  gwsToCheck.sort((a, b) => a - b);
  
  const results = [];

  // Check FPL fixtures per GW, sequentially
  for (const gw of gwsToCheck) {
    try {
      const fixRes = await fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${gw}`, { next: { revalidate: 60 } });
      if (!fixRes.ok) continue;

      const fixtures = await fixRes.json();
      const now = new Date();
      let allNonPostponedFinished = true;
      let latestKickoff: Date | null = null;

      for (const f of fixtures) {
        const isPostponed = f.event === null || f.postponed === true;
        if (isPostponed) continue;

        if (!f.finished && !f.finished_provisional) {
          allNonPostponedFinished = false;
        }

        if (f.kickoff_time) {
          const ko = new Date(f.kickoff_time);
          if (!latestKickoff || ko > latestKickoff) latestKickoff = ko;
        }
      }

      const hoursElapsed = latestKickoff ? (now.getTime() - latestKickoff.getTime()) / (1000 * 60 * 60) : 0;

      // Primary signal: FPL bootstrap-static events[gw].finished = true means bonus
      // points are applied and the GW is fully locked. This is the most reliable trigger.
      const fplGwFinished = fplEvents.find((e) => e.id === gw)?.finished === true;

      // Secondary: all non-postponed fixtures are done (fires before bonus points in some cases)
      // Emergency fallback: 48 hours elapsed since last kickoff
      const shouldForceResolve = fplGwFinished || allNonPostponedFinished || hoursElapsed > 48 || gw < currentGw;

      if (shouldForceResolve) {
        // 1. Resolve League Matchups if not yet completed
        const { data: unresolvedLeague } = await admin
          .from('matchups')
          .select('id')
          .eq('gameweek', gw)
          .neq('status', 'completed')
          .limit(1);

        let leagueSync = null;
        if (unresolvedLeague && unresolvedLeague.length > 0) {
          leagueSync = await processMatchupsForGameweek(gw, true);
        }
        
        // 2. Proactively Advance active tournaments for this gameweek
        const { data: activeTournaments } = await admin
          .from('tournaments')
          .select('id')
          .eq('status', 'active');
          
        let advancedCount = 0;
        if (activeTournaments) {
          for (const t of activeTournaments) {
            await executeAdvanceTournament(t.id, gw);
            advancedCount++;
          }
        }

        results.push({
          gw,
          status: 'processed',
          leagueSyncTriggered: !!leagueSync,
          tournamentsAdvanced: advancedCount,
          reason: fplGwFinished ? 'fpl_gw_finished' : (allNonPostponedFinished ? 'all_fixtures_done' : (gw < currentGw ? 'past_gameweek' : `stalled_${hoursElapsed.toFixed(0)}h`)),
        });
      } else {
        results.push({ gw, status: 'in_progress', hoursElapsed });
      }

    } catch (e: any) {
      results.push({ gw, error: 'sync/advance failed', detail: e.message });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: gwsToCheck,
    results
  });
}

// ─── Helpers ──────────────────────────────────────────────────

