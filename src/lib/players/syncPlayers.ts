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
import { resolvePosition, FPL_POSITION_OVERRIDES } from '@/lib/fpl/positionMap';
import { processPlayerTransferOut } from '@/lib/transfers/compensation';

const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

interface SyncPlayersResult {
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

  interface DbPlayer {
    id: string;
    fpl_id: number | null;
    is_active: boolean;
    primary_position: string;
    secondary_positions: string[];
    market_value: number | null;
    name: string;
    web_name: string | null;
    pl_team: string | null;
    date_of_birth: string | null;
  }

  // Snapshot existing players to preserve manual overrides and detect transfer-outs
  const { data: rawPlayers } = await admin
    .from('players')
    .select('id, fpl_id, is_active, primary_position, secondary_positions, market_value, name, web_name, pl_team, date_of_birth');

  const existingPlayers: DbPlayer[] = (rawPlayers as DbPlayer[]) ?? [];

  const activeByFplId = new Map<number, string>(
    existingPlayers
      .filter((p) => p.is_active && p.fpl_id != null)
      .map((p) => [p.fpl_id as number, p.id]),
  );

  const existingByFplId = new Map<number, DbPlayer>();
  const existingByNormName = new Map<string, DbPlayer>();
  const existingByWebAndTeam = new Map<string, DbPlayer>();

  function normalizeName(str: string | null | undefined): string {
    if (!str) return '';
    return str
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/ß/g, 'ss')
      .replace(/-/g, ' ')
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const ALIAS_TO_CLEAN_NAME: Record<string, string> = {
    'bruno miguel borges fernandes': 'bruno fernandes',
    'bruno borges fernandes': 'bruno fernandes',
    'alejandro garnacho ferreyra': 'alejandro garnacho',
    'alisson becker': 'alisson',
    'andrey nascimento dos santos': 'andrey santos',
    'benoit badiashile mukinayi': 'benoit badiashile',
    'bruno guimaraes rodriguez moura': 'bruno guimaraes',
    'diogo dalot teixeira': 'diogo dalot',
    'dominic solanke mitchell': 'dominic solanke',
    'emiliano buendia stati': 'emiliano buendia',
    'emiliano martinez romero': 'emiliano martinez',
    'estevao almeida de oliveira goncalves': 'estevao',
    'francisco evanilson de lima barbosa': 'evanilson',
    'ezri konsa ngoyo': 'ezri konsa',
    'fabio freitas gouveia carvalho': 'fabio carvalho',
    'gabriel dos santos magalhaes': 'gabriel magalhaes',
    'jefferson lerma solis': 'jefferson lerma',
    'joao pedro junqueira de jesus': 'joao pedro',
    'julio soler barreto': 'julio soler',
    'levi samuels colwill': 'levi colwill',
    'manuel ugarte ribeiro': 'manuel ugarte',
    'marcos senesi baron': 'marcos senesi',
    'martin zubimendi ibanez': 'martin zubimendi',
    'matheus santos carneiro da cunha': 'matheus cunha',
    'mikel merino zazon': 'mikel merino',
    'moises caicedo corozo': 'moises caicedo',
    'nico gonzalez iglesias': 'nico gonzalez',
    'pedro lomba neto': 'pedro neto',
    'richarlison de andrade': 'richarlison',
    'robert lynch sanchez': 'robert sanchez',
    'rodrigo muniz carvalho': 'rodrigo muniz',
    'ruben dos santos gato alves dias': 'ruben dias',
    'daniel munoz mejia': 'daniel munoz'
  };

  existingPlayers.forEach((p) => {
    if (p.fpl_id != null) existingByFplId.set(p.fpl_id, p);
    if (p.name) existingByNormName.set(normalizeName(p.name), p);
    if (p.web_name && p.pl_team) {
      existingByWebAndTeam.set(`${normalizeName(p.web_name)}_${normalizeName(p.pl_team)}`, p);
    }
  });

  const matchedDbIds = new Set<string>();

  // Particles carry no identifying signal — "de"/"van"/"dos" matching across two
  // unrelated names is not evidence they're the same person.
  const NAME_PARTICLES = new Set([
    'de', 'da', 'do', 'dos', 'das', 'van', 'von', 'del', 'della', 'di', 'la', 'le',
    'el', 'al', 'bin', 'ibn', 'den', 'der', 'ter', 'dos', 'santos', 'silva', 'junior',
  ]);

  function significantTokens(str: string): Set<string> {
    return new Set(
      normalizeName(str)
        .split(' ')
        .filter((t) => t.length >= 3 && !NAME_PARTICLES.has(t)),
    );
  }

  /**
   * Does a stored row plausibly describe the same human as this FPL element?
   *
   * Name-based matching (passes 2 and 3) is fuzzy, and a wrong match is far
   * worse than no match: the stored row keeps its old `name` while inheriting
   * the new player's club and web_name, producing rows like
   * `name: "Ibrahima Konaté", web_name: "Endo", pl_team: "Liverpool"` — and
   * the old player's market value rides along, so relegation compensation
   * later pays out the wrong figure under the wrong name.
   *
   * Requiring one shared significant name token is a cheap, conservative
   * guard: legitimate simplifications ("Bruno Fernandes" vs "Bruno Miguel
   * Borges Fernandes", "Alisson" vs "Alisson Ramses Becker") always share one;
   * two unrelated players essentially never do.
   */
  function isSameIdentity(existing: DbPlayer, fplFullName: string): boolean {
    const a = significantTokens(existing.name ?? '');
    const b = significantTokens(fplFullName);
    for (const tok of a) if (b.has(tok)) return true;
    return false;
  }

  // Re-map rows, preserving manually-set overrides matched by player identity
  const finalRows = rows.map((row) => {
    const rawFplNorm = normalizeName(row.name);
    const aliasNorm = ALIAS_TO_CLEAN_NAME[rawFplNorm] || rawFplNorm;
    const webTeamKey = `${normalizeName(row.web_name)}_${normalizeName(row.pl_team)}`;

    // Pass 1: fpl_id match — authoritative. FPL owns this id, so trust it even
    // if the name looks unfamiliar (they do rename players mid-season).
    let existing = existingByFplId.get(row.fpl_id);

    if (!existing) {
      // Pass 2: canonical / normalized name match (including alias mapping)
      const byName = existingByNormName.get(aliasNorm) || existingByNormName.get(rawFplNorm);
      if (byName && !matchedDbIds.has(byName.id) && isSameIdentity(byName, row.name)) {
        existing = byName;
      }
    }

    if (!existing) {
      // Pass 3: web_name + team match
      const candidate = existingByWebAndTeam.get(webTeamKey);
      if (candidate && !matchedDbIds.has(candidate.id) && isSameIdentity(candidate, row.name)) {
        existing = candidate;
      }
    }

    if (existing) {
      matchedDbIds.add(existing.id);
    }

    // Curated FPL_POSITION_OVERRIDES always win (e.g. Zubimendi → DM). Otherwise
    // keep a manually-set granular primary so sync doesn't flatten everyone back
    // to FPL's GK/DEF/MID/FWD defaults every night. row.primary_position already
    // went through resolvePosition(), so it carries the override when one exists.
    const hasOverride =
      Object.prototype.hasOwnProperty.call(FPL_POSITION_OVERRIDES, row.name.toLowerCase()) ||
      Object.prototype.hasOwnProperty.call(FPL_POSITION_OVERRIDES, row.web_name.toLowerCase());
    const primaryPosition = hasOverride
      ? row.primary_position
      : (existing?.primary_position ?? row.primary_position);

    // Keep a manually-simplified name only when it still describes this player.
    // A row matched by fpl_id whose name no longer resembles the FPL name means
    // FPL reassigned the id — take their name rather than mislabel the row.
    const keepExistingName = !!existing?.name && isSameIdentity(existing, row.name);

    return {
      ...(existing ? { id: existing.id } : {}),
      ...row,
      name: keepExistingName ? (existing as DbPlayer).name : row.name,
      primary_position: primaryPosition,
      secondary_positions: (existing?.secondary_positions ?? []).filter((p: string) => p !== primaryPosition),
      market_value:
        existing?.market_value != null && existing.market_value !== 0
          ? existing.market_value
          : row.market_value,
    };
  });

  const updateRows = finalRows.filter((r) => 'id' in r && r.id != null);
  const insertRows = finalRows.filter((r) => !('id' in r) || r.id == null);

  for (let i = 0; i < updateRows.length; i += 100) {
    const chunk = updateRows.slice(i, i + 100);
    const { error: updateErr } = await admin
      .from('players')
      .upsert(chunk, { onConflict: 'id', ignoreDuplicates: false });

    if (updateErr) {
      return { synced: 0, systemBidsSeeded: 0, autoTransferOuts: [], error: updateErr.message };
    }
  }

  for (let i = 0; i < insertRows.length; i += 100) {
    const chunk = insertRows.slice(i, i + 100);
    const { error: insertErr } = await admin
      .from('players')
      .insert(chunk);

    if (insertErr) {
      return { synced: 0, systemBidsSeeded: 0, autoTransferOuts: [], error: insertErr.message };
    }
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

  // ── Deactivate players no longer present in FPL API (Relegations / Permanent Departures) ──
  //
  // Membership is decided by `matchedDbIds`, not by fpl_id. `existingPlayers` is
  // a pre-upsert snapshot holding LAST season's fpl_ids, while the incoming rows
  // carry this season's — and FPL reassigns element ids every season. Comparing
  // the two sets marked players as departed purely because their id had changed,
  // even though the sync had just matched and updated them a few lines earlier.
  const missingPlayers = (existingPlayers ?? []).filter(
    (p) => p.is_active && !matchedDbIds.has(p.id)
  );

  if (missingPlayers.length > 0) {
    const missingIds = missingPlayers.map((p) => p.id);
    const { error: deactivateError } = await admin
      .from('players')
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .in('id', missingIds);

    if (deactivateError) {
      console.error(`[syncPlayers] Failed to deactivate ${missingIds.length} missing players:`, deactivateError.message);
    } else {
      console.log(`[syncPlayers] Deactivated ${missingIds.length} players missing from FPL API: ${missingPlayers.map(p => p.name).join(', ')}`);
    }

    // A player who has left the PL must not stay on the auction block. A drop
    // opens a system auction for whoever was released; if that player then
    // departs the league before the window closes, the auction outlives them —
    // managers are left bidding on someone who can no longer score. Close the
    // system-seeded rows (team_id IS NULL); real bids are handled by the
    // auction resolver, which refunds when there's nothing to award.
    // 'rejected' rather than 'cancelled': waiver_claim_status is an enum of
    // ('pending','approved','rejected') and has no cancelled member.
    const { error: cancelErr } = await admin
      .from('waiver_claims')
      .update({ status: 'rejected' })
      .in('player_id', missingIds)
      .eq('is_auction', true)
      .eq('status', 'pending')
      .is('team_id', null);

    if (cancelErr) {
      console.error('[syncPlayers] Failed to cancel auctions for departed players:', cancelErr.message);
    }
  }

  return { synced: rows.length, systemBidsSeeded: 0, autoTransferOuts };
}
