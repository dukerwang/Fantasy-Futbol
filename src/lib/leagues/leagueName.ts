import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Process-lifetime cache — a league's name essentially never changes, and
 * this gets called once per notification/email fanned out to a whole squad
 * (season reset/kickoff, auction resolution's winner+seller+scout+solidarity
 * fan-out), which would otherwise turn into one `leagues` SELECT per
 * recipient for the exact same league.
 */
const cache = new Map<string, string>();

/** League name for a leagueId, or null for an account-wide leagueId (product updates etc). */
export async function getLeagueName(
  admin: SupabaseClient,
  leagueId: string | null | undefined,
): Promise<string | null> {
  if (!leagueId) return null;
  const cached = cache.get(leagueId);
  if (cached) return cached;

  const { data } = await admin.from('leagues').select('name').eq('id', leagueId).maybeSingle();
  const name = data?.name ?? null;
  if (name) cache.set(leagueId, name);
  return name;
}

/**
 * Prefixes a push title with the league name so a manager in more than one
 * league can tell which one fired a lock-screen banner without opening it —
 * unlike the in-app inbox, a push has no surrounding page to supply that
 * context. Truncates the event half first (the league name is the part doing
 * the disambiguating); only clips the league name itself if it alone blows
 * the budget.
 */
export function withLeaguePrefix(leagueName: string | null, eventTitle: string, maxLength = 65): string {
  if (!leagueName) return eventTitle;

  const prefix = `${leagueName}: `;
  if (prefix.length >= maxLength - 5) {
    return prefix.length > maxLength ? `${leagueName.slice(0, maxLength - 1)}…` : `${prefix.trimEnd()}`;
  }

  const budget = maxLength - prefix.length;
  const event = eventTitle.length > budget ? `${eventTitle.slice(0, budget - 1)}…` : eventTitle;
  return `${prefix}${event}`;
}

/** Prefixes an email subject the same way inbox digests/forums do: "[League] Subject". */
export function withLeagueSubjectPrefix(leagueName: string | null, subject: string): string {
  return leagueName ? `[${leagueName}] ${subject}` : subject;
}
