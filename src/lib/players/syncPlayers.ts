/**
 * src/lib/players/syncPlayers.ts
 *
 * Core player sync logic — extracted from the HTTP route so it can be called
 * directly by the season reset orchestrator (or any other internal caller)
 * without needing to make an authenticated HTTP request to itself.
 *
 * The HTTP route at /api/sync/players delegates to this.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { resolvePosition } from '@/lib/fpl/positionMap';
import { processPlayerTransferOut } from '@/lib/transfers/compensation';

const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

export interface SyncPlayersResult {
  synced: number;
  systemBidsSeeded: number;
  autoTransferOuts: { playerId: string; result: string }[];
  error?: string;
}

interface FplElement {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  element_type: number;
  team: number;
  now_cost: number;
  status: string;
  news: string;
  form: string;
  total_points: number;
  photo: string;
  birth_date?: string;
}

/**
 * Syncs Premier League players from the FPL bootstrap API into the database.
 * - Upserts all players by fpl_id
 * - Preserves manually-set positions, market values, and simplified names
 * - Detects permanent transfer-outs and triggers compensation
 * - Creates system FAAB auctions for newly-arriving high-value players
 *
 * Safe to call multiple times — fully idempotent.
 */
export async function syncPlayersFromFpl(admin: SupabaseClient): Promise<SyncPlayersResult> {
  // Fetch FPL bootstrap
  const fplRes = await fetch(FPL_URL, {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' },
    next: { revalidate: 0 },
  });

  if (!fplRes.ok) {
    return { synced: 0, systemBidsSeeded: 0, autoTransferOuts: [], error: `FPL API error: ${fplRes.status}` };
  }

  const fplData = await fplRes.json();

  // Build team id → name map
  const teamMap = new Map<number, string>(
    (fplData.teams as { id: number; name: string }[]).map((t) => [t.id, t.name]),
  );

  // Map each FPL element to our player schema
  const rows = (fplData.elements as FplElement[])
    .filter((el) => el.element_type >= 1 && el.element_type <= 4)
    .map((el) => {
      const position = resolvePosition(el.first_name, el.second_name, el.web_name, el.element_type);
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
        secondary_positions: [] as string[],
        market_value: parseFloat((el.now_cost / 10).toFixed(1)),
        photo_url: photoUrl,
        fpl_status: el.status,
        fpl_news: el.news || null,
        is_active: el.status !== 'u',
        date_of_birth: el.birth_date ?? null,
        updated_at: new Date().toISOString(),
      };
    });

  // Snapshot existing players to preserve manual overrides and detect transfer-outs
  const { data: existingPlayers } = await admin
    .from('players')
    .select('id, fpl_id, is_active, primary_position, secondary_positions, market_value, name, date_of_birth');

  const existingFplIds = new Set((existingPlayers ?? []).map((p) => p.fpl_id));

  const activeByFplId = new Map<number, string>(
    (existingPlayers ?? [])
      .filter((p) => p.is_active && p.fpl_id != null)
      .map((p) => [p.fpl_id as number, p.id as string]),
  );

  const primaryPositionMap = new Map<number, string>(
    (existingPlayers ?? [])
      .filter((p) => p.fpl_id != null && p.primary_position != null)
      .map((p) => [p.fpl_id as number, p.primary_position]),
  );

  const secondaryPositionsMap = new Map<number, string[]>(
    (existingPlayers ?? [])
      .filter((p) => p.fpl_id != null)
      .map((p) => [p.fpl_id as number, p.secondary_positions ?? []]),
  );

  const marketValueMap = new Map<number, number | null>(
    (existingPlayers ?? [])
      .filter((p) => p.fpl_id != null)
      .map((p) => [p.fpl_id as number, p.market_value]),
  );

  const nameMap = new Map<number, string>(
    (existingPlayers ?? [])
      .filter((p) => p.fpl_id != null && p.name != null)
      .map((p) => [p.fpl_id as number, p.name]),
  );

  // Re-map rows, preserving manually-set overrides
  const finalRows = rows.map((row) => ({
    ...row,
    name: nameMap.get(row.fpl_id) ?? row.name,
    primary_position: primaryPositionMap.get(row.fpl_id) ?? row.primary_position,
    secondary_positions: secondaryPositionsMap.get(row.fpl_id) ?? [],
    market_value:
      marketValueMap.has(row.fpl_id) && marketValueMap.get(row.fpl_id) !== null
        ? marketValueMap.get(row.fpl_id)
        : row.market_value,
  }));

  const { error } = await admin
    .from('players')
    .upsert(finalRows, { onConflict: 'fpl_id', ignoreDuplicates: false });

  if (error) {
    return { synced: 0, systemBidsSeeded: 0, autoTransferOuts: [], error: error.message };
  }

  // --- Auto Transfer-Out: detect permanent PL departures and trigger compensation ---
  const permanentDepartures = (fplData.elements as FplElement[]).filter((el) => {
    if (el.status !== 'u') return false;
    if (!activeByFplId.has(el.id)) return false;
    const news = (el.news ?? '').toLowerCase();
    return (news.includes('transfer') || news.includes('joined')) && !news.includes('loan');
  });

  const autoTransferOuts: { playerId: string; result: string }[] = [];
  for (const el of permanentDepartures) {
    const playerId = activeByFplId.get(el.id)!;
    try {
      const result = await processPlayerTransferOut(admin, playerId);
      autoTransferOuts.push({
        playerId,
        result: `${result.playerName} transferred out — ${result.affectedTeams.length} team(s) compensated`,
      });
    } catch (err) {
      console.error(`[syncPlayers] Failed to process transfer out for player ${playerId}:`, err);
      autoTransferOuts.push({ playerId, result: `error: ${String(err)}` });
    }
  }

  return { synced: rows.length, systemBidsSeeded: 0, autoTransferOuts };
}
