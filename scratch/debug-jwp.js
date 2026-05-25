const stringSimilarity = require('string-similarity');

const s1 = 'james ward prowse';
const s2 = 'james wardprowse';
const r1 = stringSimilarity.compareTwoStrings(s1, s2);
console.log(`Compare "${s1}" and "${s2}": ${r1}`);

// Let's see what candidates and nameList had for James Ward Prowse
const fs = require('fs');
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
  if (p.name.includes('Ward-Prowse')) {
    console.log('DB player found:', p);
    const normFull = normalizeName(p.name);
    const normWeb = p.web_name ? normalizeName(p.web_name) : null;
    console.log('normFull:', normFull);
    console.log('normWeb:', normWeb);
    console.log('firstLast(normFull):', firstLast(normFull));
  }
  const normFull = normalizeName(p.name);
  const normWeb = p.web_name ? normalizeName(p.web_name) : null;
  addToMap(normFull, p);
  addToMap(normWeb, p);
  addToMap(firstLast(normFull), p);
  if (normWeb) addToMap(firstLast(normWeb), p);
}

// Find James Ward Prowse in scraped data
for (const team of scraped) {
  for (const sp of team.players ?? []) {
    const fullName = sp.fullName || [sp.firstName, sp.lastName].filter(Boolean).join(' ');
    if (fullName.includes('Ward Prowse') || fullName.includes('Ward-Prowse')) {
      console.log('Scraped player found:', sp);
      const common = sp.commonName || '';
      const normFull = normalizeName(fullName);
      const normCommon = normalizeName(common);
      console.log('normFull:', normFull);
      console.log('normCommon:', normCommon);
      const candidates = Array.from(new Set([
        normFull, normCommon,
        firstLast(normFull), firstLast(normCommon),
      ])).filter(Boolean);
      console.log('Candidates:', candidates);
      candidates.forEach(c => {
        const { bestMatch } = stringSimilarity.findBestMatch(c, nameList);
        console.log(`Candidate "${c}" best match: "${bestMatch.target}" with rating ${bestMatch.rating}`);
      });
    }
  }
}
