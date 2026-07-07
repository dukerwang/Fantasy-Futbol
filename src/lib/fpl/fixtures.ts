interface FplTeamRaw {
  id: number;
  short_name: string;
}

interface FplFixtureRaw {
  id: number;
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  kickoff_time: string | null;
  started: boolean;
  finished: boolean;
  minutes: number;
}

export interface GwFixture {
  id: number;
  homeShort: string;
  awayShort: string;
  homeScore: number | null;
  awayScore: number | null;
  kickoff: string | null;
  started: boolean;
  finished: boolean;
  minutes: number;
}

/**
 * Fetches this gameweek's Premier League fixtures with live scores,
 * using the same FPL fixtures endpoint as src/lib/fixtures/lockout.ts.
 * Returns up to `limit` fixtures, prioritizing live matches, then the
 * soonest upcoming kickoff, then the most recently finished.
 */
export async function getGameweekFixtures(gameweek: number, limit = 4): Promise<GwFixture[]> {
  try {
    const [bootstrapRes, fixturesRes] = await Promise.all([
      fetch('https://fantasy.premierleague.com/api/bootstrap-static/', { next: { revalidate: 300 } }),
      fetch(`https://fantasy.premierleague.com/api/fixtures/?event=${gameweek}`, { next: { revalidate: 60 } }),
    ]);

    if (!bootstrapRes.ok || !fixturesRes.ok) return [];

    const bootstrap = await bootstrapRes.json();
    const rawFixtures = await fixturesRes.json();

    const shortNameById = new Map<number, string>(
      ((bootstrap.teams ?? []) as FplTeamRaw[]).map((t) => [t.id, t.short_name])
    );

    const fixtures: GwFixture[] = (rawFixtures as FplFixtureRaw[]).map((f) => ({
      id: f.id,
      homeShort: shortNameById.get(f.team_h) ?? '???',
      awayShort: shortNameById.get(f.team_a) ?? '???',
      homeScore: f.team_h_score,
      awayScore: f.team_a_score,
      kickoff: f.kickoff_time,
      started: !!f.started,
      finished: !!f.finished,
      minutes: f.minutes ?? 0,
    }));

    fixtures.sort((a, b) => {
      const priority = (f: GwFixture) => (f.started && !f.finished ? 0 : !f.started ? 1 : 2);
      const pa = priority(a);
      const pb = priority(b);
      if (pa !== pb) return pa - pb;
      if (!a.kickoff || !b.kickoff) return 0;
      return pa === 1
        ? new Date(a.kickoff).getTime() - new Date(b.kickoff).getTime() // soonest upcoming first
        : new Date(b.kickoff).getTime() - new Date(a.kickoff).getTime(); // most recent finished first
    });

    return fixtures.slice(0, limit);
  } catch (error) {
    console.error('Error fetching gameweek fixtures:', error);
    return [];
  }
}
