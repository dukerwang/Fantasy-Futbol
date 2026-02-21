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
        ? `https://resources.premierleague.com/premierleague/photos/players/110x140/p${photoCode}.png`
        : null;

      return {
        fpl_id: el.id,
        name: `${el.first_name} ${el.second_name}`,
        web_name: el.web_name,
        pl_team: teamMap.get(el.team) ?? 'Unknown',
        pl_team_id: el.team,
        primary_position: position,
        secondary_positions: [] as string[],
        market_value: parseFloat((el.now_cost / 10).toFixed(1)), // FPL price in £m
        photo_url: photoUrl,
        fpl_status: el.status,
        fpl_news: el.news || null,
        fpl_total_points: el.total_points ?? null,
        fpl_form: el.form ? parseFloat(el.form) : null,
        is_active: el.status !== 'u', // 'u' = unavailable (left club)
        updated_at: new Date().toISOString(),
      };
    });

  const admin = createAdminClient();

  // Find existing fpl_ids to detect new arrivals
  const { data: existingPlayers } = await admin.from('players').select('fpl_id');
  const existingFplIds = new Set((existingPlayers ?? []).map((p) => p.fpl_id));

  const { error } = await admin
    .from('players')
    .upsert(rows, { onConflict: 'fpl_id', ignoreDuplicates: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // --- System Auctions for High-Value Players ---
  const newHighValuePlayers = rows.filter(
    (row) => !existingFplIds.has(row.fpl_id) && row.market_value >= 50.0
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

  return NextResponse.json({ ok: true, synced: rows.length, systemBidsSeeded: newHighValuePlayers.length });
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
