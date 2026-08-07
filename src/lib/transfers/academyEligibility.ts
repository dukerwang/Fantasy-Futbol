/**
 * Whether a player can be proactively routed to the academy on an auction
 * win (migration 117) — independent of whether the bidder's active roster
 * happens to be full. Age math mirrors the server-side copy in
 * `src/app/api/leagues/[leagueId]/auctions/bid/route.ts` and
 * `resolve_single_player_auction_rpc`; this is the client-side pre-check
 * that decides whether the "send to academy" checkbox even appears.
 */

export interface AcademyCapacity {
  current: number;
  max: number;
  age_limit: number;
}

export function calculateAgeInYears(dobIso: string, referenceDate = new Date()): number {
  const dob = new Date(dobIso);
  let age = referenceDate.getFullYear() - dob.getFullYear();
  const monthDiff = referenceDate.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && referenceDate.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

export function isAcademyEligible(
  dateOfBirth: string | null | undefined,
  academy: AcademyCapacity,
  referenceDate = new Date(),
): boolean {
  if (!dateOfBirth) return false;
  if (academy.current >= academy.max) return false;
  return calculateAgeInYears(dateOfBirth, referenceDate) <= academy.age_limit;
}
