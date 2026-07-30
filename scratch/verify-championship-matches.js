/**
 * Re-scrape SoFIFA Championship (lg=14) rosters and re-derive the same
 * matches scrape_championship_sofifa.js made earlier today, but this time
 * also check first-name/initial correspondence (not just surname endsWith).
 * READ-ONLY — prints suspects for review, does not write to the DB.
 */
process.loadEnvFile('.env.local');
const { chromium } = require('playwright');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const delay = (ms) => new Promise(function (r) { setTimeout(r, ms); });

function normalize(name) {
  if (!name) return '';
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
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
  const context = await chromium.launchPersistentContext('./playwright-profile', {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-blink-features=AutomationControlled'],
  });
  const page = context.pages()[0] || await context.newPage();

  try {
    await page.goto('https://sofifa.com/teams?lg=14', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await delay(3000);
    const teamLinks = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href^="/team/"]'));
      const seen = new Set(); const result = [];
      links.forEach(function (a) {
        const href = a.getAttribute('href'); const name = a.innerText.trim();
        if (href && name && !seen.has(href)) { seen.add(href); result.push({ name: name, href: 'https://sofifa.com' + href }); }
      });
      return result;
    });

    const scrapedPlayers = [];
    for (const t of teamLinks) {
      await page.goto(t.href, { waitUntil: 'domcontentloaded', timeout: 20000 });
      await delay(1500);
      const roster = await page.evaluate(() => {
        const rows = Array.from(document.querySelectorAll('table tbody tr'));
        return rows.map(function (r) {
          const a = r.querySelector('a[href^="/player/"]');
          const posEls = Array.from(r.querySelectorAll('span.pos'));
          return { name: a ? a.innerText.trim() : null, positions: posEls.map(function (el) { return el.innerText.trim(); }).filter(function (p) { return p !== 'SUB' && p !== 'RES'; }) };
        }).filter(function (p) { return p.name && p.positions.length > 0; });
      });
      scrapedPlayers.push.apply(scrapedPlayers, roster);
    }
    console.log('Scraped ' + scrapedPlayers.length + ' Championship players.\n');

    const { data: dbPlayers } = await supabase
      .from('players')
      .select('id, name, web_name, pl_team, primary_position, secondary_positions')
      .eq('is_active', true)
      .in('pl_team', ['Hull City', 'Ipswich Town', 'Coventry City']);

    let confirmed = 0, suspects = 0;
    for (const dbP of dbPlayers) {
      const fnNorm = normalize(dbP.name);
      const wnNorm = normalize(dbP.web_name);
      const dbFirstToken = fnNorm.split(' ')[0];

      for (const sp of scrapedPlayers) {
        const sNorm = normalize(sp.name);
        if (sNorm === fnNorm || sNorm === wnNorm || (wnNorm.length >= 4 && sNorm.endsWith(wnNorm))) {
          const spTokens = sNorm.split(' ');
          const spFirst = spTokens[0];
          const initialMatch = spFirst.length <= 2 && dbFirstToken.charAt(0) === spFirst.replace('.', '').charAt(0);
          const fullMatch = spFirst === dbFirstToken || sNorm === fnNorm;
          if (initialMatch || fullMatch || sNorm === wnNorm) {
            confirmed++;
          } else {
            suspects++;
            console.log('SUSPECT: DB "' + dbP.name + '" (' + dbP.pl_team + ') <- scraped "' + sp.name + '" [' + sp.positions.join(',') + '] | current DB pos: ' + dbP.primary_position + ' ' + JSON.stringify(dbP.secondary_positions));
          }
          break;
        }
      }
    }
    console.log('\nConfirmed consistent: ' + confirmed + ' | Suspect (name mismatch beyond surname): ' + suspects);
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await context.close();
  }
})();
