const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();

  console.log('Navigating directly to Geovany Quenda SoFIFA page...');
  await page.goto('https://sofifa.com/player/277259/geovany-quenda/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const cardData = await page.evaluate(() => {
    const title = document.querySelector('h1')?.innerText.trim() || '';
    const posEls = Array.from(document.querySelectorAll('span.pos'));
    return {
      title,
      positions: posEls.map(el => el.innerText.trim())
    };
  });

  console.log('Direct Quenda SoFIFA Card Scraped:', cardData);
  await browser.close();
})();
