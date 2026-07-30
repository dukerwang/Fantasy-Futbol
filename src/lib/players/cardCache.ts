'use client';

/**
 * src/lib/players/cardCache.ts
 *
 * Module-level caches for the premium player card. These live outside React so
 * they survive route changes and modal unmounts — reopening a player you have
 * already seen costs nothing and paints synchronously.
 *
 * Three things are cached:
 *   - front payloads (identity/stats/ranks/crest) per player+league
 *   - back payloads (game log, career history) per player+league
 *   - which image URLs have already decoded, so a warm photo renders with no
 *     fade-in at all
 *
 * In-flight requests are deduped, so hovering a row and then clicking it does
 * not issue the same fetch twice.
 */

import type { Player, PlayerOwnership, PlayerSeasonArchive } from '@/types';

export interface CardGamelogEntry {
  gameweek: number;
  fantasy_points: number;
  match_rating: number | null;
  stats: { minutes_played?: number; goals?: number; assists?: number } | null;
  opponent?: string;
  result?: string;
  date?: string;
  isDNP?: boolean;
  by_position?: Record<string, { fantasy_points: number; match_rating: number | null }>;
}

export interface CardFront {
  player: Player;
  /** `undefined` means unresolved; `null` means known free agent. */
  ownership: PlayerOwnership | null | undefined;
}

export interface CardBack {
  gamelog: CardGamelogEntry[];
  history: PlayerSeasonArchive[];
}

/**
 * Owner crests for a whole league, seeded once per league navigation by
 * LeagueOwnershipSeed. Holding it here rather than threading a map through
 * every page is what makes the crest present on the first frame everywhere,
 * not just on the pages that remembered to pass it.
 */
const ownershipByLeague = new Map<string, Record<string, PlayerOwnership>>();

export function primeLeagueOwnership(
  leagueId: string,
  map: Record<string, PlayerOwnership>,
): void {
  ownershipByLeague.set(leagueId, map);
}

/**
 * `undefined` — this league's roster map hasn't been seeded, so the answer is
 * genuinely unknown and worth a lookup. `null` — seeded, and this player is a
 * free agent. Outside a league there is no crest to show, so that reads null.
 */
export function getOwnershipFor(
  playerId: string,
  leagueId?: string | null,
): PlayerOwnership | null | undefined {
  if (!leagueId) return null;
  const map = ownershipByLeague.get(leagueId);
  if (!map) return undefined;
  return map[playerId] ?? null;
}

const frontCache = new Map<string, CardFront>();
const backCache = new Map<string, CardBack>();
const frontInflight = new Map<string, Promise<CardFront | null>>();
const backInflight = new Map<string, Promise<CardBack | null>>();

/** URLs whose bytes are decoded and safe to paint in the same frame. */
const decodedImages = new Set<string>();

export function cacheKey(playerId: string, leagueId?: string | null): string {
  return `${playerId}|${leagueId ?? ''}`;
}

// ── Front ────────────────────────────────────────────────────────────────────

export function getCachedFront(playerId: string, leagueId?: string | null): CardFront | null {
  return frontCache.get(cacheKey(playerId, leagueId)) ?? null;
}

/**
 * Seeds the cache from data a page already had. List pages hydrate players with
 * ranks server-side, so priming here means the card never needs `/card` at all.
 * Ownership comes from the league-wide seed unless the caller overrides it.
 */
export function primeFront(
  player: Player,
  leagueId?: string | null,
  ownership?: PlayerOwnership | null,
): void {
  frontCache.set(cacheKey(player.id, leagueId), {
    player,
    ownership: ownership !== undefined ? ownership : getOwnershipFor(player.id, leagueId),
  });
}

export function fetchFront(
  playerId: string,
  leagueId?: string | null,
): Promise<CardFront | null> {
  const key = cacheKey(playerId, leagueId);
  const cached = frontCache.get(key);
  if (cached) return Promise.resolve(cached);

  const existing = frontInflight.get(key);
  if (existing) return existing;

  const query = leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : '';
  const promise = fetch(`/api/players/${playerId}/card${query}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data?.player) return null;
      const front: CardFront = { player: data.player, ownership: data.ownership ?? null };
      frontCache.set(key, front);
      return front;
    })
    .catch(() => null)
    .finally(() => {
      frontInflight.delete(key);
    });

  frontInflight.set(key, promise);
  return promise;
}

// ── Back ─────────────────────────────────────────────────────────────────────

export function getCachedBack(playerId: string, leagueId?: string | null): CardBack | null {
  // v3: secondary ratings skip post-curve OOP so Rtg tracks Pts on the card.
  return backCache.get(`${cacheKey(playerId, leagueId)}|v3`) ?? null;
}

export function fetchBack(playerId: string, leagueId?: string | null): Promise<CardBack | null> {
  const key = `${cacheKey(playerId, leagueId)}|v3`;
  const cached = backCache.get(key);
  if (cached) return Promise.resolve(cached);

  const existing = backInflight.get(key);
  if (existing) return existing;

  const query = leagueId ? `?leagueId=${encodeURIComponent(leagueId)}` : '';
  const promise = fetch(`/api/players/${playerId}/log${query}`)
    .then((r) => (r.ok ? r.json() : null))
    .then((data) => {
      if (!data) return null;
      const back: CardBack = { gamelog: data.gamelog ?? [], history: data.history ?? [] };
      backCache.set(key, back);
      return back;
    })
    .catch(() => null)
    .finally(() => {
      backInflight.delete(key);
    });

  backInflight.set(key, promise);
  return promise;
}

// ── Images ───────────────────────────────────────────────────────────────────

/**
 * Synchronous check used during render. When true the card paints the photo
 * immediately with no placeholder and no transition.
 */
export function isImageReady(url: string | null | undefined): boolean {
  return !!url && decodedImages.has(url);
}

export function markImageReady(url: string | null | undefined): void {
  if (url) decodedImages.add(url);
}

/**
 * Downloads and decodes an image, resolving true on success. Safe to call
 * repeatedly — already-decoded URLs resolve synchronously on the microtask
 * queue without touching the network.
 */
export function warmImage(url: string | null | undefined): Promise<boolean> {
  if (!url) return Promise.resolve(false);
  if (decodedImages.has(url)) return Promise.resolve(true);
  if (typeof window === 'undefined') return Promise.resolve(false);

  return new Promise((resolve) => {
    const img = new window.Image();
    img.referrerPolicy = 'no-referrer';
    img.onload = () => {
      decodedImages.add(url);
      resolve(true);
    };
    img.onerror = () => resolve(false);
    img.src = url;
  });
}

/** Fire-and-forget warm for a batch of URLs (visible list rows, crests). */
export function warmImages(urls: (string | null | undefined)[]): void {
  for (const url of urls) void warmImage(url);
}

// ── Prefetch on intent ───────────────────────────────────────────────────────

/**
 * Called when the user signals intent (hover/focus on a row). Warms the photo
 * and pulls both halves so the click itself has nothing left to wait on.
 */
export function prefetchPlayerCard(
  player: { id: string; photo_url?: string | null },
  leagueId?: string | null,
): void {
  void warmImage(player.photo_url);
  void fetchBack(player.id, leagueId);
  if (!getCachedFront(player.id, leagueId)) {
    void fetchFront(player.id, leagueId);
  }
}
