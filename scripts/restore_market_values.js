const fs = require('fs');
const path = require('path');
const stringSimilarity = require('string-similarity');

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function normalizeName(name) {
    return name
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, '')
        .trim();
}

function parseMarketValue(raw) {
    if (!raw || raw === '-') return null;
    let val = raw.replace('€', '').trim();
    let multiplier = 1;
    if (val.endsWith('m')) {
        multiplier = 1;
        val = val.slice(0, -1);
    } else if (val.endsWith('k')) {
        multiplier = 0.001;
        val = val.slice(0, -1);
    }
    const num = parseFloat(val);
    return isNaN(num) ? null : Number((num * multiplier).toFixed(1));
}

async function main() {
    if (!SUPABASE_URL || !SUPABASE_KEY) {
        console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment');
        process.exit(1);
    }

    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    const tmRaw = fs.readFileSync(path.join(__dirname, 'players.json'), 'utf-8');
    const tmPlayers = JSON.parse(tmRaw);
    console.log(`Loaded ${tmPlayers.length} players from players.json`);

    let offset = 0;
    const dbPlayers = [];
    while (true) {
        const { data, error } = await supabase
            .from('players')
            .select('id, name, web_name, market_value')
            .range(offset, offset + 999);
        if (error) throw error;
        if (data.length === 0) break;
        dbPlayers.push(...data);
        offset += 1000;
    }
    console.log(`Loaded ${dbPlayers.length} players from DB`);

    const nameMap = new Map();
    const nameList = [];
    for (const p of dbPlayers) {
        const norm = normalizeName(p.name);
        nameMap.set(norm, p);
        nameList.push(norm);
        if (p.web_name) {
            const normWeb = normalizeName(p.web_name);
            nameMap.set(normWeb, p);
            nameList.push(normWeb);
        }
    }

    const updates = [];
    let matched = 0;
    const unmatched = [];

    for (const tm of tmPlayers) {
        const normTM = normalizeName(tm.player_name);
        let dbMatch = nameMap.get(normTM);

        if (!dbMatch && nameList.length > 0) {
            const { bestMatch } = stringSimilarity.findBestMatch(normTM, nameList);
            if (bestMatch.rating > 0.82) {
                dbMatch = nameMap.get(bestMatch.target);
            }
        }

        if (dbMatch) {
            matched++;
            const val = parseMarketValue(tm.market_value_raw);
            if (val !== null) {
                updates.push({ id: dbMatch.id, market_value: val });
            }
        } else {
            unmatched.push(tm.player_name);
        }
    }

    console.log(`Matched: ${matched}, Unmatched: ${unmatched.length}`);

    if (updates.length === 0) {
        console.log('No updates to write.');
        return;
    }

    const CHUNK = 50;
    for (let i = 0; i < updates.length; i += CHUNK) {
        const chunk = updates.slice(i, i + CHUNK);
        await Promise.all(
            chunk.map(u =>
                supabase
                    .from('players')
                    .update({ market_value: u.market_value })
                    .eq('id', u.id)
            )
        );
        process.stdout.write(`\rUpdated ${Math.min(i + CHUNK, updates.length)}/${updates.length}...`);
    }

    console.log(`\nDone — restored market values for ${updates.length} players.`);
}

main().catch(err => { console.error(err); process.exit(1); });
