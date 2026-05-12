const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  console.log('Navigating...');
  const res = await page.goto('https://api.sofifa.net/team/1');
  console.log('Status:', res.status());
  const text = await page.evaluate(() => document.body.innerText);
  console.log('Body:', text.slice(0, 100));
  await browser.close();
})();
