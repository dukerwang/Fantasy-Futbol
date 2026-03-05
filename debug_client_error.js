const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();
  
  page.on('console', msg => console.log('BROWSER LOG:', msg.text()));
  page.on('pageerror', err => console.log('BROWSER EXCEPTION:', err.message, err.stack));

  console.log("Navigating to dashboard...");
  await page.goto('http://localhost:3000/dashboard');
  
  // if not logged in, we need to log in
  if (page.url().includes('login')) {
      console.log("Logging in...");
      await page.fill('input[type="email"]', 'dukerwang@gmail.com');
      await page.fill('input[type="password"]', 'password123'); // Adjust if needed
      await page.click('button[type="submit"]');
      await page.waitForTimeout(3000);
  }

  console.log("Current URL:", page.url());
  
  // Try to click a link on the dashboard
  const links = await page.$$('a[href^="/league/"]');
  if (links.length > 0) {
      console.log("Clicking a league link:", await links[0].getAttribute('href'));
      await links[0].click();
      await page.waitForTimeout(3000);
      console.log("New URL:", page.url());
  } else {
      console.log("No league links found");
  }

  const html = await page.content();
  fs.writeFileSync('debug_snapshot.html', html);

  await browser.close();
})();
