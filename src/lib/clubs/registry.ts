/**
 * src/lib/clubs/registry.ts
 *
 * Canonical Premier League club registry, keyed by a stable slug.
 *
 * WHY THIS EXISTS
 * ---------------
 * FPL's `teams[].id` is 1–20 assigned alphabetically over whichever 20 clubs
 * are in the division that season, so it is REASSIGNED every single year.
 * Keying anything durable on it silently rots at the summer rollover — and it
 * did: `public/team-logos/19.png` was West Ham's badge when it was committed
 * and became Spurs' badge after a re-download, because id 19 changed hands.
 *
 * So nothing here is keyed on that id. The slug is ours and never changes; a
 * relegated club keeps its entry and simply stops appearing in fixtures, and a
 * promoted club gets a new one. `fplCode` is FPL's OTHER identifier — a stable
 * per-club code (Man Utd is always 1, Arsenal always 3) that does not get
 * reassigned. It's only used to fetch badge art from the PL CDN.
 *
 * Look clubs up by NAME (`resolveClub`), which is what our tables actually
 * store in `players.pl_team`, never by season-scoped numeric id.
 */

import clubsData from './clubs.json';

export interface Club {
    /** Stable, ours, permanent. Also the badge filename: /team-logos/{slug}.png */
    slug: string;
    /** Canonical display name, matching what FPL reports for the club. */
    name: string;
    /** Three-letter abbreviation. */
    shortName: string;
    /**
     * FPL's stable club code — NOT the volatile per-season `teams[].id`.
     * Used to build PL CDN badge URLs.
     */
    fplCode: number;
    /** Primary club colour, used for card accents. */
    color: string;
    /**
     * Every other spelling seen across FPL, SoFIFA and Transfermarkt feeds.
     * Matched case-insensitively.
     */
    aliases: string[];
}

export const CLUBS: Club[] = clubsData as Club[];

/** Fallback accent for a club we have never seen before. */
export const UNKNOWN_CLUB_COLOR = '#3A6B4A';

const byLookup = new Map<string, Club>();
for (const club of CLUBS) {
    byLookup.set(club.slug, club);
    byLookup.set(club.name.toLowerCase(), club);
    byLookup.set(club.shortName.toLowerCase(), club);
    for (const alias of club.aliases) byLookup.set(alias.toLowerCase(), club);
}

export const CLUB_BY_SLUG: ReadonlyMap<string, Club> = new Map(CLUBS.map((c) => [c.slug, c]));

/**
 * Resolves a club from whatever spelling a feed gave us. Returns null rather
 * than guessing, so callers can fall back to a neutral crest instead of
 * confidently showing the wrong badge.
 */
export function resolveClub(nameOrSlug: string | null | undefined): Club | null {
    if (!nameOrSlug) return null;
    return byLookup.get(nameOrSlug.trim().toLowerCase()) ?? null;
}

/** Badge path for a club name. Null when we can't identify the club. */
export function clubBadgePath(nameOrSlug: string | null | undefined): string | null {
    const club = resolveClub(nameOrSlug);
    return club ? `/team-logos/${club.slug}.png` : null;
}

/** Primary colour for a club name, falling back to the neutral accent. */
export function clubColor(nameOrSlug: string | null | undefined): string {
    return resolveClub(nameOrSlug)?.color ?? UNKNOWN_CLUB_COLOR;
}

/** Every badge path, for preloading. */
export function allBadgePaths(): string[] {
    return CLUBS.map((c) => `/team-logos/${c.slug}.png`);
}

const byFplCode = new Map(CLUBS.map((c) => [c.fplCode, c]));

/**
 * Resolves a club from FPL's stable per-club `code`. Use this when translating
 * an FPL payload — never `teams[].id`, which is reassigned each season.
 */
export function clubByFplCode(code: number | null | undefined): Club | null {
    return code == null ? null : byFplCode.get(code) ?? null;
}

/**
 * Builds an FPL-season-id → slug map from a bootstrap `teams` array.
 *
 * This is the ONLY place a seasonal team id is allowed to be interpreted, and
 * only against the same payload it came from — it is translated to a stable
 * slug immediately and never persisted.
 */
export function slugMapFromBootstrapTeams(
    teams: { id: number; code: number; name: string }[],
): Map<number, string> {
    const out = new Map<number, string>();
    for (const t of teams) {
        const club = clubByFplCode(t.code) ?? resolveClub(t.name);
        if (club) out.set(t.id, club.slug);
    }
    return out;
}
