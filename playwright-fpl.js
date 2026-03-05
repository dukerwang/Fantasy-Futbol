const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    // Go to FPL stats page which lists all players
    await page.goto('https://fantasy.premierleague.com/statistics');
    // Wait for images to load
    await page.waitForTimeout(3000);

    // Extract all img src attributes
    const imgSrcs = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('img'))
            .map(img => img.src)
            .filter(src => src.includes('player') || src.includes('photo'));
    });

    console.log('Image SRCs found:');
    console.log(imgSrcs.slice(0, 10));

    await browser.close();
})();
