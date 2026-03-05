const { chromium } = require('playwright');

(async () => {
    const browser = await chromium.launch();
    const page = await browser.newPage();

    await page.goto('https://fantasy.premierleague.com/statistics');
    await page.waitForTimeout(5000);

    // Try to search for "photo" in the page content
    const content = await page.content();
    const matches = content.match(/https:\/\/[^"'\s]+250x250[^"'\s]+/gi);
    if (matches) {
        console.log("Found 250x250:", [...new Set(matches)].slice(0, 5));
    }

    const imgMatches = content.match(/https:\/\/[^"'\s]+resources[^"'\s]+player[^"'\s]+/gi);
    if (imgMatches) {
        console.log("Found resources player:", [...new Set(imgMatches)].slice(0, 5));
    }

    // also check background-images
    const allHtml = await page.evaluate(() => document.documentElement.innerHTML);
    const p118748 = allHtml.match(/https:\/\/[^"'\s]+118748[^"'\s]+/gi);
    if (p118748) {
        console.log("Found Salah (118748):", [...new Set(p118748)].slice(0, 5));
    }

    await browser.close();
})();
