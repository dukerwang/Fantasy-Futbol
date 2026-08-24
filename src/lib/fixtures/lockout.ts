import { SupabaseClient } from '@supabase/supabase-js';
import { getCurrentFplSeason } from '@/lib/season/currentSeason';
import { resolveClub, slugMapFromBootstrapTeams } from '@/lib/clubs/registry';

const FPL_BASE = 'https://fantasy.premierleague.com/api';
const USER_AGENT = 'FantasyFutbol/1.0';

/**
 * Returns a Set of FPL team IDs whose matches have already kicked off for the
 * specified gameweek. Hybrid: the local `pl_fixtures` table first, falling back
 * to FPL live if we have no rows for this season yet.
 *
 * Note on ids: pl_fixtures now stores stable club slugs rather than FPL's
 * per-season team ids, so those are translated back here. Returning ids is
 * still correct for this one function because lockout only ever concerns the
 * CURRENT gameweek, and `players.pl_team_id` is likewise always the current
 * sync's numbering — the two are consistent within a season. Never persist the
 * result or compare it against archived data.
 */
export async function getLockedPlTeamIds(
    admin: SupabaseClient,
    gameweek: number,
): Promise<Set<number>> {
    const lockedPlTeamIds = new Set<number>();
    const now = new Date();

    // 1. Try local database query first
    try {
        const season = await getCurrentFplSeason(undefined, true);
        const { data: dbFixtures } = await admin
            .from('pl_fixtures')
            .select('home_club, away_club, kickoff_time')
            .eq('season', season)
            .eq('gameweek', gameweek);

        if (dbFixtures && dbFixtures.length > 0) {
            const lockedSlugs = new Set<string>();
            for (const f of dbFixtures) {
                if (f.kickoff_time && new Date(f.kickoff_time) <= now) {
                    lockedSlugs.add(f.home_club);
                    lockedSlugs.add(f.away_club);
                }
            }

            if (lockedSlugs.size === 0) return lockedPlTeamIds;

            const bootRes = await fetch(`${FPL_BASE}/bootstrap-static/`, {
                headers: { 'User-Agent': USER_AGENT },
                next: { revalidate: 3600 },
            });
            if (bootRes.ok) {
                const boot = await bootRes.json();
                for (const [fplId, slug] of slugMapFromBootstrapTeams(boot.teams ?? [])) {
                    if (lockedSlugs.has(slug)) lockedPlTeamIds.add(fplId);
                }
                return lockedPlTeamIds;
            }
            // Bootstrap failed — fall through to the live fixture path rather
            // than returning an empty set, which would silently unlock everyone.
        }
    } catch (dbErr) {
        console.error('[lockout] Failed to query local pl_fixtures:', dbErr);
    }

    // 2. Fall back to FPL API synchronously if local database has no data
    try {
        const res = await fetch(`${FPL_BASE}/fixtures/?event=${gameweek}`, {
            headers: { 'User-Agent': USER_AGENT },
            next: { revalidate: 0 },
        });
        if (res.ok) {
            const fixtures = await res.json();
            interface FplFixtureRaw {
                team_h: number;
                team_a: number;
                kickoff_time: string | null;
            }
            for (const f of fixtures as FplFixtureRaw[]) {
                if (f.kickoff_time && new Date(f.kickoff_time) <= now) {
                    lockedPlTeamIds.add(f.team_h);
                    lockedPlTeamIds.add(f.team_a);
                }
            }
        }
    } catch (apiErr) {
        console.error('[lockout] Failed to fetch FPL fixtures backup:', apiErr);
    }

    return lockedPlTeamIds;
}

/**
 * Returns a Set of FPL team IDs whose matches are finished (or provisionally
 * finished) for the given gameweek — as opposed to {@link getLockedPlTeamIds},
 * which only tells you a match has kicked off. Auto-sub eligibility needs
 * "finished", not "locked": a blanked starter isn't covered by a bench player
 * until his own match is confirmed over. Shared between the matchup processor
 * (writes the resolved score) and the live matchup detail page (previews it),
 * so the two can't drift on which matches count as finished.
 */
export async function getFinishedPlTeamIds(gameweek: number): Promise<Set<number>> {
    const finishedPlTeamIds = new Set<number>();
    try {
        const res = await fetch(`${FPL_BASE}/fixtures/?event=${gameweek}`, {
            headers: { 'User-Agent': USER_AGENT },
            next: { revalidate: 60 },
        });
        if (res.ok) {
            const fixtures = await res.json();
            for (const f of fixtures as { team_h: number; team_a: number; finished?: boolean; finished_provisional?: boolean }[]) {
                if (f.finished || f.finished_provisional) {
                    finishedPlTeamIds.add(f.team_h);
                    finishedPlTeamIds.add(f.team_a);
                }
            }
        }
    } catch { /* Fail open — nothing counted as finished */ }
    return finishedPlTeamIds;
}

/**
 * Whether this gameweek's last *dated* kickoff has already happened.
 *
 * Null kickoffs are ignored (postponed / unscheduled rows) so one abandoned
 * match cannot freeze the handoff to next week. No dated fixtures at all
 * means "don't flip" — fail closed rather than open next week before GW1.
 */
export function lastDatedKickoffHasPassed(
    fixtures: { kickoff_time: string | null }[],
    now: Date = new Date(),
): boolean {
    let latest = Number.NEGATIVE_INFINITY;
    for (const f of fixtures) {
        if (!f.kickoff_time) continue;
        const t = new Date(f.kickoff_time).getTime();
        if (!Number.isFinite(t)) continue;
        if (t > latest) latest = t;
    }
    if (latest === Number.NEGATIVE_INFINITY) return false;
    return latest <= now.getTime();
}

/**
 * DB/FPL-backed version of {@link lastDatedKickoffHasPassed}. Fails closed
 * (returns false) if we cannot see any fixtures — the squad editor stays on
 * this week rather than unlocking next week by accident.
 */
export async function hasGameweekLastKickoffPassed(
    admin: SupabaseClient,
    gameweek: number,
    now: Date = new Date(),
): Promise<boolean> {
    try {
        const season = await getCurrentFplSeason(undefined, true);
        const { data: dbFixtures } = await admin
            .from('pl_fixtures')
            .select('kickoff_time')
            .eq('season', season)
            .eq('gameweek', gameweek);

        if (dbFixtures && dbFixtures.length > 0) {
            return lastDatedKickoffHasPassed(dbFixtures, now);
        }
    } catch (dbErr) {
        console.error('[lockout] Failed to query last kickoff from pl_fixtures:', dbErr);
    }

    try {
        const res = await fetch(`${FPL_BASE}/fixtures/?event=${gameweek}`, {
            headers: { 'User-Agent': USER_AGENT },
            next: { revalidate: 0 },
        });
        if (res.ok) {
            return lastDatedKickoffHasPassed(await res.json(), now);
        }
    } catch (apiErr) {
        console.error('[lockout] Failed to fetch FPL fixtures for last kickoff:', apiErr);
    }

    return false;
}

/**
 * Opponent lookup for a club in a past (or current) season, from our own
 * fixture snapshot. This is what lets an archived game log name an opponent —
 * FPL no longer serves past-season fixtures, and recycles fixture ids, so it
 * cannot be asked.
 */
export interface FixtureLookupEntry {
    fixtureId: number;
    gameweek: number;
    opponentSlug: string;
    opponentShortName: string;
    isHome: boolean;
    scoreFor: number | null;
    scoreAgainst: number | null;
    finished: boolean;
}

export interface ClubFixtureLog {
    /** Keyed on FPL fixture id — the only key that survives a double gameweek. */
    byFixture: Map<number, FixtureLookupEntry>;
    /** Every fixture a club played in a gameweek, in kickoff order. */
    byGameweek: Map<number, FixtureLookupEntry[]>;
}

export async function getClubFixtureLog(
    admin: SupabaseClient,
    season: string,
    clubName: string | null | undefined,
): Promise<ClubFixtureLog> {
    const club = resolveClub(clubName);
    const log: ClubFixtureLog = { byFixture: new Map(), byGameweek: new Map() };
    if (!club) return log;

    const { data } = await admin
        .from('pl_fixtures')
        .select('fpl_fixture_id, gameweek, home_club, away_club, home_score, away_score, finished, kickoff_time')
        .eq('season', season)
        .or(`home_club.eq.${club.slug},away_club.eq.${club.slug}`)
        .order('kickoff_time', { ascending: true });

    for (const f of data ?? []) {
        const isHome = f.home_club === club.slug;
        const opponentSlug = isHome ? f.away_club : f.home_club;
        const entry: FixtureLookupEntry = {
            fixtureId: f.fpl_fixture_id,
            gameweek: f.gameweek,
            opponentSlug,
            opponentShortName: resolveClub(opponentSlug)?.shortName ?? 'UNK',
            isHome,
            scoreFor: isHome ? f.home_score : f.away_score,
            scoreAgainst: isHome ? f.away_score : f.home_score,
            finished: !!f.finished,
        };
        log.byFixture.set(entry.fixtureId, entry);
        // A club can play twice in one gameweek, so this is a list. Keying it as
        // a single entry silently labelled one of the two appearances with the
        // other one's opponent.
        const forGw = log.byGameweek.get(f.gameweek) ?? [];
        forGw.push(entry);
        log.byGameweek.set(f.gameweek, forGw);
    }

    return log;
}
