const fs = require('fs');
const stringSimilarity = require('string-similarity');

const dbPlayers = JSON.parse(fs.readFileSync('scratch/db-players.json', 'utf8'));
const scraped = JSON.parse(fs.readFileSync('scraped-sofifa.json', 'utf8'));

function normalizeName(name) {
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

function firstLast(name) {
  const parts = name.split(' ').filter(Boolean);
  if (parts.length <= 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

const nameMap = new Map();
const nameList = [];

function addToMap(key, player) {
  if (!key) return;
  if (!nameMap.has(key)) {
    nameMap.set(key, player);
    nameList.push(key);
  }
}

for (const p of dbPlayers) {
  const normFull = normalizeName(p.name);
  const normWeb = p.web_name ? normalizeName(p.web_name) : null;
  addToMap(normFull, p);
  addToMap(normWeb, p);
  addToMap(firstLast(normFull), p);
  if (normWeb) addToMap(firstLast(normWeb), p);
}

const dbPlayerUpdates = {};

const MANUAL_OVERRIDES = {
  'Louis Jordan Beyer': 'Jordan Beyer',
  'Toluwalase Emmanuel Arokodare': 'Tolu Arokodare',
  'Alejandro Jiménez Sánchez': 'Álex Jiménez Sánchez',
  'Tóth Alex László': 'Alex Tóth',
  'Xavier Quentin Shay Simons': 'Xavi Simons',
  'Valentín Mariano José Castellanos Giménez': 'Valentín Castellanos',
  'Abdul-Nasir Oluwatosin Oluwadoyinsolami Adarabioyo': 'Tosin Adarabioyo',
  'Eli Junior Eric Anat Kroupi': 'Junior Kroupi',
  'Adilson Angel Abreu de Almeida Gomés': 'Angel Gomes',
  'James William McConnell': 'James McConnell',
  'Lewis William Orford': 'Lewis Orford'
};

for (const team of scraped) {
  for (const sp of team.players ?? []) {
    const fullName = sp.fullName || [sp.firstName, sp.lastName].filter(Boolean).join(' ');
    const common = sp.commonName || '';
    const normFull = normalizeName(fullName);
    const normCommon = normalizeName(common);

    const candidates = Array.from(new Set([
      normFull, normCommon,
      firstLast(normFull), firstLast(normCommon),
    ])).filter(Boolean);

    let dbMatch = null;
    let matchMethod = '';

    for (const c of candidates) {
      dbMatch = nameMap.get(c) ?? null;
      if (dbMatch) {
        matchMethod = `direct: ${c}`;
        break;
      }
    }

    if (!dbMatch && MANUAL_OVERRIDES[fullName]) {
      dbMatch = nameMap.get(normalizeName(MANUAL_OVERRIDES[fullName])) ?? null;
      if (dbMatch) matchMethod = `manual_full: ${MANUAL_OVERRIDES[fullName]}`;
    }

    if (!dbMatch && common && MANUAL_OVERRIDES[common]) {
      dbMatch = nameMap.get(normalizeName(MANUAL_OVERRIDES[common])) ?? null;
      if (dbMatch) matchMethod = `manual_common: ${MANUAL_OVERRIDES[common]}`;
    }

    if (!dbMatch) {
      for (const candidate of candidates) {
        if (nameList.length === 0) continue;
        const { bestMatch } = stringSimilarity.findBestMatch(candidate, nameList);
        if (bestMatch.rating > 0.82) {
          dbMatch = nameMap.get(bestMatch.target) ?? null;
          matchMethod = `fuzzy: ${candidate} -> ${bestMatch.target} (${bestMatch.rating.toFixed(3)})`;
          break;
        }
      }
    }

    if (dbMatch) {
      const dbKey = `${dbMatch.name} | ${dbMatch.pl_team}`;
      if (!dbPlayerUpdates[dbKey]) {
        dbPlayerUpdates[dbKey] = [];
      }
      dbPlayerUpdates[dbKey].push({
        scrapedId: sp.id,
        scrapedName: fullName,
        scrapedCommon: common,
        positions: sp.positions,
        matchMethod
      });
    }
  }
}

let out = '--- DUPLICATE MATCHES REPORT ---\n';
let count = 0;
for (const [dbKey, matchedList] of Object.entries(dbPlayerUpdates)) {
  if (matchedList.length > 1) {
    count++;
    out += `\n[${count}] DB Player Key: ${dbKey}\n`;
    matchedList.forEach(m => {
      out += `  -> Scraped: ${m.scrapedName} (Common: ${m.scrapedCommon}) | Positions: ${m.positions.join(', ')} | Method: ${m.matchMethod}\n`;
    });
  }
}
out += `\nTotal duplicate DB players: ${count}\n`;

fs.writeFileSync('scratch/duplicate-matches.txt', out, 'utf8');
console.log(`Saved duplicate report to scratch/duplicate-matches.txt. Total: ${count}`);
