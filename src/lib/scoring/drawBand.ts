/**
 * The draw band — the one rule that makes a Gaffa scoreline different from
 * every other fantasy scoreline, and until now the one written down in seven
 * places.
 *
 * A regular-season matchup decided by 10 points or fewer is a draw. See
 * docs/USER_GUIDE.md § 5 for why the band exists at all: fantasy margins of a
 * point or two are noise from a bonus-point recount, not a result, and a
 * league that calls them wins rewards the recount rather than the squad.
 *
 * It was a bare `10` in matchupProcessor, in buildHomeModel (whose comment
 * already said "Mirrors DRAW_THRESHOLD", which is the tell), in the matchups
 * list, the matchup detail, the match-report generator, and the league_standings
 * view. Port 5 needed an eighth for the margin axis, which is the point at which
 * a mirrored constant has to become a shared one — the same move the stats pool
 * made when the spectrum's second consumer would have been a second copy of the
 * twelve hues.
 *
 * NOTE the SQL side is not covered by this file: `league_standings` encodes the
 * same 10 in its own CASE expression. Changing the band means changing both, and
 * a migration is the only way to reach the view.
 *
 * CUP TIES DO NOT USE THIS. A cup tie never draws — level score goes to the best
 * individual performer, then to the higher bracket seed. Reaching for the band
 * in tournament code is always wrong.
 */

/** Points. A margin at or under this is a draw. */
export const DRAW_THRESHOLD = 10;

/** Whether a settled margin falls inside the band. */
export function isDrawMargin(scoreA: number, scoreB: number): boolean {
    return Math.abs(scoreA - scoreB) <= DRAW_THRESHOLD;
}
