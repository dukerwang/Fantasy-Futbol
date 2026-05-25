const fs = require('fs');

function normalizeName(name) {
  return name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z\s]/g, "").toLowerCase().trim();
}

function firstLast(name) {
  const parts = name.split(/\s+/);
  if (parts.length <= 2) return name;
  return `${parts[0]} ${parts[parts.length - 1]}`;
}

const dbPlayers = [
  {
    id: "8f3d944e-3bb6-4882-9055-875f5c32a168",
    name: "Nico O'Reilly",
    web_name: "O'Reilly",
    primary_position: "RW",
    secondary_positions: ["AM"]
  }
];

const POS_MAP = {
  'GK': 'GK',
  'CB': 'CB',
  'LCB': 'CB',
  'RCB': 'CB',
  'LB': 'LB',
  'LWB': 'LWB',
  'RB': 'RB',
  'RWB': 'RWB',
  'DM': 'DM',
  'LDM': 'DM',
  'RDM': 'DM',
  'CM': 'CM',
  'LCM': 'CM',
  'RCM': 'CM',
  'LM': 'LM',
  'RM': 'RM',
  'AM': 'AM',
  'LAM': 'AM',
  'RAM': 'AM',
  'LW': 'LW',
  'RW': 'RW',
  'LF': 'LW',
  'RF': 'RW',
  'CF': 'ST',
  'ST': 'ST',
  'LS': 'ST',
  'RS': 'ST'
};

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

console.log("nameMap keys:", Array.from(nameMap.keys()));

const scraped = JSON.parse(fs.readFileSync('/Users/dukewang/Fantasy Futbol/scraped-sofifa.json', 'utf8'));

for (const t of scraped) {
  for (const sp of t.players || []) {
    if (sp.commonName === "N. O'Reilly") {
      console.log("\nFound Nico in scraped data:", sp);
      
      const positionsRaw = [...sp.positions];
      const sofifaPrimaryRaw = positionsRaw[0];
      
      console.log("positionsRaw:", positionsRaw);
      console.log("sofifaPrimaryRaw:", sofifaPrimaryRaw);

      const allRaw = new Set(positionsRaw);
      const hasLB = allRaw.has('LB') || allRaw.has('LWB');
      const hasLM = allRaw.has('LM');
      const hasLW = allRaw.has('LW') || allRaw.has('LF');
      const hasRB = allRaw.has('RB') || allRaw.has('RWB');
      const hasRM = allRaw.has('RM');
      const hasRW = allRaw.has('RW') || allRaw.has('RF');
      const hasBothMid = hasLM && hasRM;
      const hasOnlyOneFB = (hasLB && !hasRB) || (!hasLB && hasRB);

      const finalSet = new Set();
      let primary = POS_MAP[sofifaPrimaryRaw];

      const applySide = (
        side,
        hasFB,
        hasMid,
        hasWing
      ) => {
        const fb = `${side}B`;
        const wb = `${side}WB`;
        const wing = `${side}W`;
        const midRaw = `${side}M`;
        const fbRaw = `${side}B`;
        const wingRaw = `${side}W`;

        const pCat = sofifaPrimaryRaw === midRaw ? 'mid' : sofifaPrimaryRaw === wingRaw ? 'wing' : sofifaPrimaryRaw === fbRaw ? 'fb' : 'other';

        if (hasBothMid && hasOnlyOneFB) {
          if (hasMid) {
            finalSet.add(wing);
            if (pCat === 'mid' || pCat === 'wing') primary = wing;
          }
          if (hasFB) {
            finalSet.add(wb);
            if (pCat === 'fb') primary = wb;
          }
          return;
        }

        if (!hasFB || !hasMid) {
          if (hasMid) {
            finalSet.add(wing);
            if (pCat === 'mid') primary = wing;
          }
          if (hasWing) {
            finalSet.add(wing);
            if (pCat === 'wing') primary = wing;
          }
          if (hasFB) {
            finalSet.add(fb);
            if (pCat === 'fb') primary = fb;
          }
          return;
        }
      };

      applySide('L', hasLB, hasLM, hasLW);
      applySide('R', hasRB, hasRM, hasRW);

      for (const raw of positionsRaw) {
        const mapped = POS_MAP[raw];
        if (mapped && !['LB', 'RB', 'LW', 'RW', 'LWB', 'RWB', 'LM', 'RM', 'LF', 'RF'].includes(raw)) {
          finalSet.add(mapped);
        }
      }

      if (primary && !finalSet.has(primary)) {
        finalSet.add(primary);
      }

      const finalSecondary = Array.from(finalSet).filter(p => p !== primary);

      console.log("Calculated primary:", primary);
      console.log("Calculated secondary:", finalSecondary);

      // Match logic
      const fullName = sp.fullName || [sp.firstName, sp.lastName].filter(Boolean).join(' ');
      const common = sp.commonName || '';
      const normFull = normalizeName(fullName);
      const normCommon = normalizeName(common);

      const candidates = Array.from(new Set([
        normFull, normCommon,
        firstLast(normFull), firstLast(normCommon),
      ])).filter(Boolean);

      console.log("Candidates for matching:", candidates);

      let dbMatch = null;
      for (const c of candidates) {
        dbMatch = nameMap.get(c) ?? null;
        if (dbMatch) {
          console.log(`Matched candidate "${c}" directly to dbPlayer:`, dbMatch.name);
          break;
        }
      }
    }
  }
}
