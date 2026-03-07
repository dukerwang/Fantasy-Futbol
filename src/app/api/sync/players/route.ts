/**
 * POST /api/sync/players
 *
 * Syncs Premier League players from the free FPL bootstrap API.
 * No API key required. Safe to call weekly.
 *
 * Protected by CRON_SECRET header.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { resolvePosition } from '@/lib/fpl/positionMap';
import { processPlayerTransferOut } from '@/lib/transfers/compensation';

export const maxDuration = 60; // 1 minute max for Vercel Hobby tier

const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

export async function POST(req: NextRequest) {
  const secret = req.headers.get('x-cron-secret');
  if (secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Fetch FPL bootstrap data
  const fplRes = await fetch(FPL_URL, {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' },
    next: { revalidate: 0 },
  });

  if (!fplRes.ok) {
    return NextResponse.json(
      { error: `FPL API error: ${fplRes.status}` },
      { status: 502 }
    );
  }

  const fplData = await fplRes.json();

  // Build team id → name map
  const teamMap = new Map<number, string>(
    (fplData.teams as { id: number; name: string }[]).map((t) => [t.id, t.name])
  );

  // Map each FPL element to our player schema
  const rows = (fplData.elements as FplElement[])
    .filter((el) => el.element_type >= 1 && el.element_type <= 4)
    .map((el) => {
      const position = resolvePosition(
        el.first_name,
        el.second_name,
        el.web_name,
        el.element_type
      );
      // FPL photo: "{code}.jpg" → use with premierleague CDN
      const photoCode = el.photo?.replace('.jpg', '') ?? null;
      const photoUrl = photoCode
        ? `https://resources.premierleague.com/premierleague25/photos/players/110x140/${photoCode}.png`
        : null;

      return {
        fpl_id: el.id,
        name: `${el.first_name} ${el.second_name}`,
        web_name: el.web_name,
        pl_team: teamMap.get(el.team) ?? 'Unknown',
        pl_team_id: el.team,
        primary_position: position,
        secondary_positions: [],
        market_value: parseFloat((el.now_cost / 10).toFixed(1)), // FPL price in £m
        photo_url: photoUrl,
        fpl_status: el.status,
        fpl_news: el.news || null,
        is_active: el.status !== 'u', // 'u' = unavailable (left club)
        updated_at: new Date().toISOString(),
      };
    });

  const admin = createAdminClient();

  // Snapshot existing players before upsert for transfer-out detection and to preserve secondary positions
  const { data: existingPlayers } = await admin.from('players').select('id, fpl_id, is_active, secondary_positions');
  const existingFplIds = new Set((existingPlayers ?? []).map((p) => p.fpl_id));

  // Map fpl_id → player.id for currently-active players
  const activeByFplId = new Map<number, string>(
    (existingPlayers ?? [])
      .filter((p) => p.is_active && p.fpl_id != null)
      .map((p) => [p.fpl_id as number, p.id as string]),
  );

  // Map fpl_id → secondary_positions
  const secondaryPositionsMap = new Map<number, string[]>(
    (existingPlayers ?? [])
      .filter((p) => p.fpl_id != null)
      .map((p) => [p.fpl_id as number, p.secondary_positions ?? []]),
  );

  // Re-map rows to inject the preserved secondary positions now that we have them
  const finalRows = rows.map((row) => ({
    ...row,
    secondary_positions: secondaryPositionsMap.get(row.fpl_id) ?? []
  }));

  const { error } = await admin
    .from('players')
    .upsert(finalRows, { onConflict: 'fpl_id', ignoreDuplicates: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // --- Auto Transfer-Out: detect permanent PL departures and trigger compensation ---
  const permanentDepartures = (fplData.elements as FplElement[]).filter((el) => {
    if (el.status !== 'u') return false;                     // must be unavailable
    if (!activeByFplId.has(el.id)) return false;             // must have been active before
    const news = (el.news ?? '').toLowerCase();
    const isLoan = news.includes('loan');
    const isPermanentTransfer = news.includes('transfer') || news.includes('joined');
    return isPermanentTransfer && !isLoan;
  });

  const autoTransferResults: { playerId: string; result: string }[] = [];
  for (const el of permanentDepartures) {
    const playerId = activeByFplId.get(el.id)!;
    try {
      const result = await processPlayerTransferOut(admin, playerId);
      autoTransferResults.push({
        playerId,
        result: `${result.playerName} transferred out — ${result.affectedTeams.length} team(s) compensated`,
      });
    } catch (err) {
      console.error(`[sync/players] Failed to process transfer out for player ${playerId}:`, err);
      autoTransferResults.push({ playerId, result: `error: ${String(err)}` });
    }
  }

  // --- System Auctions for High-Value Players ---
  const newHighValuePlayers = rows.filter(
    (row) => !existingFplIds.has(row.fpl_id) && row.market_value >= 40.0
  );

  if (newHighValuePlayers.length > 0) {
    const { data: insertedPlayers } = await admin
      .from('players')
      .select('id, fpl_id')
      .in('fpl_id', newHighValuePlayers.map(p => p.fpl_id));

    if (insertedPlayers && insertedPlayers.length > 0) {
      const { data: leagues } = await admin.from('leagues').select('id');
      const systemBids = [];
      const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

      for (const player of insertedPlayers) {
        for (const league of (leagues ?? [])) {
          systemBids.push({
            league_id: league.id,
            team_id: null,
            player_id: player.id,
            faab_bid: 0,
            status: 'pending',
            is_auction: true,
            expires_at: expiresAt,
          });
        }
      }

      if (systemBids.length > 0) {
        await admin.from('waiver_claims').insert(systemBids);
      }
    }
  }

  return NextResponse.json({
    ok: true,
    synced: rows.length,
    systemBidsSeeded: newHighValuePlayers.length,
    autoTransferOuts: autoTransferResults,
  });
}

// ─── FPL API types ────────────────────────────────────────────────────────────

interface FplElement {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  element_type: number; // 1=GK 2=DEF 3=MID 4=FWD
  team: number;
  now_cost: number;     // tenths of £m
  status: string;       // 'a'=available 'd'=doubtful 'u'=unavailable 's'=suspended 'i'=injured
  news: string;
  form: string;
  total_points: number;
  photo: string;        // "{code}.jpg"
}
