/**
 * Premier League player photography — the one real image source the product
 * has, and the Gaffa 2.0 portrait is built on it.
 *
 * The id is FPL bootstrap's `elements[].code` (the `photo` field minus its
 * `.jpg`), NOT `elements[].id`. Element ids are reassigned every summer along
 * with team ids and fixture ids; the code is stable for the player's whole
 * career. `players.photo_url` is where we happen to store it — the sync writes
 * `.../110x140/{code}.png` because that is the filename FPL itself uses — so
 * the code has to be read back out of that URL rather than from a column.
 *
 * Two paths exist on the CDN and they are NOT the same picture:
 *
 *   110x140  a 220x280 cut-out, tightly framed, fills its frame edge to edge
 *   500x500  a square cut-out with the figure centred — what the 2.0 portrait
 *            crop (x 18-82%, y 0-69%) was measured against
 *
 * A `250x250` path is sometimes assumed to exist. It does not: every request
 * to it 403s, and the ~250-byte body people have taken for a placeholder image
 * is that 403's XML error document.
 *
 * AVAILABILITY. A player with no cut-out gets a 403, not a placeholder and not
 * a 404 — so availability is a status question, not a byte-size one, and in the
 * browser a plain `onerror` on an <img> is enough. It is worth handling
 * properly: measured against the full 2026-27 bootstrap on 2026-08-10, 156 of
 * 573 players (27%) have no 500x500 cut-out at all.
 *
 * Coverage is NOT nested — plenty of those 156 do have a 110x140 — which is
 * why the portrait tries the square source, then the tall one, then the serif
 * initial. Each source gets its own measured crop; see `portraitFallbackUrl`.
 *
 * CACHE BUSTING. PL's CDN sends no Cache-Control/Expires on these images, so
 * a browser that already has a URL cached from before PL replaced its bytes
 * has no way to know to refetch — confirmed 2026-08-24 for Saka and Timber,
 * whose photos were freshly reshot but whose player-card view (a different
 * URL, the 110x140 one, from Portrait.tsx's 500x500-primary avatar) kept
 * showing 2025/26. `players.photo_version` (migration 136) is a version
 * stamp captured off the CDN's own Last-Modified header by
 * scripts/backfill_portrait_crops.ts; every helper below appends it as a
 * `?v=` query param so the browser's cache key changes whenever PL updates a
 * player's photo, regardless of the missing cache headers.
 */

/** The `.../<size>/<code>.png` filename FPL uses, pulled back out of a stored URL. */
export function fplPhotoCode(photoUrl: string | null | undefined): string | null {
  return /\/(\d+)\.(?:png|jpg)$/i.exec(photoUrl ?? '')?.[1] ?? null;
}

function codeOf(photoUrlOrCode: string | null | undefined): string | null {
  return fplPhotoCode(photoUrlOrCode) ?? (/^\d+$/.test(photoUrlOrCode ?? '') ? photoUrlOrCode! : null);
}

export function withVersion(url: string, version: string | null | undefined): string {
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

/**
 * The 500x500 cut-out the 2.0 portrait crop is measured against. Returns null
 * when there is no code to build from; a code that has no cut-out on the CDN
 * still yields a URL, and the 403 surfaces as the <img>'s error event.
 */
export function portraitUrl(
  photoUrlOrCode: string | null | undefined,
  version?: string | null,
): string | null {
  const code = codeOf(photoUrlOrCode);
  return code
    ? withVersion(`https://resources.premierleague.com/premierleague25/photos/players/500x500/${code}.png`, version)
    : null;
}

/**
 * The 220x280 cut-out, tried when the square one 403s. It closes most of the
 * 27% gap, but it is a DIFFERENT picture — framed tighter, so it needs its own
 * crop rather than the locked one. Measured 2026-08-10
 * (`scratch/solve_portrait_zoom.mjs`), matching head width in the composed
 * frame against the 500x500 crop across eight players: **142%** where the
 * square source uses 156.25% (136% where it uses 150%). The interpolated exact
 * match was 1.418. Insets are unchanged — the head is flush to the top edge in
 * both sources (0-0.4% square, 0-1.1% tall), so "push the image down, never
 * crop higher" carries over untouched.
 *
 * Per-player variance is wider in this source than in the square one, so it is
 * a fallback and not a replacement.
 */
export function portraitFallbackUrl(
  photoUrlOrCode: string | null | undefined,
  version?: string | null,
): string | null {
  const code = codeOf(photoUrlOrCode);
  return code
    ? withVersion(`https://resources.premierleague.com/premierleague25/photos/players/110x140/${code}.png`, version)
    : null;
}

/** The portrait sources in the order they should be tried. */
export function portraitSources(
  photoUrlOrCode: string | null | undefined,
  version?: string | null,
): string[] {
  return [portraitUrl(photoUrlOrCode, version), portraitFallbackUrl(photoUrlOrCode, version)].filter(
    (u): u is string => u !== null,
  );
}

/**
 * Server-side availability probe, returning the first source that exists. The
 * client does not need this — the <img> error event covers it — but a backfill
 * or a sync that wants to record which players have a cut-out does. HEAD is
 * enough.
 */
export async function resolvePortrait(
  photoUrlOrCode: string | null | undefined,
): Promise<string | null> {
  for (const url of portraitSources(photoUrlOrCode)) {
    try {
      if ((await fetch(url, { method: 'HEAD' })).ok) return url;
    } catch {
      // Network failure is not the same as absence; try the next source.
    }
  }
  return null;
}

/**
 * The one or two letters the fallback shows. Initials, not a single letter:
 * with 27% of the pool falling back, a column of lone "M"s stops identifying
 * anyone.
 */
export function portraitInitials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0]!.toUpperCase())
    .slice(0, 2)
    .join('');
}
