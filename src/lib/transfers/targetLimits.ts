/**
 * How many targets a club may hold.
 *
 * Lives here rather than in the route because `route.ts` files may only
 * export the App Router's own handlers and config — a stray const there is a
 * build error waiting to happen — and because the editor needs the same
 * numbers to grey out its own controls.
 *
 * The public cap is the one doing real work. In a 10–12 club league a board
 * where one enthusiastic manager holds twenty ads is not a market, it is that
 * manager's notepad with an audience.
 */

/** Live targets per club, public and private together. */
export const MAX_ACTIVE_TARGETS = 10;

/** Of those, how many the rest of the league may see. */
export const MAX_PUBLIC_TARGETS = 5;

/** Days a target stands before it rolls off on the read filter. */
export const TARGET_TTL_DAYS = 28;

export const TARGET_TTL_MS = TARGET_TTL_DAYS * 24 * 60 * 60 * 1000;

/** Free text on a target — one line of context, not a cover letter. */
export const TARGET_NOTE_MAX = 140;
