/**
 * Which Premier League clubs are "locked" right now — i.e. have already kicked
 * off in the current gameweek.
 *
 * Used to defer roster moves that would change a lineup already in play:
 * manager listings, a drop-player nominated on a winning bid, trades, loans,
 * and queued drops. Free-agent auctions settle at the clock even when the
 * player's club is locked — there is no seller XI to protect (migration 136).
 *
 * The cron computed this inline; Buy Now has to resolve auctions inline too,
 * so both need the same answer and it lives here.
 *
 * Fails OPEN (returns an empty set) on any FPL error. That matches the cron's
 * existing behaviour: a transient FPL outage should not wedge every auction in
 * the league. The cost of being wrong is one player moving mid-match; the cost
 * of failing closed is auctions never resolving at all.
 *
 * NOTE: the ids returned are FPL's seasonal `teams[].id` values, which are
 * reassigned every summer (see CLAUDE.md). That is safe here only because they
 * are compared against `players.pl_team_id` from the same live bootstrap within
 * the same request, and never stored.
 */

const FPL_BOOTSTRAP = 'https://fantasy.premierleague.com/api/bootstrap-static/';
const FPL_FIXTURES = 'https://fantasy.premierleague.com/api/fixtures/';

export interface LockedClubs {
  lockedPlTeamIds: number[];
  currentGameweek: number;
}

export async function getLockedPlTeamIds(): Promise<LockedClubs> {
  const locked = new Set<number>();
  let currentGw = 0;

  try {
    const res = await fetch(FPL_BOOTSTRAP, {
      headers: { 'User-Agent': 'FantasyFutbol/1.0' },
      next: { revalidate: 300 },
    });
    if (!res.ok) return { lockedPlTeamIds: [], currentGameweek: 0 };

    const data = await res.json();
    const now = new Date();
    let finished = false;

    // Current GW = the highest whose deadline has passed.
    for (const ev of data.events as { id: number; deadline_time: string | null; finished: boolean }[]) {
      if (!ev.deadline_time || new Date(ev.deadline_time) > now) continue;
      if (ev.id > currentGw) {
        currentGw = ev.id;
        finished = ev.finished;
      } else if (ev.id === currentGw) {
        finished = ev.finished;
      }
    }

    // A finished gameweek locks nobody — everyone's matches are over.
    if (!currentGw || finished) return { lockedPlTeamIds: [], currentGameweek: currentGw };

    const fixRes = await fetch(`${FPL_FIXTURES}?event=${currentGw}`, {
      headers: { 'User-Agent': 'FantasyFutbol/1.0' },
      next: { revalidate: 60 },
    });
    if (!fixRes.ok) return { lockedPlTeamIds: [], currentGameweek: currentGw };

    for (const f of await fixRes.json()) {
      if (f.kickoff_time && new Date(f.kickoff_time) <= now) {
        locked.add(f.team_h);
        locked.add(f.team_a);
      }
    }
  } catch (err) {
    console.error('[lockedClubs] FPL lookup failed, failing open:', err);
    return { lockedPlTeamIds: [], currentGameweek: currentGw };
  }

  return { lockedPlTeamIds: Array.from(locked), currentGameweek: currentGw };
}
