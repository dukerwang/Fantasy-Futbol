/**
 * Targeted SoFIFA live player-search for the specific stray unmatched players
 * (outside the 3 promoted clubs, which scrape_championship_sofifa.js already
 * handled). Only touches the exact names listed below — avoids rescanning the
 * whole roster and clobbering anyone whose empty secondary_positions is
 * legitimate (e.g. a keeper).
 */
process.loadEnvFile('.env.local');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const SOFIFA_POS_MAP = {
  GK: 'GK', SW: 'CB', RWB: 'RWB', RB: 'RB', RCB: 'CB', CB: 'CB', LCB: 'CB', LB: 'LB', LWB: 'LWB',
  RDM: 'DM', CDM: 'DM', LDM: 'DM', RM: 'RW', RCM: 'CM', CM: 'CM', LCM: 'CM', LM: 'LW', RAM: 'AM',
  CAM: 'AM', LAM: 'AM', RF: 'RW', CF: 'ST', LF: 'LW', RW: 'RW', RS: 'ST', ST: 'ST', LS: 'ST', LW: 'LW',
  DM: 'DM', AM: 'AM'
};

const TARGET_NAMES = [
  'Christian Nørgaard', 'Christos Tzolis', 'Martin Ødegaard', 'Max Dowman',
  'Johan Manzambi',
  'Álvaro Rodríguez', 'Junior Kroupi',
  'Jannik Schuster',
  'Mitoma Kaoru', 'Michael Svoboda', 'Zadok Yohanna', 'Pascal Groß',
  'Geovany Quenda', 'Emmanuel Emegha', 'Marco Palestra',
  'Oscar Mingueza', 'Joél Drakes-Thomas', 'Matheus França de Oliveira', 'Jørgen Strand Larsen',
  'Hayden Hackney', 'Vitalii Mykolenko',
  'Alfie McNally',
  'Tarik Muharemović', 'Tanaka Ao',
  'Victor Munoz', 'Jayden Danns', 'Endo Wataru', 'Wellity Lucky', 'Jeremy Jacquet',
  "Rodrigo 'Rodri' Hernandez Cascante", 'Jeremy Monga',
  'Altay Bayındır',
  'Ewen Jaouen', 'Bazoumana Touré', 'Sean Steur', 'Aladji Bamba',
  'Xaver Schlager',
  'Thomas Meunier',
];

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  console.log(`--- Targeted SoFIFA search for ${TARGET_NAMES.length} stray unmatched players ---`);

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, pl_team, primary_position, secondary_positions')
    .eq('is_active', true);

  const targets = dbPlayers.filter(p => TARGET_NAMES.includes(p.name));
  console.log(`Resolved ${targets.length}/${TARGET_NAMES.length} target names to DB rows.\n`);
  const missing = TARGET_NAMES.filter(n => !targets.some(p => p.name === n));
  if (missing.length) console.log('Not found in DB (name mismatch?):', missing);

  const context = await chromium.launchPersistentContext('./playwright-profile', {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    console.log('Establishing session on sofifa.com...');
    await page.goto('https://sofifa.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000);

    let updatedCount = 0;
    let notFoundCount = 0;

    for (let i = 0; i < targets.length; i++) {
      const p = targets[i];
      const query = p.web_name || p.name;
      console.log(`[${i + 1}/${targets.length}] Searching SoFIFA live for "${query}" (${p.name} - ${p.pl_team})...`);

      try {
        await page.goto(`https://sofifa.com/players?keyword=${encodeURIComponent(query)}`, { waitUntil: 'domcontentloaded', timeout: 15000 });
        await delay(1200);

        const cardData = await page.evaluate(() => {
          const firstRow = document.querySelector('table tbody tr');
          if (!firstRow) return null;
          const a = firstRow.querySelector('a[href^="/player/"]');
          if (!a) return null;
          const name = a.innerText.trim();
          const posEls = Array.from(firstRow.querySelectorAll('span.pos'));
          const positions = posEls.map(el => el.innerText.trim());
          return { name, positions };
        });

        if (cardData && cardData.positions.length > 0) {
          const primaryRaw = cardData.positions[0];
          const primaryPos = SOFIFA_POS_MAP[primaryRaw] || p.primary_position;
          const secondaries = cardData.positions.slice(1).map(r => SOFIFA_POS_MAP[r]).filter(pos => pos && pos !== primaryPos);

          console.log(`  -> Matched SoFIFA Card: "${cardData.name}" [Raw: ${cardData.positions.join(', ')} -> Gaffa: ${primaryPos} ${JSON.stringify(secondaries)}]`);

          await supabase
            .from('players')
            .update({
              primary_position: primaryPos,
              secondary_positions: Array.from(new Set(secondaries))
            })
            .eq('id', p.id);

          updatedCount++;
        } else {
          console.log(`  -> No SoFIFA card found for "${query}".`);
          notFoundCount++;
        }
      } catch (err) {
        console.log(`  ⚠️ Search error for ${query}: ${err.message}`);
      }
      await delay(500);
    }

    console.log(`\n✅ Finished. Updated ${updatedCount}/${targets.length}. Not found: ${notFoundCount}.`);
  } catch (err) {
    console.error('Playwright execution error:', err.message);
  } finally {
    await context.close();
  }
})();
