import { NextRequest, NextResponse } from 'next/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { fetchPLTeams, fetchPlayersByTeam, ApiPlayer } from '@/lib/api-football/client';
import { GranularPosition } from '@/types';
import stringSimilarity from 'string-similarity';

export const maxDuration = 60; // 1 minute max for Vercel Hobby tier

/**
 * Normalizes player names to help with matching between FPL and API-Football.
 * E.g., removes accents, lowercases, handles common suffixes.
 */
function normalizeName(name: string): string {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '') // remove diacritics
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '') // remove punctuation
        .trim();
}

/**
 * Maps a GranularPosition to the broad category API-Football uses.
 * API-Football only reports: "Goalkeeper" | "Defender" | "Midfielder" | "Attacker"
 */
function getBroadCategory(pos: GranularPosition): string {
    if (pos === 'GK') return 'GK';
    if (pos === 'CB' || pos === 'RB' || pos === 'LB') return 'DEF';
    if (pos === 'ST') return 'FWD';
    return 'MID'; // DM, CM, AM, LW, RW
}

/**
 * Maps an API-Football position string to a broad category.
 */
function getApiBroadCategory(apiPos: string): string | null {
    const p = apiPos.toLowerCase();
    if (p.includes('goalkeeper')) return 'GK';
    if (p.includes('defender')) return 'DEF';
    if (p.includes('midfielder')) return 'MID';
    if (p.includes('attacker')) return 'FWD';
    return null;
}

/**
 * Derives secondary positions from API-Football statistics by comparing the API's
 * broad category against the FPL-derived granular primary position.
 *
 * API-Football only returns: "Goalkeeper" | "Defender" | "Midfielder" | "Attacker"
 * When these differ cross-category from the FPL position, it's a real data signal:
 *   - FPL MID (winger/CM/AM) seen as Attacker by API → secondary ST
 *     e.g. a winger FPL calls MID but API tracks as playing forward = genuine hybrid
 *   - FPL FWD (striker) seen as Midfielder by API → secondary AM
 *     e.g. a striker who consistently drops into midfield
 *   - FPL DEF seen as Midfielder by API → secondary DM
 *     e.g. a defender who plays as an emergency DM
 *
 * Within-category sub-positions (LW vs RW, CB vs RB, DM vs CM) cannot be inferred
 * from this data — the FPL sync's primary_position already handles that via overrides.
 */
function parsePositionsFromApi(
    playerStats: ApiPlayer['statistics'],
    fplPrimary: GranularPosition
): { primary: GranularPosition; secondary: GranularPosition[] } {
    const fplBroad = getBroadCategory(fplPrimary);
    const secondary: GranularPosition[] = [];

    for (const stat of playerStats) {
        if (!stat.games?.position) continue;
        const apiBroad = getApiBroadCategory(stat.games.position);
        if (!apiBroad || apiBroad === fplBroad) continue;

        // FPL-MID player that API sees as Attacker → genuinely plays in forward line
        if (fplBroad === 'MID' && apiBroad === 'FWD' && !secondary.includes('ST')) {
            secondary.push('ST');
        }
        // FPL-FWD player that API sees as Midfielder → drops into creative/wide role
        else if (fplBroad === 'FWD' && apiBroad === 'MID' && !secondary.includes('AM')) {
            secondary.push('AM');
        }
        // FPL-DEF player that API sees as Midfielder → inverted FB or emergency DM
        else if (fplBroad === 'DEF' && apiBroad === 'MID' && !secondary.includes('DM')) {
            secondary.push('DM');
        }
    }

    return { primary: fplPrimary, secondary };
}

export async function POST(req: NextRequest) {
    const secret = req.headers.get('x-cron-secret');
    if (secret !== process.env.CRON_SECRET && req.headers.get('host') !== 'localhost:3000' && !req.url.includes('localhost')) {
        // Allow localhost access for dev without secret
        if (process.env.NODE_ENV === 'production') {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }
    }

    const admin = createAdminClient();

    // 1. Fetch all players from our db to match against
    const { data: dbPlayers, error: fetchError } = await admin
        .from('players')
        .select('id, name, web_name, primary_position, pl_team, api_football_id')
        .eq('is_active', true);

    if (fetchError || !dbPlayers) {
        return NextResponse.json({ error: 'Failed to fetch existing players' }, { status: 500 });
    }

    // Store mapping for string similarity 
    const dbNormalizedNamesMap = new Map<string, any>();
    const dbNameList: string[] = [];

    for (const p of dbPlayers) {
        const normName = normalizeName(p.name);
        const normWebName = p.web_name ? normalizeName(p.web_name) : null;

        dbNormalizedNamesMap.set(normName, p);
        dbNameList.push(normName);

        if (normWebName && normWebName !== normName) {
            dbNormalizedNamesMap.set(normWebName, p);
            dbNameList.push(normWebName);
        }
    }

    let allApiPlayers: ApiPlayer[] = [];

    try {
        // 2. Fetch Teams first
        console.log(`Fetching API-Football teams...`);
        const teamsResult = await fetchPLTeams();
        await new Promise((resolve) => setTimeout(resolve, 6500)); // Respect 10/min rate limit

        const teamIds = teamsResult.map(t => t.team.id);
        console.log(`Found ${teamIds.length} teams. Fetching players per team...`);

        // 3. Fetch players per team to bypass the 3-page limit on free tier
        for (const teamId of teamIds) {
            let currentPage = 1;
            let continueFetching = true;

            while (continueFetching) {
                console.log(`Fetching API-Football players for team ${teamId}, page ${currentPage}...`);
                const result = await fetchPlayersByTeam(teamId, currentPage);

                if (!result || result.length === 0) {
                    continueFetching = false;
                } else {
                    allApiPlayers = allApiPlayers.concat(result);

                    if (result.length < 20) {
                        continueFetching = false;
                    } else {
                        currentPage++;
                    }
                }

                // Respect rate limit: pause for 6500ms between page requests (10/min)
                await new Promise((resolve) => setTimeout(resolve, 6500));

                // Safety break for team pages
                if (currentPage > 5) break;
            }
        }

        console.log(`Finished fetching. Total players: ${allApiPlayers.length}`);

        // 3. Match and Update
        let matchedCount = 0;
        const updates = [];

        for (const apiData of allApiPlayers) {
            const apiPlayer = apiData.player;
            const normApiFirst = normalizeName(apiPlayer.firstname);
            const normApiLast = normalizeName(apiPlayer.lastname);
            const normApiFull = normalizeName(apiPlayer.name);

            let bestMatchObj = null;

            // Try exact match on full name
            if (dbNormalizedNamesMap.has(normApiFull)) {
                bestMatchObj = dbNormalizedNamesMap.get(normApiFull);
            }
            // Try exact match on last name (sometimes web_name is just last name)
            else if (dbNormalizedNamesMap.has(normApiLast)) {
                bestMatchObj = dbNormalizedNamesMap.get(normApiLast);
            }
            // Try Subset Word Match for Brazilian names (solves Cunha, Bruno G, etc)
            else {
                const isShortApi = apiPlayer.name.split(' ').length === 1 && apiPlayer.name.length <= 5;
                if (!isShortApi) {
                    const subsetMatchDbName = dbNameList.find(dbName => {
                        const apiParts = normApiFull.split(/\s+/);
                        return apiParts.every(part => dbName.includes(part));
                    });
                    if (subsetMatchDbName) {
                        bestMatchObj = dbNormalizedNamesMap.get(subsetMatchDbName);
                    }
                }

                // Fuzzy match fallback
                if (!bestMatchObj) {
                    const { bestMatch } = stringSimilarity.findBestMatch(normApiFull, dbNameList);
                    if (bestMatch.rating > 0.8) {
                        bestMatchObj = dbNormalizedNamesMap.get(bestMatch.target);
                    }
                }
            }

            if (bestMatchObj) {
                matchedCount++;

                const dob = apiPlayer.birth.date;
                const heightCm = apiPlayer.height ? parseInt(apiPlayer.height.replace('cm', '').trim(), 10) : null;

                // NOTE: We intentionally do NOT update secondary_positions here.
                // API Football only reports 4 broad categories (GK/DEF/MID/FWD), which
                // is too coarse to infer granular secondary positions reliably.
                // FPL sync + manual overrides handle positions with much higher precision.
                const update: Record<string, unknown> = {
                    id: bestMatchObj.id,
                    api_football_id: apiPlayer.id,
                    date_of_birth: dob,
                    nationality: apiPlayer.nationality,
                    height_cm: heightCm || null,
                };

                updates.push(update);
            }
        }

        // 4. Batch update
        if (updates.length > 0) {
            // Supabase doesn't easily bulk-update different values per row in one call efficiently using the JS client without RPC.
            // We do it in chunks.
            const chunkSize = 50;
            for (let i = 0; i < updates.length; i += chunkSize) {
                const chunk = updates.slice(i, i + chunkSize);

                await Promise.all(
                    chunk.map((u) => {
                        const fields: Record<string, unknown> = {
                            api_football_id: u.api_football_id,
                            date_of_birth: u.date_of_birth,
                            nationality: u.nationality,
                            height_cm: u.height_cm,
                        };
                        if ('secondary_positions' in u) {
                            fields.secondary_positions = u.secondary_positions;
                        }
                        return admin.from('players').update(fields).eq('id', u.id);
                    })
                );
            }
        }

        return NextResponse.json({
            ok: true,
            fetched: allApiPlayers.length,
            matched: matchedCount,
            updated: updates.length
        });

    } catch (error: any) {
        console.error('API-Football sync error:', error);
        return NextResponse.json({ error: error.message }, { status: 500 });
    }
}
