/**
 * Gaffa — "Is this player actually still in the Premier League?"
 *
 * `players.is_active = false` is supposed to mean a player left the league. It
 * does not reliably mean that. `syncPlayersFromFpl` deactivates any stored row
 * it fails to match against the FPL bootstrap, and that matching is fuzzy — so
 * a spelling change, a renamed row, or a duplicate row for the same human all
 * produce a player who is marked departed while still very much playing.
 *
 * This is not theoretical. The known cases are Murillo, Joelinton, Konaté and
 * Gordon: a stale row and a live row for the same person, with the roster
 * pointing at the stale one. Anything that pays out or drops on the strength of
 * `is_active = false` alone will eventually pay real compensation for a player
 * who never left.
 *
 * Kickoff has always been gated on this (see kickoffPreflight's
 * `departed_player_still_in_pl` blocker). This module exists so the other
 * consumers — departure detection, and anything added later — can share the
 * same check rather than reimplementing it or, worse, going without.
 */

const FPL_URL = 'https://fantasy.premierleague.com/api/bootstrap-static/';

const PARTICLES = new Set([
  'de', 'da', 'do', 'dos', 'das', 'van', 'von', 'del', 'della', 'di', 'la', 'le',
  'el', 'al', 'bin', 'ibn', 'den', 'der', 'ter', 'junior', 'santos', 'silva', 'costa',
]);

export interface FplElement {
  id: number;
  first_name: string;
  second_name: string;
  web_name: string;
  team: number;
}

function normalize(str: string | null | undefined): string {
  if (!str) return '';
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function significantTokens(str: string | null | undefined): string[] {
  return normalize(str).split(' ').filter((t) => t.length >= 3 && !PARTICLES.has(t));
}

/**
 * Does this stored player plausibly describe someone in the live FPL squad list?
 *
 * Deliberately ignores `web_name`. On exactly the rows this check inspects,
 * web_name is the field a bad sync overwrote — Konaté's row carries "Endo",
 * Gordon's carries "Bakwa" — so matching on it identifies the player who
 * corrupted the row rather than the player who owns it. `name` is the field the
 * sync preserves, which makes it the trustworthy signal.
 *
 * Mononyms are the tricky case: "Murillo" shares exactly one token with
 * "Murillo Costa dos Santos", so a single shared token counts when it makes up
 * the whole of one side's name.
 */
export function looksLikeSamePlayer(dbName: string, el: FplElement): boolean {
  const a = significantTokens(dbName);
  const b = significantTokens(`${el.first_name} ${el.second_name}`);
  if (a.length === 0 || b.length === 0) return false;

  const shared = a.filter((t) => b.includes(t));
  if (shared.length >= 2) return true;
  return shared.length === 1 && (a.length === 1 || b.length === 1);
}

/**
 * Fetches the live FPL squad list. Returns null if FPL is unreachable — callers
 * must decide what that means for them. For anything that moves money the
 * answer is "do nothing": an unverifiable departure is not a departure.
 */
export async function fetchFplElements(): Promise<FplElement[] | null> {
  try {
    const res = await fetch(FPL_URL, {
      headers: { 'User-Agent': 'Gaffa/1.0' },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { elements?: FplElement[] };
    return json.elements ?? null;
  } catch {
    return null;
  }
}

/**
 * Of the given players, which are still present in the FPL squad list despite
 * being marked inactive? Those are corrupted rows, not departures.
 */
export function findStillInPl<T extends { id: string; name: string }>(
  players: T[],
  elements: FplElement[],
): Map<string, FplElement> {
  const hits = new Map<string, FplElement>();
  for (const p of players) {
    const match = elements.find((el) => looksLikeSamePlayer(p.name, el));
    if (match) hits.set(p.id, match);
  }
  return hits;
}
