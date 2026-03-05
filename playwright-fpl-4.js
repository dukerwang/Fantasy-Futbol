const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto('https://fantasy.premierleague.com/statistics', { waitUntil: 'networkidle' });

    // Accept cookies if present
    try {
        const acceptBtn = await page.$('#onetrust-accept-btn-handler');
        if (acceptBtn) {
            await acceptBtn.click();
            await page.waitForTimeout(1000);
        }
    } catch (e) { }

    // Click on the first element info button. The button class is usually 'ElementDialogButton'
    const infoButtons = await page.$$('button[class*="ElementDialogButton"]');
    if (infoButtons.length > 0) {
        await infoButtons[0].click({ force: true });
        await page.waitForTimeout(3000); // wait for modal
    } else {
        // fallback: click the first row name
        const rows = await page.$$('table tbody tr');
        if (rows.length > 0) {
            await rows[0].click({ force: true });
            await page.waitForTimeout(3000);
        }
    }

    const imgSrcs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img'))
            .map(img => img.src)
            .filter(Boolean);
    });

    fs.writeFileSync('fpl_images_modal.json', JSON.stringify(imgSrcs, null, 2));
    console.log('Saved images after clicking modal');
    await browser.close();
})();
