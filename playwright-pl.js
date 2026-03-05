const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    const requests = new Set();
    page.on('request', request => {
        const url = request.url();
        if (url.includes('.png') || url.includes('.jpg') || url.includes('.webp') || url.includes('player') || url.includes('photo')) {
            requests.add(url);
        }
    });

    await page.goto('https://www.premierleague.com/players/5178/Mohamed-Salah/overview', { waitUntil: 'networkidle' });

    await page.waitForTimeout(5000);

    fs.writeFileSync('pl_network.json', JSON.stringify(Array.from(requests), null, 2));
    console.log('Saved', requests.size, 'network requests on PL site');
    await browser.close();
})();
