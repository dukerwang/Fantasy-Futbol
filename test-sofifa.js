const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  try {
    console.log('Fetching Premier League teams...');
    await page.goto('https://sofifa.com/teams?lg=13', { waitUntil: 'domcontentloaded', timeout: 60000 });
    
    // Extract team links
    const teamsData = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('table tbody tr a[href^="/team/"]'));
      return links.map(a => ({ text: a.innerText.trim(), href: a.getAttribute('href') })).filter(l => l.text);
    });
    
    console.log(`Found ${teamsData.length} teams.`);
    console.log('Sample teams:', teamsData.slice(0, 5));
    
  } catch (e) {
    console.error('Error:', e.message);
  } finally {
    await browser.close();
  }
})();
