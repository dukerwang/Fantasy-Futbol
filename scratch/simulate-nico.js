const fs = require('fs');
const stringSimilarity = require('string-similarity');

const dbPlayers = JSON.parse(fs.readFileSync('scratch/db-players.json', 'utf8'));
const scraped = JSON.parse(fs.readFileSync('scraped-sofifa.json', 'utf8'));

// Standard normalizeName
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

// Find Nico O'Reilly in scraped data
let foundScraped = null;
for (const team of scraped) {
  for (const sp of team.players ?? []) {
    if (sp.fullName?.toLowerCase().includes('oreilly') || sp.commonName?.toLowerCase().includes('oreilly')) {
      foundScraped = sp;
      console.log('Found in scraped:', sp);
    }
  }
}

if (foundScraped) {
  const sp = foundScraped;
  const fullName = sp.fullName || [sp.firstName, sp.lastName].filter(Boolean).join(' ');
  const common = sp.commonName || '';
  const normFull = normalizeName(fullName);
  const normCommon = normalizeName(common);

  const candidates = Array.from(new Set([
    normFull, normCommon,
    firstLast(normFull), firstLast(normCommon),
  ])).filter(Boolean);

  console.log('Candidates for matching:', candidates);

  let dbMatch = null;
  for (const c of candidates) {
    dbMatch = nameMap.get(c) ?? null;
    if (dbMatch) {
      console.log(`Matched directly via candidate "${c}" to:`, dbMatch.name);
      break;
    }
  }

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

  if (!dbMatch && MANUAL_OVERRIDES[fullName]) {
    dbMatch = nameMap.get(normalizeName(MANUAL_OVERRIDES[fullName])) ?? null;
    if (dbMatch) console.log('Matched via MANUAL_OVERRIDES[fullName] to:', dbMatch.name);
  }

  if (!dbMatch && common && MANUAL_OVERRIDES[common]) {
    dbMatch = nameMap.get(normalizeName(MANUAL_OVERRIDES[common])) ?? null;
    if (dbMatch) console.log('Matched via MANUAL_OVERRIDES[common] to:', dbMatch.name);
  }

  if (!dbMatch) {
    for (const candidate of candidates) {
      if (nameList.length === 0) continue;
      const { bestMatch } = stringSimilarity.findBestMatch(candidate, nameList);
      if (bestMatch.rating > 0.82) {
        dbMatch = nameMap.get(bestMatch.target) ?? null;
        console.log(`Matched via fuzzy match "${candidate}" -> "${bestMatch.target}" to:`, dbMatch?.name, 'rating:', bestMatch.rating);
        break;
      }
    }
  }
}
