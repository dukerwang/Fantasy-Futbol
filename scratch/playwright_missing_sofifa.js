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

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  console.log('--- PLAYWRIGHT SOFIFA SCRAPER FOR NEW/INTERNATIONAL TRANSFERS ---');

  const { data: dbPlayers } = await supabase
    .from('players')
    .select('id, name, web_name, pl_team, primary_position, secondary_positions')
    .eq('is_active', true);

  // Focus on players whose positions might still be un-enriched default
  const targets = dbPlayers.filter(p => p.name.includes('Quenda') || p.web_name.includes('Quenda') || p.secondary_positions.length === 0);
  console.log(`Found ${targets.length} target players to check on SoFIFA.\n`);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  try {
    console.log('Establishing session on sofifa.com...');
    await page.goto('https://sofifa.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(2000);

    let updatedCount = 0;

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
        }
      } catch (err) {
        console.log(`  ⚠️ Search error for ${query}: ${err.message}`);
      }
    }

    console.log(`\n✅ Finished Playwright SoFIFA Search. Updated ${updatedCount} players.`);
  } catch (err) {
    console.error('Playwright execution error:', err.message);
  } finally {
    await browser.close();
  }
})();
