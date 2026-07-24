process.loadEnvFile('.env.local');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SOFIFA_POS_MAP = {
  GK: 'GK', SW: 'CB', RWB: 'RWB', RB: 'RB', RCB: 'CB', CB: 'CB', LCB: 'CB', LB: 'LB', LWB: 'LWB',
  RDM: 'DM', CDM: 'DM', LDM: 'DM', RM: 'RW', RCM: 'CM', CM: 'CM', LCM: 'CM', LM: 'LW', RAM: 'AM',
  CAM: 'AM', LAM: 'AM', RF: 'RW', CF: 'ST', LF: 'LW', RW: 'RW', RS: 'ST', ST: 'ST', LS: 'ST', LW: 'LW',
  DM: 'DM', AM: 'AM'
};

const delay = (ms) => new Promise(r => setTimeout(r, ms));

function normalize(name) {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/ø/g, 'o')
    .replace(/æ/g, 'ae')
    .replace(/ß/g, 'ss')
    .replace(/ı/g, 'i')
    .replace(/['"']/g, '')
    .replace(/-/g, ' ')
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

(async () => {
  console.log('=====================================================');
  console.log('   PLAYWRIGHT LIVE SOFIFA SEARCH FOR ALL UNMATCHED PLAYERS');
  console.log('=====================================================\n');

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, pl_team, primary_position, secondary_positions')
    .eq('is_active', true);

  console.log(`Loaded ${dbPlayers.length} total active players from Supabase DB.`);

  // Read existing scraped sofifa file
  const dataPath = path.join(__dirname, '..', 'scraped-sofifa.json');
  let sofifaTeams = [];
  if (fs.existsSync(dataPath)) {
    sofifaTeams = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));
  }

  const existingSofifaNames = new Set();
  sofifaTeams.forEach(t => {
    (t.players || []).forEach(p => {
      if (p.fullName) existingSofifaNames.add(normalize(p.fullName));
      if (p.commonName) existingSofifaNames.add(normalize(p.commonName));
    });
  });

  // Filter players missing from sofifaTeams
  const missingPlayers = dbPlayers.filter(p => {
    const fnNorm = normalize(p.name);
    const wnNorm = normalize(p.web_name);
    return !existingSofifaNames.has(fnNorm) && !existingSofifaNames.has(wnNorm);
  });

  console.log(`Found ${missingPlayers.length} active players requiring live SoFIFA search.\n`);

  if (missingPlayers.length === 0) {
    console.log('All active players are already matched to SoFIFA! Exiting.');
    return;
  }

  // Launch Playwright in persistent headful context
  const context = await chromium.launchPersistentContext('./playwright-profile', {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    console.log('Establishing session on sofifa.com...');
    await page.goto('https://sofifa.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000);

    let updatedCount = 0;
    let notFoundCount = 0;

    for (let i = 0; i < missingPlayers.length; i++) {
      const p = missingPlayers[i];
      const query = p.web_name && p.web_name.length >= 3 ? p.web_name : p.name;
      console.log(`[${i + 1}/${missingPlayers.length}] Live searching SoFIFA for "${query}" (${p.name} - ${p.pl_team})...`);

      try {
        await page.goto(`https://sofifa.com/players?keyword=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await delay(1000);

        const cardData = await page.evaluate(() => {
          const rows = Array.from(document.querySelectorAll('table tbody tr'));
          for (const r of rows) {
            const a = r.querySelector('a[href^="/player/"]');
            if (!a) continue;
            const name = a.innerText.trim();
            const posEls = Array.from(r.querySelectorAll('span.pos'));
            const positions = posEls.map(el => el.innerText.trim()).filter(p => !['SUB', 'RES'].includes(p));
            if (name && positions.length > 0) {
              return { name, positions };
            }
          }
          return null;
        });

        if (cardData && cardData.positions.length > 0) {
          const primaryRaw = cardData.positions[0];
          const primaryPos = SOFIFA_POS_MAP[primaryRaw] || p.primary_position;
          const secondaries = cardData.positions.slice(1).map(r => SOFIFA_POS_MAP[r]).filter(pos => pos && pos !== primaryPos);
          const cleanSecondaries = Array.from(new Set(secondaries));

          console.log(`  ✅ Matched SoFIFA Card: "${cardData.name}" [Raw: ${cardData.positions.join(', ')} -> Gaffa: Primary ${primaryPos}, Secondary ${JSON.stringify(cleanSecondaries)}]`);

          await supabase
            .from('players')
            .update({
              primary_position: primaryPos,
              secondary_positions: cleanSecondaries
            })
            .eq('id', p.id);

          updatedCount++;
        } else {
          console.log(`  -> No EA FC card on SoFIFA for "${query}" (Youth/Academy player).`);
          notFoundCount++;
        }
      } catch (err) {
        console.log(`  ⚠️ Search timeout/error for ${query}: ${err.message}`);
      }
    }

    console.log(`\n=====================================================`);
    console.log(`   LIVE SOFIFA PLAYER SEARCH COMPLETE`);
    console.log(`=====================================================`);
    console.log(`Updated ${updatedCount} players with live SoFIFA cards.`);
    console.log(`Unmatched / Youth Reserves: ${notFoundCount}`);
  } catch (err) {
    console.error('Scraper error:', err.message);
  } finally {
    await context.close();
  }
})();
