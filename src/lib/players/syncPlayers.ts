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
import type { GranularPosition } from '@/types';
import { recordDepartures, midseasonDecideBy } from '@/lib/departures/detect';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';

const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

interface SyncPlayersResult {
  synced: number;
  systemBidsSeeded: number;
  autoTransferOuts: { playerId: string; result: string }[];
  /** Departure decisions opened for managers, per league. */
  departuresRecorded?: { leagueId: string; count: number }[];
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
        fplCode: photoCode,
        name: `${el.first_name} ${el.second_name}`,
        web_name: el.web_name,
        pl_team: teamMap.get(el.team) ?? 'Unknown',
        pl_team_id: el.team,
        primary_position: position,
        secondary_positions: [] as string[],
        // FPL's now_cost is a salary-cap price on a totally different scale
        // from Transfermarkt's real valuations (which Gaffa's economy runs
        // on) — never usable as a market_value stand-in. Leave unpriced
        // players null until sync_transfermarkt.ts supplies a real figure.
        market_value: null as number | null,
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
    full_name: string | null;
    pl_team: string | null;
    date_of_birth: string | null;
    photo_url: string | null;
  }

  // Snapshot existing players to preserve manual overrides and detect transfer-outs
  const { data: rawPlayers } = await admin
    .from('players')
    .select('id, fpl_id, is_active, primary_position, secondary_positions, market_value, name, web_name, full_name, pl_team, date_of_birth, photo_url');

  const existingPlayers: DbPlayer[] = (rawPlayers as DbPlayer[]) ?? [];

  const activeByFplId = new Map<number, string>(
    existingPlayers
      .filter((p) => p.is_active && p.fpl_id != null)
      .map((p) => [p.fpl_id as number, p.id]),
  );

  const existingByFplId = new Map<number, DbPlayer>();
  const existingByNormName = new Map<string, DbPlayer>();
  const existingByWebAndTeam = new Map<string, DbPlayer>();

  // Position cache from the periodic top-5-league SoFIFA crawl (migration 099)
  // -- covers players who aren't in `players` yet (most new PL arrivals transfer
  // from one of these leagues). Looked up below for brand-new inserts only;
  // existing rows keep whatever position they already have.
  const { data: sofifaReferenceRows } = await admin
    .from('sofifa_position_reference')
    .select('name_aliases, primary_position, secondary_positions');

  interface SofifaReferenceMatch {
    primary_position: string;
    secondary_positions: string[];
  }

  const sofifaReferenceByAlias = new Map<string, SofifaReferenceMatch>();
  for (const ref of sofifaReferenceRows ?? []) {
    const match: SofifaReferenceMatch = {
      primary_position: ref.primary_position,
      secondary_positions: ref.secondary_positions ?? [],
    };
    for (const alias of ref.name_aliases ?? []) {
      if (!sofifaReferenceByAlias.has(alias)) sofifaReferenceByAlias.set(alias, match);
    }
  }

  function firstLastWord(name: string): string {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length <= 2) return name;
    return `${parts[0]} ${parts[parts.length - 1]}`;
  }

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

  /**
   * FPL's stable per-player code, which we store inside photo_url
   * (.../110x140/{code}.png) because it is the filename FPL itself uses.
   *
   * This — not fpl_id — is the identity key. Element ids are handed out fresh
   * every season exactly like team ids and fixture ids, so matching on one
   * across a rollover hands an existing row to whoever inherited the number,
   * along with all of that row's history. It did: 19 rows changed person at the
   * 2026-27 rollover, and our "Dominic Solanke" carried Igor Jesus's first
   * twenty-one gameweeks.
   */
  function fplCodeOf(photoUrl: string | null | undefined): string | null {
    return /\/(\d+)\.(?:png|jpg)$/i.exec(photoUrl ?? '')?.[1] ?? null;
  }

  const existingByFplCode = new Map<string, DbPlayer>();

  existingPlayers.forEach((p) => {
    const code = fplCodeOf(p.photo_url);
    if (code) existingByFplCode.set(code, p);
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

    // Pass 1: stable code — the only identifier FPL never reassigns, so a row
    // matched here is the same human it was last season.
    //
    // The name still has to agree, because some stored codes are themselves
    // wrong: the old fpl_id-keyed sync rewrote photo_url from whichever element
    // it mismatched a row to, leaving our Konaté row carrying Endo Wataru's
    // code. Insisting on agreement makes those rows fall through to the name
    // passes, which reunites them with their real element and overwrites the
    // bad photo — so each one self-heals on the next sync.
    let existing = row.fplCode ? existingByFplCode.get(row.fplCode) : undefined;
    if (existing && !isSameIdentity(existing, row.name)) existing = undefined;

    if (!existing) {
      // Pass 1b: fpl_id, but only when it still describes the same person.
      // Within a season the id is a fine shortcut for a row we have no code
      // for; across one it is a trap, so the name has to agree.
      const byFplId = existingByFplId.get(row.fpl_id);
      if (byFplId && !fplCodeOf(byFplId.photo_url) && isSameIdentity(byFplId, row.name)) {
        existing = byFplId;
      }
    }

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
    } else {
      // Brand-new player: try the SoFIFA top-5-league reference cache before
      // falling back to resolvePosition()'s crude element_type default. An
      // existing row's position is never touched here — only ever a fresh
      // insert's initial value, which the override/merge logic below still
      // gets the final say over (e.g. FPL_POSITION_OVERRIDES).
      const sofifaMatch =
        sofifaReferenceByAlias.get(aliasNorm) ??
        sofifaReferenceByAlias.get(rawFplNorm) ??
        sofifaReferenceByAlias.get(firstLastWord(aliasNorm)) ??
        sofifaReferenceByAlias.get(firstLastWord(rawFplNorm));
      if (sofifaMatch) {
        row.primary_position = sofifaMatch.primary_position as GranularPosition;
        row.secondary_positions = sofifaMatch.secondary_positions as GranularPosition[];
      }
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
    const finalName = keepExistingName ? (existing as DbPlayer).name : row.name;

    // full_name is a legacy display column the sync doesn't otherwise write —
    // it holds a richer registered name for ~30 players (David Raya → "David
    // Raya Martín") and formatName() prefers it over `name`. A bad match in an
    // earlier sync left four rows with another player's full_name bleeding
    // through (Mbeumo showing "João Pedro Loureiro da Costa"). Self-heal: if the
    // stored full_name shares no significant token with the row's real name,
    // clear it so display falls back to the correct `name`. Only clears clearly
    // wrong values — coherent ones are left untouched, and we never fabricate.
    const clearBadFullName =
      !!existing?.full_name && !isSameIdentity({ name: existing.full_name } as DbPlayer, finalName);

    // fplCode is a matching key derived from el.photo, not a column.
    const { fplCode: _fplCode, ...dbRow } = row;

    return {
      ...(existing ? { id: existing.id } : {}),
      ...dbRow,
      name: finalName,
      ...(clearBadFullName ? { full_name: null } : {}),
      primary_position: primaryPosition,
      // row.secondary_positions is only ever non-empty here for a brand-new
      // player matched against the SoFIFA reference cache above -- existing
      // rows always take their own stored value, same as primary_position.
      secondary_positions: (existing?.secondary_positions ?? row.secondary_positions ?? [])
        .filter((p: string) => p !== primaryPosition),
      market_value:
        existing?.market_value != null && existing.market_value !== 0
          ? existing.market_value
          : row.market_value,
      // FPL's bootstrap API never actually sends birth_date (row.date_of_birth
      // is always null) — don't let this upsert clobber whatever a slower,
      // separate source (api-football sync) has already populated.
      date_of_birth: existing?.date_of_birth ?? row.date_of_birth,
    };
  });

  const updateRows = finalRows.filter((r) => 'id' in r && r.id != null);
  const insertRows = finalRows.filter((r) => !('id' in r) || r.id == null);

  // players.fpl_id is UNIQUE, and FPL permutes element ids every summer: the id
  // a row is about to receive is frequently still held by another row that has
  // not been written yet. Because these writes go out in chunks, each its own
  // transaction, that shows up as "duplicate key value violates unique
  // constraint players_fpl_id_key" and aborts the whole sync — no rows of the
  // permutation land at all.
  //
  // Releasing every contested id first makes the permutation representable. The
  // gap is momentary and invisible: matching for this run is already done, and
  // every id is reassigned by the writes immediately below.
  const desiredFplIds = new Set(finalRows.map((r) => r.fpl_id).filter((id): id is number => id != null));
  const toRelease = new Set<string>();
  for (const r of updateRows) toRelease.add(r.id as string);
  for (const p of existingPlayers) {
    if (p.fpl_id != null && desiredFplIds.has(p.fpl_id)) toRelease.add(p.id);
  }

  const releaseIds = [...toRelease];
  for (let i = 0; i < releaseIds.length; i += 100) {
    const { error: releaseErr } = await admin
      .from('players')
      .update({ fpl_id: null })
      .in('id', releaseIds.slice(i, i + 100));
    if (releaseErr) {
      return { synced: 0, systemBidsSeeded: 0, autoTransferOuts: [], error: `release: ${releaseErr.message} | ${releaseErr.details ?? ""}` };
    }
  }

  for (let i = 0; i < updateRows.length; i += 100) {
    const chunk = updateRows.slice(i, i + 100);
    const { error: updateErr } = await admin
      .from('players')
      .upsert(chunk, { onConflict: 'id', ignoreDuplicates: false });

    if (updateErr) {
      return { synced: 0, systemBidsSeeded: 0, autoTransferOuts: [], error: `update: ${updateErr.message} | ${updateErr.details ?? ""}` };
    }
  }

  for (let i = 0; i < insertRows.length; i += 100) {
    const chunk = insertRows.slice(i, i + 100);
    const { error: insertErr } = await admin
      .from('players')
      .insert(chunk);

    if (insertErr) {
      return { synced: 0, systemBidsSeeded: 0, autoTransferOuts: [], error: `insert: ${insertErr.message} | ${insertErr.details ?? ""}` };
    }
  }

  // --- Permanent PL departures ---
  //
  // These used to be paid out on the spot. They are now recorded as pending
  // decisions instead (below, once deactivation has run), so the owner chooses
  // between the compensation and retaining the player's rights. The upsert
  // above has already set is_active = false for anyone FPL marks 'u', which is
  // the signal `recordDepartures` keys off, so this block only reports.
  const permanentDepartures = (fplData.elements as FplElement[]).filter((el) => {
    if (el.status !== 'u') return false;
    if (!activeByFplId.has(el.id)) return false;
    const news = (el.news ?? '').toLowerCase();
    return (news.includes('transfer') || news.includes('joined')) && !news.includes('loan');
  });

  const autoTransferOuts: { playerId: string; result: string }[] = permanentDepartures.map((el) => ({
    playerId: activeByFplId.get(el.id)!,
    result: 'departed the Premier League — decision opened for the owning manager',
  }));

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

  // ── Open departure decisions for every league holding a departed player ──
  //
  // Runs after deactivation so both routes out of the league are covered: FPL
  // marking a player 'u', and FPL dropping him from the bootstrap entirely.
  // In-season departures carry a hard deadline because there is no admin action
  // to wait for; offseason leagues use Kickoff as their deadline instead, so
  // their decisions are opened without one.
  const departuresRecorded: { leagueId: string; count: number }[] = [];
  try {
    const { data: leagues } = await admin
      .from('leagues')
      .select('id, status, current_season, previous_season')
      .in('status', ['active', 'offseason']);

    // A league is only genuinely mid-season if its season matches the live FPL
    // one. A league still marked `active` on last season's string has not had
    // Season Reset run yet — the real world has rolled over and it hasn't
    // caught up. Its "departures" are the entire summer's worth of players who
    // left the division, and putting a 72h auto-release timer on those would
    // pay out the whole backlog before an admin ever saw it. Those wait for
    // Kickoff, like any other offseason departure.
    const liveSeason = await getCurrentFplSeason();

    for (const league of leagues ?? []) {
      try {
        const inSeason = league.status === 'active' && league.current_season === liveSeason;
        const recorded = await recordDepartures(admin, league.id, {
          seasonFrom: (inSeason ? league.current_season : league.previous_season) ?? league.current_season ?? '',
          decideBy: inSeason ? midseasonDecideBy() : null,
        });
        if (recorded.length > 0) {
          departuresRecorded.push({ leagueId: league.id, count: recorded.length });
        }
      } catch (err) {
        console.error(`[syncPlayers] Failed to record departures for league ${league.id}:`, err);
      }
    }
  } catch (err) {
    console.error('[syncPlayers] Failed to load leagues for departure recording:', err);
  }

  return { synced: rows.length, systemBidsSeeded: 0, autoTransferOuts, departuresRecorded };
}
