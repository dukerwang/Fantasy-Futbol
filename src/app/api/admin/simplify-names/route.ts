import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import * as fs from 'fs';
import * as path from 'path';
import stringSimilarity from 'string-similarity';

export const maxDuration = 60;

const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
);

function normalizeMatchName(name: string) {
    return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
}

function wordsMatch(tmName: string, dbName: string) {
    const normTM = normalizeMatchName(tmName);
    const normDB = normalizeMatchName(dbName);
    const tmParts = normTM.split(/\s+/);
    return tmParts.every((part) => normDB.includes(part));
}

export async function GET(req: NextRequest) {
    const rawData = fs.readFileSync(path.join(process.cwd(), 'players.json'), 'utf-8');
    const tmPlayers = JSON.parse(rawData);

    const { data: dbPlayers, error } = await supabase
        .from('players')
        .select('id, name');

    if (error) return NextResponse.json({ error });

    const dbNames = dbPlayers.map(p => p.name);
    const updates = [];

    for (const tmPlayer of tmPlayers) {
        let matchTarget = null;
        const isShortTM = tmPlayer.player_name.split(' ').length === 1 && tmPlayer.player_name.length <= 5;
        const subsetMatchDbName = !isShortTM ? dbNames.find(dbName => wordsMatch(tmPlayer.player_name, dbName)) : null;

        if (subsetMatchDbName) {
            matchTarget = subsetMatchDbName;
        } else {
            const { bestMatch } = stringSimilarity.findBestMatch(tmPlayer.player_name, dbNames);
            if (bestMatch.rating > 0.82) {
                matchTarget = bestMatch.target;
            }
        }

        if (matchTarget) {
            const dbPlayer = dbPlayers.find(p => p.name === matchTarget)!;
            if (dbPlayer.name.length > tmPlayer.player_name.length + 5 || dbPlayer.name.split(' ').length > tmPlayer.player_name.split(' ').length) {
                updates.push({
                    id: dbPlayer.id,
                    old_name: dbPlayer.name,
                    new_name: tmPlayer.player_name
                });
            }
        }
    }

    let written = 0;
    for (const u of updates) {
        const { error: updErr } = await supabase.from('players').update({ name: u.new_name }).eq('id', u.id);
        if (!updErr) written++;
    }

    return NextResponse.json({ count: updates.length, written, updates });
}
