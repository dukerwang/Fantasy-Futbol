/**
 * The one place player display names are formatted.
 *
 * Previously two independent formatters existed — `formatName.ts`'s
 * mononym-aware `formatPlayerName()` and this file's character-budget-driven
 * `playerName()` — plus several call sites that read `web_name`/`name`
 * directly. They disagreed on mononyms, on whether truncation happened, and
 * on what "compact" meant, which is why the same player could read as a
 * mononym on one screen and his full legal name on another, or why a list of
 * names could mix "First Last" and "F. Last" with no visible rule (whichever
 * row's raw name happened to be short enough printed in full). This module
 * replaces both.
 *
 * `name`/`full_name` are re-derived from FPL on every sync
 * (`src/lib/players/syncPlayers.ts`) and are not a safe place to store a
 * simplified/mononym form — a stored simplification that shares no name
 * token with FPL's registered name gets overwritten back on the next sync.
 * Mononym resolution is therefore done here, at render time, against a fixed
 * list, so it survives every sync regardless of what the DB row currently
 * says. The same goes for preferring FPL's `web_name` as the known surname
 * when the legal name carries an extra maternal surname — sync will keep
 * rewriting `name` to the full FPL string, so the trim belongs at render time.
 */

interface NameLike {
  name?: string | null;
  web_name?: string | null;
  sofifa_common_name?: string | null;
  full_name?: string | null;
}

/** Case- and diacritic-insensitive: "Sávio" and "Savio" hit the same entry. */
function normalize(str: string): string {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

/**
 * Full DB names or web names known to be better known by a mononym.
 *
 * Hand-curated by design — mononyms are a small, slow-changing set in
 * football. Add an entry here (not by editing a player's stored `name`)
 * whenever a player should render as a single name.
 */
const MONONYM_MAP: Record<string, string> = {
  "rodrigo 'rodri' hernandez cascante": 'Rodri',
  'rodrigo hernandez cascante': 'Rodri',
  rodri: 'Rodri',
  'carlos henrique casimiro': 'Casemiro',
  casemiro: 'Casemiro',
  'alisson ramses becker': 'Alisson',
  alisson: 'Alisson',
  'ederson santana de moraes': 'Ederson',
  ederson: 'Ederson',
  'savio moreira de oliveira': 'Savinho',
  'savio moreira': 'Savinho',
  savio: 'Savinho',
  savinho: 'Savinho',
  'gabriel magalhaes': 'Gabriel',
  gabriel: 'Gabriel',
  'antony matheus dos santos': 'Antony',
  antony: 'Antony',
  'richarlison de andrade': 'Richarlison',
  richarlison: 'Richarlison',
  'norberto murara neto': 'Neto',
  'norberto bercique gomes betuncal': 'Beto',
  'norberto gomes betuncal': 'Beto',
  beto: 'Beto',
  'francisco evanilson de lima barbosa': 'Evanilson',
  evanilson: 'Evanilson',
  'estevao almeida de oliveira goncalves': 'Estêvão',
  estevao: 'Estêvão',
  kepa: 'Kepa',
  'kepa arrizabalaga revuelta': 'Kepa',
  'kepa arrizabalaga': 'Kepa',
  'diogo jota': 'Jota',
  'luiz diaz': 'Díaz',
};

const PREFIXES = new Set(['van', 'de', 'di', 'da', 'del', 'le', 'dos', 'el']);

function resolveMononym(dbName: string, webName: string): string | null {
  const dbNorm = normalize(dbName);
  const webNorm = normalize(webName);
  for (const [key, mononym] of Object.entries(MONONYM_MAP)) {
    if (dbNorm === key || webNorm === key || dbNorm === normalize(mononym)) {
      return mononym;
    }
  }

  // Fallback: If web_name is a single word with no dots/spaces (e.g. "Beto"),
  // and is NOT a token in the legal name, it's an FPL mononym / nickname.
  if (webName && !webName.includes('.') && !/\s/.test(webName)) {
    const parts = dbName.split(/\s+/).filter(Boolean);
    const matchesAnyToken = parts.some((p) => normalize(p) === webNorm);
    if (!matchesAnyToken) {
      return webName;
    }
  }

  return null;
}

/**
 * Prefer FPL's `web_name` as the known surname when it appears as a token in
 * the legal name. Spanish/Portuguese double surnames otherwise collapse to the
 * maternal last token ("Martín Zubimendi Ibáñez" → "Ibáñez").
 *
 * Only applied for a single-token web_name with no embedded period — forms
 * like "B.Fernandes" are already compact and are left alone.
 */
function preferWebSurname(
  dbName: string,
  webName: string,
): { first: string; last: string } | null {
  if (!webName || webName.includes('.') || /\s/.test(webName)) return null;

  const parts = dbName.split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;

  const webNorm = normalize(webName);
  const idx = parts.findIndex((p) => normalize(p) === webNorm);
  // Must sit after at least one given name, and not already be the final token
  // (nothing to drop in that case — the naive split is already correct).
  if (idx < 1) return null;
  return { first: parts.slice(0, idx).join(' '), last: parts[idx] };
}

function initialLast(dbName: string, webName = ''): string {
  // Already "B. Fernandes"-shaped — pass through.
  if (/^[A-Z]\.\s+[A-Z]/i.test(dbName)) return dbName;

  const preferred = preferWebSurname(dbName, webName);
  if (preferred) {
    const firstInitial = preferred.first.split(/\s+/)[0]?.[0]?.toUpperCase() || '';
    return firstInitial ? `${firstInitial}. ${preferred.last}` : preferred.last;
  }

  const parts = dbName.split(/\s+/);
  if (parts.length === 1) return dbName;

  const firstInitial = parts[0][0].toUpperCase();
  // Drop any part that's already an initial ("B.") so we don't get "B. B. Fernandes".
  const lastName = parts.slice(1).filter((p) => !/^[A-Z]\.$/i.test(p)).join(' ');
  return `${firstInitial}. ${lastName}`;
}

function splitName(dbName: string, webName = ''): { first: string; last: string } {
  const preferred = preferWebSurname(dbName, webName);
  if (preferred) return preferred;

  const parts = dbName.split(/\s+/);
  if (parts.length === 1) return { first: '', last: dbName };

  let last = parts.pop()!;
  if (parts.length > 0 && PREFIXES.has(parts[parts.length - 1].toLowerCase())) {
    last = `${parts.pop()!} ${last}`;
  }
  return { first: parts.join(' '), last };
}

function formatSofifaCommon(
  sofifaCommon: string,
  dbName: string,
  format: 'full' | 'initial_last' | 'split',
): string | { first: string; last: string } {
  // If SoFIFA common name has an initial (e.g. "W. Saliba" or "J. Timber")
  if (sofifaCommon.includes('.')) {
    if (format === 'full') {
      // Return full legal/DB name (e.g. "William Saliba", "Jurriën Timber")
      return dbName;
    }
    // For compact/split formats, use the initial + surname form (e.g. "W. Saliba")
    const parts = sofifaCommon.split(/\s+/).filter(Boolean);
    const last = parts.slice(1).join(' ');
    const first = parts[0];
    if (format === 'split') return { first, last };
    return sofifaCommon;
  }

  const parts = sofifaCommon.split(/\s+/).filter(Boolean);
  if (parts.length === 1) {
    return format === 'split' ? { first: '', last: parts[0] } : parts[0];
  }
  const first = parts.slice(0, -1).join(' ');
  const last = parts[parts.length - 1];
  if (format === 'split') return { first, last };
  if (format === 'full') return sofifaCommon;
  const initial = first[0]?.toUpperCase() || '';
  return initial ? `${initial}. ${last}` : last;
}

/**
 * The name to render.
 *
 * `'full'` — first + last, mononym-resolved. Headers, modals, sort keys,
 * narrative text.
 * `'initial_last'` (default) — "F. Last", mononym-resolved. Compact rows:
 * roster/auction/listing tables, draft picks, trade block.
 * `'split'` — `{ first, last }` for layouts that style the two separately
 * (e.g. a small first name over a bold surname).
 */
export function getPlayerDisplayName(player?: NameLike | null, format?: 'full' | 'initial_last'): string;
export function getPlayerDisplayName(
  player: NameLike | null | undefined,
  format: 'split',
): { first: string; last: string };
export function getPlayerDisplayName(
  player?: NameLike | null,
  format: 'full' | 'initial_last' | 'split' = 'initial_last',
): string | { first: string; last: string } {
  if (!player) return format === 'split' ? { first: '', last: '—' } : '—';

  const dbName = (player.name || player.full_name)?.trim() || player.web_name?.trim() || '';
  if (!dbName && !player.sofifa_common_name) return format === 'split' ? { first: '', last: '—' } : '—';

  const webName = player.web_name?.trim() || '';
  const mononym = resolveMononym(dbName, webName);
  if (mononym) return format === 'split' ? { first: '', last: mononym } : mononym;

  const sofifaCommon = player.sofifa_common_name?.trim();
  if (sofifaCommon) {
    return formatSofifaCommon(sofifaCommon, dbName, format);
  }

  if (format === 'split') return splitName(dbName, webName);
  if (format === 'full') {
    // Prefer first + known surname over legal double surnames so headers read
    // "Martín Zubimendi" rather than "Martín Zubimendi Ibáñez".
    const preferred = preferWebSurname(dbName, webName);
    if (preferred?.first) return `${preferred.first} ${preferred.last}`;
    return player.full_name || player.name || webName;
  }
  return initialLast(dbName, webName);
}

/** A single glyph for an avatar fallback, resolved through the same mononym list. */
export function playerInitial(player?: NameLike | null): string {
  const name = getPlayerDisplayName(player, 'full');
  return name && name !== '—' ? name.charAt(0).toUpperCase() : '?';
}
