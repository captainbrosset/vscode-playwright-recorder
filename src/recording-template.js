const { chromium } = require('playwright');

(async() => {
    const browser = await chromium.launch({
        headless: false
    });
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto('https://www.wikipedia.org/');

    // <<CONTENT>>

    await context.close();
    await browser.close();
})();