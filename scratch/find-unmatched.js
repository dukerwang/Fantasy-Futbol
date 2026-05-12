const fs = require('fs');
const stringSimilarity = require('string-similarity');

// Helper to normalize names exactly like the sync route
function normalizeName(name) {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .trim();
}

(async () => {
  // Load SoFIFA data
  const sofifaData = JSON.parse(fs.readFileSync('scraped-sofifa.json', 'utf8'));
  const allSofifaPlayers = sofifaData.flatMap(t => t.players);

  // Load DB players
  const dbPlayers = JSON.parse(fs.readFileSync('scratch/db-players.json', 'utf8'));

  // Prepare SoFIFA names for matching
  const sofifaNames = [];
  const sofifaMap = new Map();

  for (const sp of allSofifaPlayers) {
    const normFull = normalizeName(sp.fullName);
    const normCommon = normalizeName(sp.commonName);
    
    if (normFull) {
        sofifaNames.push(normFull);
        sofifaMap.set(normFull, sp);
    }
    if (normCommon && normCommon !== normFull) {
        sofifaNames.push(normCommon);
        sofifaMap.set(normCommon, sp);
    }
  }

  const unmatched = [];

  for (const dbp of dbPlayers) {
    const normName = normalizeName(dbp.name);
    const normWebName = normalizeName(dbp.web_name);

    let found = false;

    // Direct check
    if (sofifaMap.has(normName) || sofifaMap.has(normWebName)) {
      found = true;
    } else {
      // Fuzzy check
      for (const candidate of [normName, normWebName].filter(Boolean)) {
        const { bestMatch } = stringSimilarity.findBestMatch(candidate, sofifaNames);
        if (bestMatch.rating > 0.82) {
          found = true;
          break;
        }
      }
    }

    if (!found) {
      unmatched.push(dbp);
    }
  }

  console.log(JSON.stringify(unmatched, null, 2));
})();
