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

    await page.goto('https://fantasy.premierleague.com/statistics', { waitUntil: 'networkidle' });

    try {
        const acceptBtn = await page.$('#onetrust-accept-btn-handler');
        if (acceptBtn) {
            await acceptBtn.click();
            await page.waitForTimeout(1000);
        }
    } catch (e) { }

    const infoButtons = await page.$$('button[class*="ElementDialogButton"]');
    if (infoButtons.length > 0) {
        await infoButtons[0].click({ force: true });
        await page.waitForTimeout(3000);
    } else {
        const rows = await page.$$('table tbody tr');
        if (rows.length > 0) {
            await rows[0].click({ force: true });
            await page.waitForTimeout(3000);
        }
    }

    fs.writeFileSync('fpl_network.json', JSON.stringify(Array.from(requests), null, 2));
    console.log('Saved', requests.size, 'network requests');
    await browser.close();
})();
