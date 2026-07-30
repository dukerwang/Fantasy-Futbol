process.loadEnvFile('.env.local');
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  await page.goto('https://sofifa.com', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2000));
  console.log('Homepage title:', await page.title());

  await page.goto('https://sofifa.com/players?keyword=Rodri', { waitUntil: 'domcontentloaded', timeout: 15000 });
  await new Promise(r => setTimeout(r, 2000));
  console.log('Search page title:', await page.title());
  const bodyText = await page.evaluate(() => document.body.innerText.slice(0, 500));
  console.log('Body text sample:', bodyText);
  const tableRows = await page.evaluate(() => document.querySelectorAll('table tbody tr').length);
  console.log('table tbody tr count:', tableRows);
  const anyTable = await page.evaluate(() => document.querySelectorAll('table').length);
  console.log('table count:', anyTable);
  await page.screenshot({ path: 'scratch/sofifa-search-debug.png' });
  console.log('screenshot saved to scratch/sofifa-search-debug.png');

  await browser.close();
})();
