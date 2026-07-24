const { chromium } = require('playwright');

(async () => {
  console.log('--- CHECKING SOFIFA DIRECTORY & FC EDITION ---');

  const context = await chromium.launchPersistentContext('./playwright-profile', {
    headless: false,
    executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = context.pages()[0] || await context.newPage();

  console.log('Navigating to https://sofifa.com/teams?lg=13...');
  await page.goto('https://sofifa.com/teams?lg=13', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(3000);

  const info = await page.evaluate(() => {
    const title = document.title;
    const versionDropdown = document.querySelector('button[aria-label="Rosters"], select[name="roster"]')?.innerText || document.querySelector('header')?.innerText.slice(0, 100);

    const teamLinks = Array.from(document.querySelectorAll('a[href^="/team/"]'));
    const teams = [];
    const seen = new Set();

    teamLinks.forEach(a => {
      const name = a.innerText.trim();
      const href = a.getAttribute('href');
      if (name && href && !seen.has(href)) {
        seen.add(href);
        teams.push({ name, href });
      }
    });

    return { title, versionDropdown, teamsCount: teams.length, teams };
  });

  console.log('Page Title:', info.title);
  console.log('Header / Version Info:', info.versionDropdown);
  console.log(`Found ${info.teamsCount} Premier League teams on sofifa.com/teams?lg=13:`);
  info.teams.forEach((t, i) => console.log(`  ${i + 1}. ${t.name} -> ${t.href}`));

  await context.close();
})();
