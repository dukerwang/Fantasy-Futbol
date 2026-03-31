const fs = require('fs');
const https = require('https');
const stringSimilarity = require('string-similarity');

const SEASONS = ['2023-24', '2024-25', '2025-26'];
const SOFIFA_FILE = './sofifa_positions_history.json';
const OUTPUT_FILE = './computed_reference_stats.json';

let sofifaPlayers = [];
if (fs.existsSync(SOFIFA_FILE)) {
    sofifaPlayers = JSON.parse(fs.readFileSync(SOFIFA_FILE, 'utf8'));
} else if (fs.existsSync('./sofifa_positions.json')) {
    console.log("Using fallback sofifa_positions.json for mappings...");
    sofifaPlayers = JSON.parse(fs.readFileSync('./sofifa_positions.json', 'utf8'));
    sofifaPlayers.forEach(p => p.season = 'fallback');
}

const seasonNameMaps = {};
SEASONS.forEach(s => seasonNameMaps[s] = { map: new Map(), list: [] });
seasonNameMaps['fallback'] = { map: new Map(), list: [] };

function normalizeName(name) {
    if (!name) return '';
    return name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
}

function firstLast(name) {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length <= 2) return name;
    return `${parts[0]} ${parts[parts.length - 1]}`;
}

sofifaPlayers.forEach(sp => {
    if (!sp.positions || sp.positions.length === 0) return;
    const sMap = seasonNameMaps[sp.season] || seasonNameMaps['fallback'];
    
    const candidates = [
        normalizeName(sp.full_name),
        normalizeName(sp.short_name),
        firstLast(normalizeName(sp.full_name)),
        firstLast(normalizeName(sp.short_name))
    ].filter(Boolean);
    
    candidates.forEach(c => {
        if (!sMap.map.has(c)) {
            sMap.map.set(c, sp.positions);
            sMap.list.push(c);
        }
    });
});

function matchPlayerPosition(name, season) {
    const norm = normalizeName(name);
    const fl = firstLast(norm);
    
    const sMap = seasonNameMaps[season].list.length > 0 ? seasonNameMaps[season] : seasonNameMaps['fallback'];
    
    if (sMap.map.has(norm)) return sMap.map.get(norm)[0];
    if (sMap.map.has(fl)) return sMap.map.get(fl)[0];
    
    if (sMap.list.length > 0) {
        let best = stringSimilarity.findBestMatch(norm, sMap.list).bestMatch;
        if (best.rating > 0.82) return sMap.map.get(best.target)[0];
        
        let bestFL = stringSimilarity.findBestMatch(fl, sMap.list).bestMatch;
        if (bestFL.rating > 0.82) return sMap.map.get(bestFL.target)[0];
    }
    
    return null;
}

function downloadCSV(url) {
    return new Promise((resolve, reject) => {
        https.get(url, (res) => {
            if (res.statusCode === 404) {
               console.log(`404 Not Found: ${url}`);
               return resolve('');
            }
            if (res.statusCode !== 200) return reject(new Error(`Failed to GET ${url} (${res.statusCode})`));
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve(data));
        }).on('error', reject);
    });
}

const GRANULAR_POSITIONS = ['GK', 'CB', 'LB', 'RB', 'DM', 'CM', 'LM', 'RM', 'AM', 'LW', 'RW', 'ST'];
const POS_MAP_FPL = { 'GK': 'GK', 'DEF': 'CB', 'MID': 'CM', 'FWD': 'ST', 'GKP': 'GK' };

const statsPool = {};
GRANULAR_POSITIONS.forEach(p => statsPool[p] = []);

async function main() {
    for (const season of SEASONS) {
        console.log(`Fetching FPL Data for ${season}...`);
        const url = `https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data/${season}/gws/merged_gw.csv`;
        const csv = await downloadCSV(url);
        if (!csv) continue;

        const lines = csv.split('\n');
        const headers = lines[0].split(',').map(h => h.trim().replace(/\r/g, ''));
        
        const idx = {};
        ['name', 'position', 'minutes', 'bps', 'influence', 'creativity', 'threat', 'goals_scored', 'assists', 'expected_goals', 'expected_assists', 'saves'].forEach(k => {
            idx[k] = headers.indexOf(k);
        });

        const hasXG = idx['expected_goals'] !== -1;

        let rowsProcessed = 0;
        for (let i = 1; i < lines.length; i++) {
            if (!lines[i].trim()) continue;
            const row = lines[i].match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || lines[i].split(',');
            if (row.length < headers.length - 2) continue;
            
            const getVal = (x) => {
                let v = row[x];
                if (v && v.startsWith('"')) v = v.slice(1, -1);
                return v;
            };

            const minutes = parseInt(getVal(idx['minutes'])) || 0;
            if (minutes < 45) continue;

            let playerName = getVal(idx['name']) || '';
            playerName = playerName.split('_')[0]; 
            const fplPos = getVal(idx['position']);
            
            let granularPos = matchPlayerPosition(playerName, season);
            
            const LEGACY = { 
                "SW": "CB", "RWB": "RB", "RCB": "CB", "LCB": "CB", "LWB": "LB",
                "RDM": "DM", "CDM": "DM", "LDM": "DM", "RCM": "CM", "LCM": "CM",
                "RAM": "AM", "CAM": "AM", "LAM": "AM", "RF": "RW", "CF": "ST",
                "LF": "LW", "RS": "ST", "LS": "ST", "GKP": "GK"
            };
            if (granularPos && LEGACY[granularPos]) granularPos = LEGACY[granularPos];

            if (!granularPos || !GRANULAR_POSITIONS.includes(granularPos)) {
                granularPos = POS_MAP_FPL[fplPos] || 'CM';
            }

            const bps = parseFloat(getVal(idx['bps'])) || 0;
            const influence = parseFloat(getVal(idx['influence'])) || 0;
            const creativity = parseFloat(getVal(idx['creativity'])) || 0;
            const threat = parseFloat(getVal(idx['threat'])) || 0;
            const goals = parseInt(getVal(idx['goals_scored'])) || 0;
            const assists = parseInt(getVal(idx['assists'])) || 0;
            const xG = hasXG ? parseFloat(getVal(idx['expected_goals'])) || 0 : 0;
            const xA = hasXG ? parseFloat(getVal(idx['expected_assists'])) || 0 : 0;
            const saves = parseFloat(getVal(idx['saves'])) || 0;

            const goal_inv = goals * 6 + assists * 4;
            let finishing = 0;
            // Only apply finishing math if expected goals exists in this season dataset
            if (hasXG) {
               finishing = (goals - xG) * 0.3 + (assists - xA) * 0.15;
            }

            statsPool[granularPos].push({
                match_impact: Math.max(0, bps - (goals * 12 + assists * 9)),
                influence,
                creativity,
                threat,
                defensive: 0,
                goal_involvement: goal_inv,
                finishing,
                save_score: saves * 2
            });
            rowsProcessed++;
        }
        console.log(`Processed ${rowsProcessed} qualified >45m match appearances for ${season}.`);
    }

    console.log("\n--- Computing Results ---");
    function computeStat(values) {
        if (!values || values.length === 0) return { median: 0, stddev: 1 };
        values.sort((a, b) => a - b);
        const mid = Math.floor(values.length / 2);
        const median = values.length % 2 !== 0 ? values[mid] : (values[mid - 1] + values[mid]) / 2;
        
        const mean = values.reduce((sum, val) => sum + val, 0) / values.length;
        const squareDiffs = values.map(val => Math.pow(val - mean, 2));
        const variance = squareDiffs.reduce((sum, val) => sum + val, 0) / values.length;
        let stddev = Math.sqrt(variance);
        if (stddev < 0.1) stddev = 1.0;

        return { median: Number(median.toFixed(2)), stddev: Number(stddev.toFixed(2)) };
    }

    const finalConfig = {};
    for (const p of Object.keys(statsPool)) {
        const pool = statsPool[p];
        finalConfig[p] = {
            match_impact: computeStat(pool.map(v => v.match_impact)),
            influence: computeStat(pool.map(v => v.influence)),
            creativity: computeStat(pool.map(v => v.creativity)),
            threat: computeStat(pool.map(v => v.threat)),
            defensive: { median: 0.2, stddev: 2.8 },
            goal_involvement: computeStat(pool.map(v => v.goal_involvement)),
            finishing: computeStat(pool.map(v => v.finishing)),
            save_score: computeStat(pool.map(v => v.save_score)),
        };
    }

    const outputTS = `
// Generated by compute_fpl_reference_stats.js (>45m filter, Seasons: 23-24, 24-25, 25-26)
export const DEFAULT_REFERENCE_STATS: Record<GranularPosition, ReferenceStats> = {
`;
    let tsRows = '';
    for (const p of GRANULAR_POSITIONS) {
        const c = finalConfig[p];
        tsRows += `    ${p}: makeRef([${c.match_impact.median}, ${c.match_impact.stddev}], [${c.influence.median}, ${c.influence.stddev}], [${c.creativity.median}, ${c.creativity.stddev}], [${c.threat.median}, ${c.threat.stddev}], [${c.defensive.median}, ${c.defensive.stddev}], [0, 1], [${c.goal_involvement.median}, ${c.goal_involvement.stddev}], [${c.finishing.median}, ${c.finishing.stddev}], [${c.save_score.median}, ${c.save_score.stddev}]),\n`;
    }

    console.log(outputTS + tsRows + "};\n");
    fs.writeFileSync(OUTPUT_FILE, JSON.stringify(finalConfig, null, 2));
}

main().catch(console.error);
