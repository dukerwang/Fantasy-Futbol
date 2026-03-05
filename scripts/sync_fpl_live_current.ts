import { createClient } from '@supabase/supabase-js';
import { calculateMatchRating, mapFplLiveToRawStats } from '../src/lib/scoring/engine';
import type { GranularPosition, FplLivePlayerStats } from '../src/types';
import * as fs from 'fs';
import * as path from 'path';

const envPath = path.resolve(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, "utf8");
    for (const line of envContent.split("\n")) {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match) process.env[match[1].trim()] = match[2].trim().replace(/^['"]|['"]$/g, '');
    }
}

const FPL_BASE = 'https://fantasy.premierleague.com/api';
const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

async function syncGameweek(gameweek: number) {
    console.log(`Fetching GW ${gameweek}...`);
    const fplRes = await fetch(`${FPL_BASE}/event/${gameweek}/live/`, {
        headers: { 'User-Agent': 'FantasyFutbol/1.0' }
    });
    if (!fplRes.ok) {
        console.warn(`HTTP ${fplRes.status} for GW ${gameweek}. It might not exist yet.`);
        return false;
    }
    const fplData = await fplRes.json();
    const elements = (fplData.elements ?? []) as FplLivePlayerStats[];

    if (elements.length === 0) {
        console.log(`GW ${gameweek} has no elements. Ignoring.`);
        return false;
    }

    let saved = 0;
    for (let i = 0; i < elements.length; i += 50) {
        const chunk = elements.slice(i, i + 50);
        await Promise.all(
            chunk.map(async (el) => {
                if (el.stats.minutes === 0) return;
                const { data: dbPlayer } = await supabase
                    .from('players')
                    .select('id, primary_position')
                    .eq('fpl_id', el.id)
                    .single();
                if (!dbPlayer) return;

                const rawStats = mapFplLiveToRawStats(el.stats);
                const { rating, fantasyPoints } = calculateMatchRating(
                    rawStats,
                    dbPlayer.primary_position as GranularPosition,
                );

                const { error } = await supabase.from('player_stats').upsert(
                    {
                        player_id: dbPlayer.id,
                        match_id: gameweek * 1000 + el.id, // composite key
                        gameweek,
                        season: '2025-26', // Current season reference
                        stats: { ...rawStats, _source: 'fpl_live_backfill' },
                        fantasy_points: fantasyPoints,
                        match_rating: rating,
                    },
                    { onConflict: 'player_id,match_id' },
                );
                if (!error) saved++;
                else console.error(error);
            }),
        );
    }
    console.log(`GW ${gameweek}: Saved ${saved} player match logs.`);
    return true;
}

async function run() {
    console.log('Fetching current gameweek from bootstrap-static...');
    const bootRes = await fetch(`${FPL_BASE}/bootstrap-static/`, {
        headers: { 'User-Agent': 'FantasyFutbol/1.0' }
    });
    const bootData = await bootRes.json();
    const currentEvent = bootData.events.find((e: any) => e.is_current);
    const nextEvent = bootData.events.find((e: any) => e.is_next);

    let maxGw = 38;
    if (currentEvent) maxGw = currentEvent.id;
    else if (nextEvent) maxGw = Math.max(1, nextEvent.id - 1);

    console.log(`Identified current gameweek as GW ${maxGw}. Syncing GWs 28 through ${maxGw}...`);

    for (let gw = 28; gw <= maxGw; gw++) {
        const success = await syncGameweek(gw);
        if (!success) break;
    }

    console.log('Recalculating Total Points and Form cache natively...');
    const { error } = await supabase.rpc('update_player_fantasy_scores');
    if (error) {
        console.error('Failed to recalculate scores:', error);
    } else {
        console.log('Successfully recalculated all scores!');
    }
}

run();
