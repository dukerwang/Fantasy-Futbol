export interface FplStatus {
  currentGw: number;
  isFinished: boolean;
  nextGwIsClose: boolean;
}

/**
 * Fetches the current FPL gameweek and its finished status.
 * Results are cached for 5 minutes.
 */
export async function getFplStatus(): Promise<FplStatus> {
  try {
    const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
      next: { revalidate: 300 },
    });
    
    if (!fplRes.ok) {
      return { currentGw: 1, isFinished: false };
    }

    const fplData = await fplRes.json();
    const now = new Date();
    let currentGw = 1;

    // Find latest gameweek that has passed the deadline
    for (const ev of fplData.events as any[]) {
      if (ev.deadline_time && new Date(ev.deadline_time) <= now) {
        currentGw = Math.max(currentGw, ev.id);
      }
    }

    const currentEvent = (fplData.events as any[]).find((e: any) => e.id === currentGw);
    const isFinished = currentEvent?.finished ?? false;

    let nextGwIsClose = false;
    const nextGW = (fplData.events as any[]).find((e: any) => !e.finished && e.is_next);
    if (nextGW) {
      const daysUntil = (new Date(nextGW.deadline_time).getTime() - Date.now()) / 86400000;
      if (daysUntil <= 3) nextGwIsClose = true;
    }

    return { currentGw, isFinished, nextGwIsClose };
  } catch (error) {
    console.error('Error fetching FPL status:', error);
    return { currentGw: 1, isFinished: false, nextGwIsClose: false };
  }
}
