/**
 * Fetches PL squad + position data from api.sofifa.net using a real browser
 * (bypasses Cloudflare), then POSTs it to the local sync route for DB processing.
 *
 * Usage:
 *   node playwright-sofifa.js
 *
 * Requires the dev server to be running on localhost:3000.
 */

const { chromium } = require('playwright');

const SOFIFA_BASE = 'https://api.sofifa.net';
const PL_LEAGUE_ID = 13;
const SYNC_URL = 'http://localhost:3000/api/sync/sofifa-players';
const CRON_SECRET = process.env.CRON_SECRET || 'change-me-to-a-random-secret';

// Make a fetch() call from inside the browser context (stays on sofifa.com domain).
// This looks like normal site AJAX to Cloudflare — avoids the block that direct
// navigation to api.sofifa.net triggers.
async function fetchJson(page, path) {
  return page.evaluate(async (url) => {
    const res = await fetch(url, {
      headers: { Accept: 'application/json' },
      credentials: 'include',
    });
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return res.json();
  }, `${SOFIFA_BASE}${path}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    // 1. Load sofifa.com so the browser has a real session for the domain.
    //    sofifa.com's JS itself fetches from api.sofifa.net, so our in-page
    //    fetch calls inherit that session and look like normal site requests.
    console.log('Loading sofifa.com...');
    await page.goto('https://sofifa.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000); // let JS run and set cookies

    // 2. Get all leagues to find the latest PL roster
    console.log('Fetching leagues...');
    const leagues = await fetchJson(page, '/leagues').catch(e => { throw new Error(`leagues: ${e.message}`) });
    const plLeague = leagues.data.find((l) => l.id === PL_LEAGUE_ID);
    if (!plLeague) throw new Error('Premier League not found in SoFIFA leagues');
    const latestRoster = plLeague.latestRoster;
    console.log(`Latest PL roster: ${latestRoster}`);

    // 3. Get PL team list for that roster
    console.log('Fetching PL teams...');
    const teamsData = await fetchJson(page, `/league/${PL_LEAGUE_ID}/${latestRoster}`);
    const teamIds = teamsData.data.map((t) => t.id);
    console.log(`Found ${teamIds.length} teams`);

    // 4. Fetch each team's squad (1s delay between requests to stay under 60/min)
    const preloadedTeams = [];
    for (let i = 0; i < teamIds.length; i++) {
      const teamId = teamIds[i];
      console.log(`Fetching team ${teamId} (${i + 1}/${teamIds.length})...`);
      try {
        const teamData = await fetchJson(page, `/team/${teamId}`);
        preloadedTeams.push(teamData.data);
      } catch (e) {
        console.warn(`  Skipped team ${teamId}: ${e.message}`);
      }
      if (i < teamIds.length - 1) await page.waitForTimeout(1000);
    }

    console.log(`\nFetched ${preloadedTeams.length} team squads. Sending to sync route...`);

    // 5. POST pre-fetched data to the sync route
    const res = await fetch(SYNC_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-cron-secret': CRON_SECRET,
      },
      body: JSON.stringify({ preloadedTeams }),
    });

    const result = await res.json();
    console.log('Done:', result);
  } catch (e) {
    console.error('Error:', e.message);
    process.exit(1);
  } finally {
    await browser.close();
  }
})();
