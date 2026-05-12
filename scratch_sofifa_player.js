const { chromium } = require('playwright');
const SOFIFA_BASE = 'https://api.sofifa.net';

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
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    console.log('Loading sofifa.com...');
    await page.goto('https://sofifa.com', { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(2000);

    // Fetch Arsenal (team 1)
    console.log('Fetching Arsenal...');
    const teamData = await fetchJson(page, '/team/1');
    const firstPlayerId = teamData.data.players[0].id;
    console.log('First player ID:', firstPlayerId);

    // Fetch Player Detail
    console.log('Fetching player detail...');
    const playerData = await fetchJson(page, `/player/${firstPlayerId}`);
    console.log(JSON.stringify(playerData.data, null, 2));

  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
})();
