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
  console.log('   SCRAPING EFL CHAMPIONSHIP (LG=14) ON SOFIFA');
  console.log('=====================================================\n');

  const context = await chromium.launchPersistentContext('./playwright-profile', {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    console.log('Navigating to SoFIFA Championship Teams (lg=14)...');
    await page.goto('https://sofifa.com/teams?lg=14', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(3000);

    const teamLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href^="/team/"]'));
      const seen = new Set();
      const result = [];
      links.forEach(a => {
        const href = a.getAttribute('href');
        const name = a.innerText.trim();
        if (href && name && !seen.has(href)) {
          seen.add(href);
          result.push({ name, href: 'https://sofifa.com' + href });
        }
      });
      return result;
    });

    console.log(`Found ${teamLinks.length} teams in League 14:`, teamLinks.map(t => t.name));

    const scrapedPlayers = [];

    for (let i = 0; i < teamLinks.length; i++) {
      const t = teamLinks[i];
      console.log(`\n[${i + 1}/${teamLinks.length}] Scraping roster for ${t.name}...`);
      await page.goto(t.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await delay(2000);

      const roster = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        return rows.map(r => {
          const a = r.querySelector('a[href^="/player/"]');
          const posEls = Array.from(r.querySelectorAll('span.pos'));
          return {
            name: a ? a.innerText.trim() : null,
            positions: posEls.map(el => el.innerText.trim()).filter(p => !['SUB', 'RES'].includes(p))
          };
        }).filter(p => p.name && p.positions.length > 0);
      });

      console.log(`  -> Scraped ${roster.length} players from ${t.name}.`);
      scrapedPlayers.push(...roster);
    }

    console.log(`\nExtracted ${scrapedPlayers.length} total players from Championship teams on SoFIFA.`);

    const { data: dbPlayers } = await supabase
      .from('players')
      .select('id, name, web_name, pl_team, primary_position, secondary_positions')
      .eq('is_active', true);

    let matched = 0;
    const updates = [];

    for (const dbP of dbPlayers) {
      const fnNorm = normalize(dbP.name);
      const wnNorm = normalize(dbP.web_name);

      for (const sp of scrapedPlayers) {
        const sNorm = normalize(sp.name);

        if (sNorm === fnNorm || sNorm === wnNorm || (wnNorm.length >= 4 && sNorm.endsWith(wnNorm))) {
          const primaryRaw = sp.positions[0];
          const primaryPos = SOFIFA_POS_MAP[primaryRaw] || dbP.primary_position;
          const secondaries = sp.positions.slice(1).map(r => SOFIFA_POS_MAP[r]).filter(pos => pos && pos !== primaryPos);

          matched++;
          updates.push({
            id: dbP.id,
            name: dbP.name,
            primary_position: primaryPos,
            secondary_positions: Array.from(new Set(secondaries))
          });
          break;
        }
      }
    }

    console.log(`Matched ${matched} additional players from Championship SoFIFA roster in Gaffa DB!`);

    for (const u of updates) {
      await supabase
        .from('players')
        .update({
          primary_position: u.primary_position,
          secondary_positions: u.secondary_positions
        })
        .eq('id', u.id);
    }

    console.log('✅ Championship SoFIFA Data Update Complete!');
  } catch (err) {
    console.error('Scraper error:', err.message);
  } finally {
    await context.close();
  }
})();
