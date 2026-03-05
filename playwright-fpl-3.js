const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto('https://fantasy.premierleague.com/statistics');
    await page.waitForTimeout(10000); // 10s to ensure React loads and images are fetched

    const imgSrcs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img'))
            .map(img => img.src)
            .filter(Boolean);
    });

    fs.writeFileSync('fpl_images.json', JSON.stringify(imgSrcs, null, 2));
    console.log('Saved', imgSrcs.length, 'images to fpl_images.json');
    await browser.close();
})();
