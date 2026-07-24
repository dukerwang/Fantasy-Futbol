const { chromium } = require('playwright');

(async () => {
  console.log('Testing SoFIFA search form interaction...');
  const context = await chromium.launchPersistentContext('./playwright-profile', {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const page = context.pages()[0] || await context.newPage();

  await page.goto('https://sofifa.com/players?keyword=Akpom', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  const dump = await page.evaluate(() => {
    const table = document.querySelector('table');
    if (!table) return { error: 'No table found', html: document.body.innerText.slice(0, 300) };
    const rows = Array.from(table.querySelectorAll('tr'));
    return {
      tableClass: table.className,
      rowCount: rows.length,
      sampleRows: rows.slice(0, 5).map(r => ({
        text: r.innerText.trim().replace(/\n/g, ' '),
        links: Array.from(r.querySelectorAll('a')).map(a => ({ text: a.innerText, href: a.href })),
        spans: Array.from(r.querySelectorAll('span')).map(s => ({ text: s.innerText, class: s.className }))
      }))
    };
  });

  console.log('Search Dump for Akpom:', JSON.stringify(dump, null, 2));
  await context.close();
})();
