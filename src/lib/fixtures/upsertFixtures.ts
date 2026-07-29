/**
 * src/lib/fixtures/upsertFixtures.ts
 *
 * Single writer for public.pl_fixtures.
 *
 * Every row is stamped with its season and references clubs by stable slug.
 * That combination is what stops a rollover from destroying history: FPL
 * restarts fixture ids at 1 each season and reshuffles team ids alphabetically,
 * so an unstamped `upsert(onConflict: 'id')` silently overwrote 2025-26 with
 * 2026-27 and left every archived game log with an "Unknown" opponent.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { slugMapFromBootstrapTeams } from '@/lib/clubs/registry';

const FPL_BASE = 'https://fantasy.premierleague.com/api';
const USER_AGENT = 'FantasyFutbol/1.0';

export interface FplFixtureRaw {
    id: number;
    event: number | null;
    team_h: number;
    team_a: number;
    team_h_score: number | null;
    team_a_score: number | null;
    finished?: boolean;
    kickoff_time: string | null;
}

export interface UpsertResult {
    written: number;
    skipped: number;
}

/**
 * Translates FPL fixtures into season-scoped, slug-keyed rows and upserts them.
 *
 * `teams` must be the bootstrap `teams` array from the SAME payload the
 * fixtures came from — that's the only context in which a seasonal team id
 * means anything, and it's resolved to a slug immediately.
 */
export async function upsertFplFixtures(
    supabase: SupabaseClient,
    season: string,
    fixtures: FplFixtureRaw[],
    teams: { id: number; code: number; name: string }[],
): Promise<UpsertResult> {
    const slugById = slugMapFromBootstrapTeams(teams);

    const rows = [];
    let skipped = 0;

    for (const f of fixtures ?? []) {
        const gameweek = f.event;
        const home = slugById.get(f.team_h);
        const away = slugById.get(f.team_a);

        // A club we can't name is worse than a missing row — it would render a
        // confidently wrong opponent. Skip and let the counter surface it.
        if (!gameweek || !home || !away || home === away) {
            skipped++;
            continue;
        }

        rows.push({
            season,
            fpl_fixture_id: f.id,
            gameweek,
            home_club: home,
            away_club: away,
            home_score: f.team_h_score,
            away_score: f.team_a_score,
            finished: !!f.finished,
            kickoff_time: f.kickoff_time,
            updated_at: new Date().toISOString(),
        });
    }

    if (rows.length > 0) {
        const { error } = await supabase
            .from('pl_fixtures')
            .upsert(rows, { onConflict: 'season,fpl_fixture_id' });
        if (error) throw error;
    }

    return { written: rows.length, skipped };
}

/**
 * Convenience wrapper: pulls the current season's fixtures and team list from
 * FPL and snapshots them. Safe to call on every sync — it's an upsert keyed on
 * (season, fixture), so re-running only refreshes scores.
 */
export async function snapshotCurrentFplFixtures(
    supabase: SupabaseClient,
    season: string,
    eventFilter?: number,
): Promise<UpsertResult> {
    const url = eventFilter ? `${FPL_BASE}/fixtures/?event=${eventFilter}` : `${FPL_BASE}/fixtures/`;

    const [fixRes, bootRes] = await Promise.all([
        fetch(url, { headers: { 'User-Agent': USER_AGENT }, next: { revalidate: 0 } }),
        fetch(`${FPL_BASE}/bootstrap-static/`, {
            headers: { 'User-Agent': USER_AGENT },
            next: { revalidate: 3600 },
        }),
    ]);

    if (!fixRes.ok || !bootRes.ok) {
        throw new Error(`FPL fetch failed (fixtures ${fixRes.status}, bootstrap ${bootRes.status})`);
    }

    const fixtures = (await fixRes.json()) as FplFixtureRaw[];
    const boot = await bootRes.json();

    return upsertFplFixtures(supabase, season, fixtures, boot.teams ?? []);
}
