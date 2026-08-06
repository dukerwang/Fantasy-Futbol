const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

if (fs.existsSync('.env.local')) {
  const envContent = fs.readFileSync('.env.local', 'utf8');
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;
    const equalsIdx = trimmed.indexOf('=');
    if (equalsIdx > 0) {
      const key = trimmed.substring(0, equalsIdx).trim();
      const val = trimmed.substring(equalsIdx + 1).trim();
      process.env[key] = val;
    }
  });
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

async function checkCorruptions() {
  const { data: dbPlayers, error } = await supabase.from('players').select('*');
  if (error) throw error;

  console.log(`Total players in DB: ${dbPlayers.length}`);

  // Fetch live FPL bootstrap
  const fplRes = await fetch('https://fantasy.premierleague.com/api/bootstrap-static/', {
    headers: { 'User-Agent': 'FantasyFutbol/1.0' }
  });
  const fplData = await fplRes.json();
  const fplMapByPhoto = new Map();
  const fplMapById = new Map();
  
  fplData.elements.forEach(el => {
    const photoCode = el.photo?.replace('.jpg', '');
    if (photoCode) fplMapByPhoto.set(photoCode, el);
    fplMapById.set(el.id, el);
  });

  const corruptions = [];

  for (const p of dbPlayers) {
    const issues = [];

    // Extract photo code
    const photoCode = p.photo_url?.match(/\/(\d+)\.png/)?.[1];
    const fplEl = photoCode ? fplMapByPhoto.get(photoCode) : (p.fpl_id ? fplMapById.get(p.fpl_id) : null);

    // 1. Position mismatches for known GKs or FPL position mismatches
    if (p.name.includes('Alisson') && p.primary_position !== 'GK') {
      issues.push(`Alisson has position ${p.primary_position} (should be GK)`);
    }
    if (p.name.includes('Ederson') && p.primary_position !== 'GK') {
      issues.push(`Ederson has position ${p.primary_position} (should be GK)`);
    }
    if (p.name.includes('Muñoz') || p.name.includes('Munoz')) {
      if (p.name.includes('Daniel') && (p.primary_position !== 'RB' && p.primary_position !== 'RWB')) {
        issues.push(`Daniel Muñoz has position ${p.primary_position} (should be RB/RWB)`);
      }
    }

    if (fplEl) {
      // Check element type vs primary position
      // 1: GK, 2: DEF, 3: MID, 4: FWD
      const fplPosGroup = fplEl.element_type;
      const dbPos = p.primary_position;
      
      const isGk = fplPosGroup === 1;
      const isDef = fplPosGroup === 2;
      const isMid = fplPosGroup === 3;
      const isFwd = fplPosGroup === 4;

      const dbIsGk = dbPos === 'GK';
      const dbIsDef = ['CB', 'RB', 'LB', 'RWB', 'LWB'].includes(dbPos);
      const dbIsMid = ['CM', 'DM', 'AM', 'RM', 'LM'].includes(dbPos);
      const dbIsFwd = ['ST', 'CF', 'RW', 'LW'].includes(dbPos);

      if (isGk && !dbIsGk) {
        issues.push(`FPL GK (${fplEl.first_name} ${fplEl.second_name}) marked as ${dbPos} in DB!`);
      } else if (isDef && !dbIsDef) {
        issues.push(`FPL DEF (${fplEl.first_name} ${fplEl.second_name}) marked as ${dbPos} in DB!`);
      } else if (isMid && !dbIsMid && !dbIsFwd) { // sometimes wingers are MID in FPL but LW/RW in Gaffa
        // check if FPL Midfielder is marked as DEF or GK
        if (dbIsGk || dbIsDef) {
          issues.push(`FPL MID (${fplEl.first_name} ${fplEl.second_name}) marked as ${dbPos} in DB!`);
        }
      } else if (isFwd && !dbIsFwd && !dbIsMid) {
        if (dbIsGk || dbIsDef) {
          issues.push(`FPL FWD (${fplEl.first_name} ${fplEl.second_name}) marked as ${dbPos} in DB!`);
        }
      }

      // Check web_name mismatch
      if (p.web_name && fplEl.web_name && p.web_name !== fplEl.web_name) {
        // Some web names are intentionally customized, but if Ederson has 'Cherki', that's wrong!
        if (p.name.includes('Ederson') || p.name.includes('Alisson') || p.name.includes('Muñoz')) {
          issues.push(`Web name mismatch: DB web_name='${p.web_name}' vs FPL web_name='${fplEl.web_name}'`);
        }
      }
    }

    if (issues.length > 0) {
      corruptions.push({
        id: p.id,
        name: p.name,
        web_name: p.web_name,
        pl_team: p.pl_team,
        primary_position: p.primary_position,
        sofifa_common_name: p.sofifa_common_name,
        issues
      });
    }
  }

  console.log(`\nFound ${corruptions.length} corrupted players:`);
  console.log(JSON.stringify(corruptions, null, 2));
}

checkCorruptions();
