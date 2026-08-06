/**
 * Latest kicked-off FPL gameweek (deadline passed). 0 if unavailable.
 *
 * Deliberately NOT `getFplStatus().currentGw` from `@/lib/fpl/api`: that one
 * floors at 1 and reports 1 during the offseason, which is right for "which
 * gameweek are we playing" but wrong here. Callers use this to bound a
 * `player_stats` form window — a 1 where the truth is "no gameweek has kicked
 * off yet" makes preseason read as a GW1 in which everyone scored zero.
 *
 * Lifted verbatim out of the club page when the club view became shared
 * between your own squad and a rival's.
 */
export async function resolveCurrentGw(): Promise<number> {
  try {
    const res = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      headers: { 'User-Agent': 'FantasyFutbol/1.0' },
      next: { revalidate: 300 },
    });
    if (!res.ok) return 0;
    const data = await res.json();
    const now = new Date();
    let gw = 0;
    for (const ev of data.events as any[]) {
      if (ev.deadline_time && new Date(ev.deadline_time) <= now) gw = Math.max(gw, ev.id);
    }
    return gw;
  } catch {
    return 0;
  }
}
