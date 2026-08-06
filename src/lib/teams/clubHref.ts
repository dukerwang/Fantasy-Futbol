/**
 * Where a club's page lives.
 *
 * Your own club keeps `/team/roster`: `/clubs/[teamId]` renders it correctly
 * too (the loader resolves `viewerIsOwner` from the row, not the route), but the
 * one page you can actually act on shouldn't answer to two addresses — the nav
 * highlight, the browser history and anything the user bookmarks all disagree
 * the moment it does.
 */
export function clubHref(leagueId: string, teamId: string, isMine: boolean): string {
  return isMine ? `/league/${leagueId}/team/roster` : `/league/${leagueId}/clubs/${teamId}`;
}
