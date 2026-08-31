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
  /** Set-piece hierarchy — 1 is first choice. Null when the player has no listed duty. */
  penalties_order?: number | null;
  direct_freekicks_order?: number | null;
  corners_and_indirect_freekicks_order?: number | null;
  /** Percentage chance of featuring next round. Null when FPL reports no doubt. */
  chance_of_playing_next_round?: number | null;
  starts?: number;
  minutes?: number;
  /** FPL sends the expected-goals block and ownership as strings, not numbers. */
  expected_goals?: string;
  expected_assists?: string;
  selected_by_percent?: string;
}

/** FPL sends its expected-goals block and ownership as strings; empty means absent. */
function numOrNull(value: string | undefined): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
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
        element_type: el.element_type,
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
        // Set-piece duty, availability probability and season volume, straight
        // from the bootstrap. These used to be dropped on the floor and then
        // re-derived by Google Search inside the outlook engine, which is both
        // slower and less reliable than FPL's own answer. Nulls are meaningful:
        // no listed set-piece duty, or no reported doubt.
        fpl_penalties_order: el.penalties_order ?? null,
        fpl_direct_fk_order: el.direct_freekicks_order ?? null,
        fpl_corners_order: el.corners_and_indirect_freekicks_order ?? null,
        fpl_chance_next_round: el.chance_of_playing_next_round ?? null,
        fpl_starts: el.starts ?? null,
        fpl_minutes: el.minutes ?? null,
        fpl_xg: numOrNull(el.expected_goals),
        fpl_xa: numOrNull(el.expected_assists),
        fpl_selected_by_pct: numOrNull(el.selected_by_percent),
        updated_at: new Date().toISOString(),
      };
    });

  interface DbPlayer {
    id: string;
    fpl_id: number | null;
    is_active: boolean;
    primary_position: GranularPosition;
    secondary_positions: GranularPosition[];
    market_value: number | null;
    name: string;
    web_name: string | null;
    full_name: string | null;
    pl_team: string | null;
    date_of_birth: string | null;
    photo_url: string | null;
    pl_team_changed_at: string | null;
  }

  // Snapshot existing players to preserve manual overrides and detect transfer-outs
  const { data: rawPlayers } = await admin
    .from('players')
    .select('id, fpl_id, is_active, primary_position, secondary_positions, market_value, name, web_name, full_name, pl_team, date_of_birth, photo_url, pl_team_changed_at');

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
  //
  // Paginated: PostgREST caps a single select at 1000 rows by default, and this
  // table holds 3000+. An unpaginated fetch silently returned only the first
  // 1000, so most new arrivals fell back to resolvePosition()'s coarse
  // GK/CB/CM/ST default instead of a real cached position.
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
      .replace(/[\.\-_]/g, ' ')
      .replace(/[^a-z0-9 ]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function normalizeTeam(t: string | null | undefined): string {
    const n = normalizeName(t);
    if (!n) return '';
    if (n.includes('manchester city') || n === 'man city') return 'man city';
    if (n.includes('manchester united') || n === 'man utd') return 'man utd';
    if (n.includes('tottenham') || n === 'spurs') return 'spurs';
    if (n.includes('newcastle')) return 'newcastle';
    if (n.includes('wolverhampton') || n === 'wolves') return 'wolves';
    if (n.includes('nottingham') || n === 'nottm forest') return 'nottm forest';
    if (n.includes('brighton')) return 'brighton';
    if (n.includes('west ham')) return 'west ham';
    if (n.includes('bournemouth')) return 'bournemouth';
    if (n.includes('aston villa')) return 'aston villa';
    if (n.includes('leicester')) return 'leicester';
    if (n.includes('ipswich')) return 'ipswich';
    if (n.includes('chelsea')) return 'chelsea';
    if (n.includes('arsenal')) return 'arsenal';
    if (n.includes('liverpool')) return 'liverpool';
    if (n.includes('everton')) return 'everton';
    if (n.includes('fulham')) return 'fulham';
    if (n.includes('brentford')) return 'brentford';
    if (n.includes('crystal palace')) return 'crystal palace';
    if (n.includes('southampton')) return 'southampton';
    return n;
  }

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

  const POS_CATEGORY: Record<string, number> = {
    GK: 1,
    CB: 2, LB: 2, RB: 2, LWB: 2, RWB: 2,
    DM: 3, CM: 3, AM: 3, LM: 3, RM: 3, LW: 3, RW: 3,
    ST: 4, CF: 4,
  };

  // Position cache from the periodic top-5-league SoFIFA crawl (migration 099)
  // -- covers players who aren't in `players` yet (most new PL arrivals transfer
  // from one of these leagues). Looked up below for brand-new inserts only;
  // existing rows keep whatever position they already have.
  //
  // Paginated: PostgREST caps a single select at 1000 rows by default, and this
  // table holds 3000+. An unpaginated fetch silently returned only the first
  // 1000, so most new arrivals fell back to resolvePosition()'s coarse
  // GK/CB/CM/ST default instead of a real cached position.
  interface SofifaReferenceRow {
    sofifa_id: number;
    full_name: string;
    common_name: string | null;
    name_aliases: string[];
    club_name: string | null;
    sofifa_league_id: number;
    primary_position: string;
    secondary_positions: string[];
  }

  const sofifaReferenceRows: SofifaReferenceRow[] = [];
  {
    const PAGE_SIZE = 1000;
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data: page, error: pageErr } = await admin
        .from('sofifa_position_reference')
        .select('sofifa_id, full_name, common_name, name_aliases, club_name, sofifa_league_id, primary_position, secondary_positions')
        .range(from, from + PAGE_SIZE - 1);
      if (pageErr) break;
      sofifaReferenceRows.push(...(page ?? []));
      if (!page || page.length < PAGE_SIZE) break;
    }
  }

  const aliasIndex = new Map<string, SofifaReferenceRow[]>();
  for (const ref of sofifaReferenceRows ?? []) {
    const aliases = new Set<string>([
      ...(ref.name_aliases ?? []),
      normalizeName(ref.full_name),
      normalizeName(ref.common_name),
      firstLastWord(normalizeName(ref.full_name)),
      firstLastWord(normalizeName(ref.common_name)),
    ]);
    for (const a of aliases) {
      if (!a) continue;
      if (!aliasIndex.has(a)) aliasIndex.set(a, []);
      aliasIndex.get(a)!.push(ref);
    }
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
    'daniel munoz mejia': 'daniel munoz',
  };

  function scoreSofifaMatch(
    player: { name: string; raw_name?: string; web_name?: string; pl_team?: string; element_type?: number },
    ref: SofifaReferenceRow,
  ): number {
    const pNorm = normalizeName(player.name);
    const pRaw = normalizeName(player.raw_name || player.name);
    const pTokens = significantTokens(`${player.name} ${player.raw_name || ''}`);
    const refFullNorm = normalizeName(ref.full_name);
    const refCommonNorm = normalizeName(ref.common_name);
    const refTokens = significantTokens(`${ref.full_name} ${ref.common_name || ''}`);

    let sharedTokens = 0;
    for (const t of pTokens) {
      if (refTokens.has(t)) sharedTokens++;
    }

    const isExactName =
      refFullNorm === pRaw ||
      refFullNorm === pNorm ||
      (refCommonNorm && (refCommonNorm === pNorm || refCommonNorm === pRaw));
    if (sharedTokens === 0 && !isExactName) {
      return 0;
    }

    let posScore = 0;
    if (player.element_type) {
      const refPosCat = POS_CATEGORY[ref.primary_position] || 3;
      if (player.element_type === 1) {
        if (ref.primary_position === 'GK') posScore += 50;
        else return 0;
      } else if (ref.primary_position === 'GK') {
        return 0;
      } else if (player.element_type === 2 && (refPosCat === 4 || refPosCat === 3)) {
        posScore -= 120;
      } else if (player.element_type === 4 && (refPosCat === 2 || refPosCat === 1)) {
        posScore -= 120;
      } else if (player.element_type === refPosCat) {
        posScore += 30;
      } else if (
        (player.element_type === 3 && (ref.primary_position === 'LW' || ref.primary_position === 'RW')) ||
        (player.element_type === 4 && (ref.primary_position === 'LW' || ref.primary_position === 'RW'))
      ) {
        posScore += 20;
      }
    }

    let score = posScore;

    const pTeam = normalizeTeam(player.pl_team);
    const refTeam = normalizeTeam(ref.club_name);
    if (pTeam && refTeam && pTeam === refTeam) {
      score += 100;
    } else if (ref.sofifa_league_id === 13) {
      score += 25;
    }

    score += sharedTokens * 30;

    if (refFullNorm === pRaw || refFullNorm === pNorm) {
      score += 80;
    }
    if (refCommonNorm && (refCommonNorm === pNorm || refCommonNorm === normalizeName(player.web_name))) {
      score += 40;
    }

    return score;
  }

  function findBestSofifaMatch(player: {
    name: string;
    raw_name?: string;
    web_name?: string;
    pl_team?: string;
    element_type?: number;
  }): SofifaReferenceRow | null {
    const pNorm = normalizeName(player.name);
    const pRaw = normalizeName(player.raw_name || player.name);
    const pWeb = normalizeName(player.web_name);
    const aliasClean = ALIAS_TO_CLEAN_NAME[pRaw] || ALIAS_TO_CLEAN_NAME[pNorm];
    const pTokensList = Array.from(significantTokens(pRaw));

    const candidateKeys = [
      pRaw,
      pNorm,
      aliasClean,
      firstLastWord(pRaw),
      firstLastWord(pNorm),
      pWeb,
      pTokensList.length >= 2 ? `${pTokensList[0]} ${pTokensList[1]}` : null,
      pTokensList.length >= 2 ? `${pTokensList[0]} ${pTokensList[pTokensList.length - 1]}` : null,
    ].filter(Boolean) as string[];

    const seenIds = new Set<number>();
    const candidatePool: SofifaReferenceRow[] = [];
    for (const k of candidateKeys) {
      for (const ref of aliasIndex.get(k) || []) {
        if (!seenIds.has(ref.sofifa_id)) {
          seenIds.add(ref.sofifa_id);
          candidatePool.push(ref);
        }
      }
    }

    if (candidatePool.length === 0) return null;

    const scored = candidatePool
      .map((ref) => ({ ref, score: scoreSofifaMatch(player, ref) }))
      .filter((s) => s.score >= 50)
      .sort((a, b) => b.score - a.score);

    return scored[0]?.ref ?? null;
  }

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
  const existingByTeam = new Map<string, DbPlayer[]>();

  existingPlayers.forEach((p) => {
    const code = fplCodeOf(p.photo_url);
    if (code) existingByFplCode.set(code, p);
    if (p.fpl_id != null) existingByFplId.set(p.fpl_id, p);
    if (p.name) existingByNormName.set(normalizeName(p.name), p);
    if (p.web_name && p.pl_team) {
      existingByWebAndTeam.set(`${normalizeName(p.web_name)}_${normalizeName(p.pl_team)}`, p);
    }
    if (p.pl_team) {
      const teamKey = normalizeName(p.pl_team);
      if (!existingByTeam.has(teamKey)) existingByTeam.set(teamKey, []);
      existingByTeam.get(teamKey)!.push(p);
    }
  });

  const matchedDbIds = new Set<string>();

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

    if (!existing) {
      // Pass 4: same-team identity scan. Passes 2/3 require an EXACT
      // normalized name or web_name string match — a single Map.get(). That
      // breaks the moment FPL's reported name/web_name drifts from what's
      // already stored (e.g. FPL starts reporting "Thiago" for a player
      // whose row has name/web_name "Igor Thiago"): neither exact key
      // exists, fpl_id was never backfilled on the old row either, and sync
      // falls through to inserting a brand-new empty duplicate row instead
      // of updating the real one. Before giving up, scan every
      // still-unmatched existing row on the same team for a shared
      // significant name token — the same conservative guard already used
      // above, just applied as a scan instead of a single lookup.
      const teamKey = normalizeName(row.pl_team);
      const candidates = existingByTeam.get(teamKey) ?? [];
      const candidate = candidates.find((c) => !matchedDbIds.has(c.id) && isSameIdentity(c, row.name));
      if (candidate) existing = candidate;
    }

    const sofifaMatch = findBestSofifaMatch({
      name: row.name,
      raw_name: row.name,
      web_name: row.web_name,
      pl_team: row.pl_team,
      element_type: row.element_type,
    });

    if (existing) {
      matchedDbIds.add(existing.id);
    } else {
      // Brand-new player: try the SoFIFA top-5-league reference cache before
      // falling back to resolvePosition()'s crude element_type default. An
      // existing row's position is never touched here — only ever a fresh
      // insert's initial value, which the override/merge logic below still
      // gets the final say over (e.g. FPL_POSITION_OVERRIDES).
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
    const { fplCode: _fplCode, element_type: _element_type, ...dbRow } = row;

    const finalRow: typeof dbRow & { id?: string; full_name?: string | null; pl_team_changed_at: string | null } = {
      ...dbRow,
      name: finalName,
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
      // Evidence for the high-value auction sweep (seedHighValueAuctions) that
      // a player actually just transferred, rather than merely being unowned
      // and expensive. A brand-new row (no `existing`) counts as an arrival in
      // its own right; an existing row only counts when its club actually
      // changed since the last sync — otherwise it keeps whatever value (or
      // null) it already had, so a player who's sat at the same club all along
      // never reads as "just arrived".
      pl_team_changed_at: !existing
        ? new Date().toISOString()
        : existing.pl_team !== row.pl_team
          ? new Date().toISOString()
          : existing.pl_team_changed_at,
    };
    if (existing) finalRow.id = existing.id;
    if (clearBadFullName) finalRow.full_name = null;
    return finalRow;
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
