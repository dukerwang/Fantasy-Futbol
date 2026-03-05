const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  
  await page.goto('http://localhost:3000/login');
  await page.fill('input[type="email"]', 'test@example.com'); // Put a default user if known
  await page.fill('input[type="password"]', 'password123'); // Put default pass
  // We don't know the exact user, but we can try just clicking login or see if we can catch an error logged to console.
  
  page.on('console', msg => console.log('PAGE LOG:', msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  page.on('response', response => {
      if (response.status() >= 400) {
          console.log('HTTP ERROR', response.status(), response.url());
      }
  });

  await page.click('button[type="submit"]');
  await page.waitForTimeout(3000);
  
  const content = await page.content();
  if (content.includes('Error')) {
      console.log('Error found in HTML output!');
  }
  
  await browser.close();
})();
