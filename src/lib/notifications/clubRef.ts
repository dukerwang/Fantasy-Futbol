/**
 * How a club is named in notification copy.
 *
 * In-app bodies and emails use the full club name. Push titles and inbox
 * headlines are short, so they use the 2–4 letter abbreviation when the club
 * has one — the same crest letters managers already recognise from the table.
 */

export interface ClubRef {
  team_name: string;
  abbreviation?: string | null;
}

export function clubName(club: ClubRef | null | undefined, fallback = 'a club'): string {
  const name = club?.team_name?.trim();
  return name || fallback;
}

export function clubAbbr(club: ClubRef | null | undefined, fallback = 'a club'): string {
  const abbr = club?.abbreviation?.trim();
  if (abbr) return abbr;
  return clubName(club, fallback);
}
